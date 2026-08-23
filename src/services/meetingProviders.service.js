const axios = require("axios");
const ApiError = require("../utils/ApiError");
const googleMeetOauth = require("./googleMeetOauth.service");

// ---------------------------------------------------------------------------
// Turns a confirmed slot (date + time_slot picked from the Availability tab,
// mentor config from the Mentors tab, attendee details) into a REAL meeting
// with the provider the bot owner connected (IntegrationCredential channel
// "meeting_scheduling"). Every function here returns the same shape:
//   { meeting_link, meeting_id, provider_status }
// so botTools.service.js#book_meeting doesn't need to branch on provider.
// ---------------------------------------------------------------------------

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

// Combines a "YYYY-MM-DD" date with a "HH:MM AM/PM" (or "HH:MM-HH:MM") style
// time_slot into an ISO start/end pair. Sheet owners write time_slot free-
// text ("10:00-11:00", "6:00 AM - 9:00 AM", "All Day") — we only need to
// parse a leading start time here; duration falls back to duration_mins on
// the Items row (already read by the caller) or 30 minutes.
function parseSlotToRange(date, timeSlot, durationMins, timezone) {
  const cleaned = String(timeSlot || "").trim();
  const firstPart = cleaned.split(/-|to/i)[0].trim();
  const match = firstPart.match(/(\d{1,2}):?(\d{2})?\s*([AaPp][Mm])?/);

  let hour = match ? parseInt(match[1], 10) : 9;
  const minute = match && match[2] ? parseInt(match[2], 10) : 0;
  const meridiem = match && match[3] ? match[3].toLowerCase() : null;
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;

  // Build a naive local wall-clock ISO string (no Z) — Google/Cal.com both
  // accept this alongside an explicit timeZone field, which is more honest
  // than guessing a UTC offset for whatever timezone string the sheet owner
  // wrote (e.g. "Asia/Kolkata").
  const pad = (n) => String(n).padStart(2, "0");
  const startLocal = `${date}T${pad(hour)}:${pad(minute)}:00`;
  const startDate = new Date(`${date}T${pad(hour)}:${pad(minute)}:00`);
  const endDate = new Date(startDate.getTime() + (Number(durationMins) || 30) * 60000);
  const endLocal = `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(endDate.getDate())}T${pad(
    endDate.getHours()
  )}:${pad(endDate.getMinutes())}:00`;

  return { startLocal, endLocal, timezone: timezone || "Asia/Kolkata" };
}

// --- Google Meet (same connected Google account as Email/Sheets — see
// googleMeetOauth.service.js. Events are created directly on that
// account's own calendar, so there's no calendar-sharing step.) ---

async function createGoogleMeetEvent({ credential, mentor, item, date, timeSlot, attendee }) {
  const g = credential.meetingScheduling?.googleMeet || {};
  if (!g.accessToken) throw new ApiError(400, "Google Meet isn't connected — connect your Google account from the Credentials page");

  const accessToken = await googleMeetOauth.getValidAccessToken(credential);
  const calendarId = mentor.calendar_id || g.calendarId || "primary";
  const timezone = mentor.timezone || g.defaultTimezone || "Asia/Kolkata";
  const { startLocal, endLocal } = parseSlotToRange(date, timeSlot, item.duration_mins, timezone);

  const attendees = [{ email: attendee.email }];
  if (mentor.host_email && mentor.host_email !== g.email) attendees.push({ email: mentor.host_email });

  try {
    const { data } = await axios.post(
      `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        summary: mentor.meeting_title || `${item.name} with ${attendee.name || "customer"}`,
        description: `Booked via ${item.name}. Attendee: ${attendee.name || ""} <${attendee.email || ""}> ${attendee.phone || ""}`.trim(),
        start: { dateTime: startLocal, timeZone: timezone },
        end: { dateTime: endLocal, timeZone: timezone },
        attendees,
        conferenceData: {
          createRequest: { requestId: `meet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, conferenceSolutionKey: { type: "hangoutsMeet" } },
        },
      },
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { conferenceDataVersion: 1, sendUpdates: "all" },
        timeout: 15000,
      }
    );

    const meetLink =
      data.hangoutLink ||
      (data.conferenceData?.entryPoints || []).find((e) => e.entryPointType === "video")?.uri ||
      null;

    return {
      meeting_link: meetLink || data.htmlLink,
      meeting_id: data.id,
      provider_status: "confirmed",
    };
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    if (err.response?.status === 401) {
      throw new ApiError(401, `Google Meet's connection has expired — reconnect your Google account from the Credentials page: ${msg}`);
    }
    throw new ApiError(502, `Google Calendar event creation failed: ${msg}`);
  }
}

