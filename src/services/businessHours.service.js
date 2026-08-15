// Evaluates a Bot's businessHours config against "now", entirely with the
// built-in Intl API (no extra timezone dependency needed).

const partsFor = (date, timeZone) => {
    const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
    const parts = fmt.formatToParts(date).reduce((acc, p) => {
        acc[p.type] = p.value;
        return acc;
    }, {});
    const WEEKDAY_TO_NUM = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    // Some locales render "24" for midnight — normalize to "00" for parsing.
    const hour = parts.hour === "24" ? "00" : parts.hour;
    return { day: WEEKDAY_TO_NUM[parts.weekday], hhmm: `${hour}:${parts.minute}` };
};

const toMinutes = (hhmm) => {
    const [h, m] = String(hhmm).split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
};

/**
 * Returns true if `bot` currently has live agent hours. A bot with
 * businessHours.enabled = false is always considered "open" (24/7 handover,
 * the pre-existing behavior) — business hours are opt-in.
 */
const isWithinBusinessHours = (bot, now = new Date()) => {
    const bh = bot.businessHours;
    if (!bh?.enabled) return true;

    let day, hhmm;
    try {
        ({ day, hhmm } = partsFor(now, bh.timezone || "UTC"));
    } catch (err) {
        // Invalid/unknown timezone string — fail open rather than blocking every handover.
        return true;
    }

    const todaySchedule = (bh.schedule || []).find((s) => s.day === day);
    if (!todaySchedule || !todaySchedule.enabled) return false;

    const nowMin = toMinutes(hhmm);
    const startMin = toMinutes(todaySchedule.start);
    const endMin = toMinutes(todaySchedule.end);

    if (startMin === endMin) return false; // zero-length window = closed
    if (startMin < endMin) return nowMin >= startMin && nowMin < endMin;
    // Overnight window (e.g. 22:00 -> 06:00)
    return nowMin >= startMin || nowMin < endMin;
};

/**
 * A short, human-readable summary of the bot's hours, e.g.
 * "Mon–Fri 9:00 AM–6:00 PM (Asia/Kolkata)" — shown in the widget when a
 * visitor requests an agent so they know when to come back.
 */
const describeBusinessHours = (bot) => {
    const bh = bot.businessHours;
    if (!bh?.enabled) return null;

    const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const activeDays = (bh.schedule || []).filter((s) => s.enabled);
    if (!activeDays.length) return null;

    const grouped = activeDays.map((s) => `${DAY_NAMES[s.day]} ${s.start}\u2013${s.end}`).join(", ");
    return `${grouped} (${bh.timezone || "UTC"})`;
};

module.exports = { isWithinBusinessHours, describeBusinessHours };