async function cancelGoogleMeetEvent({ credential, mentor, eventId }) {
  const g = credential.meetingScheduling?.googleMeet || {};
  if (!g.accessToken || !eventId) return;
  const accessToken = await googleMeetOauth.getValidAccessToken(credential);
  const calendarId = mentor?.calendar_id || g.calendarId || "primary";
  try {
    await axios.delete(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { sendUpdates: "all" },
      timeout: 10000,
    });
  } catch {
    // Best-effort — a stale/missing calendar event shouldn't block cancelling the booking on our side.
  }
}

// --- Cal.com (real server-side booking via their public API) ---

async function createCalComBooking({ credential, mentor, item, date, timeSlot, attendee }) {
  const c = credential.meetingScheduling?.calCom || {};
  if (!c.apiKey) throw new ApiError(400, "Cal.com isn't fully connected on this credential");
  if (!mentor.cal_event_type_id) {
    throw new ApiError(400, "This mentor's Mentors row is missing cal_event_type_id — add it from the event type's URL/settings on Cal.com");
  }

  const timezone = mentor.timezone || c.defaultTimezone || "Asia/Kolkata";
  const { startLocal } = parseSlotToRange(date, timeSlot, item.duration_mins, timezone);
  const baseUrl = (c.baseUrl || "https://api.cal.com").replace(/\/$/, "");

  try {
    const { data } = await axios.post(
      `${baseUrl}/v1/bookings`,
      {
        eventTypeId: Number(mentor.cal_event_type_id),
        start: new Date(`${startLocal}Z`).toISOString(),
        responses: {
          name: attendee.name || "Customer",
          email: attendee.email,
          location: { value: "integrations:google:meet", optionValue: "" },
        },
        timeZone: timezone,
        language: "en",
        metadata: { source: "jestbot" },
      },
      { params: { apiKey: c.apiKey }, timeout: 15000 }
    );

    const booking = data.booking || data;
    const meetLink =
      booking?.location ||
      booking?.references?.find((r) => r.type?.includes("meet") || r.type?.includes("video"))?.meetingUrl ||
      (booking?.uid ? `${c.username ? `https://cal.com/${c.username}` : baseUrl}/booking/${booking.uid}` : null);

    return {
      meeting_link: meetLink,
      meeting_id: String(booking?.id || booking?.uid || ""),
      provider_status: "confirmed",
    };
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    throw new ApiError(502, `Cal.com booking failed: ${msg}`);
  }
}

async function cancelCalComBooking({ credential, bookingId }) {
  const c = credential.meetingScheduling?.calCom || {};
  if (!c.apiKey || !bookingId) return;
  const baseUrl = (c.baseUrl || "https://api.cal.com").replace(/\/$/, "");
  try {
    await axios.delete(`${baseUrl}/v1/bookings/${bookingId}`, {
      params: { apiKey: c.apiKey },
      data: { cancellationReason: "Cancelled by customer" },
      timeout: 10000,
    });
  } catch {
    // Best-effort — see cancelGoogleMeetEvent.
  }
}

// --- Calendly (link mode — their public API can't create a booking for an
// arbitrary invitee, so we hand the customer a real, pre-filled scheduling
// link and let Calendly own the actual slot picking) ---

function buildCalendlyLink({ credential, mentor, attendee }) {
  const cal = credential.meetingScheduling?.calendly || {};
  const eventUrl = mentor.calendly_event_url || cal.schedulingBaseUrl;
  if (!eventUrl) throw new ApiError(400, "This mentor's Mentors row is missing calendly_event_url");

  const url = new URL(eventUrl);
  if (attendee.name) url.searchParams.set("name", attendee.name);
  if (attendee.email) url.searchParams.set("email", attendee.email);

  return {
    meeting_link: url.toString(),
    meeting_id: null,
    provider_status: "customer_schedules", // the actual slot is picked by the customer on Calendly's page
  };
}

// --- Dispatcher ---

async function createMeeting({ credential, mentor, item, date, timeSlot, attendee }) {
  const provider = mentor.provider || credential.meetingScheduling?.provider;
  if (provider === "google_meet") return createGoogleMeetEvent({ credential, mentor, item, date, timeSlot, attendee });
  if (provider === "cal_com") return createCalComBooking({ credential, mentor, item, date, timeSlot, attendee });
  if (provider === "calendly") return buildCalendlyLink({ credential, mentor, attendee });
  throw new ApiError(400, `Unsupported meeting provider "${provider}"`);
}

async function cancelMeeting({ credential, mentor, provider, meetingId }) {
  const p = provider || mentor?.provider || credential.meetingScheduling?.provider;
  if (p === "google_meet") return cancelGoogleMeetEvent({ credential, mentor, eventId: meetingId });
  if (p === "cal_com") return cancelCalComBooking({ credential, bookingId: meetingId });
  // calendly — nothing to cancel on our end, the customer manages/cancels from their own Calendly confirmation email.
}

module.exports = { createMeeting, cancelMeeting, parseSlotToRange };
