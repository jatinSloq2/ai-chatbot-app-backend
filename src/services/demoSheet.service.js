const XLSX = require("xlsx");
const { REQUIRED_TABS } = require("./googleSheets.service");

// ---------------------------------------------------------------------------
// Generates the "download demo sheet" workbook shown on the bot detail page's
// Tools tab. Headers come straight from googleSheets.service.js#REQUIRED_TABS
// — the same constant the bot's tools actually read/write — so this file can
// never drift out of sync with what the sheet integration expects.
//
// Every tab is filled with a couple of realistic example rows that between
// them demonstrate the *options* available on that tab (both item_type
// branches, both stock-counted and bookable rows, every meeting provider,
// every status value, etc.), plus a leading "# ..." comment row per tab
// explaining what it's for — so someone can open the file and understand
// how to maintain it without leaving the spreadsheet.
// ---------------------------------------------------------------------------

const NOTE = (text) => `# ${text}`;

const buildRows = () => ({
  Items: [
    NOTE("Your catalog. item_type \"service\"/\"booking\"/\"appointment\" = uses Availability tab below. Anything else = stock-counted, uses stock_qty on this row. status must be exactly \"active\" to show up anywhere."),
    {
      item_id: "ITM001", item_type: "product", name: "Wireless Mouse", category: "Electronics",
      description: "Ergonomic wireless mouse, 2.4GHz, USB-C rechargeable.", price: 25.99, currency: "USD",
      stock_qty: 42, duration_mins: "", capacity_per_slot: "", image_url: "https://example.com/mouse.jpg",
      status: "active",
    },
    {
      item_id: "ITM002", item_type: "service", name: "1-Hour Consultation", category: "Consulting",
      description: "One-on-one consultation call.", price: 49.0, currency: "USD",
      stock_qty: "", duration_mins: 60, capacity_per_slot: 1, image_url: "",
      status: "active",
    },
    {
      item_id: "ITM003", item_type: "meeting", name: "Career Mentorship Session", category: "Mentorship",
      description: "30-minute 1-on-1 mentorship call — see the Mentors tab for who hosts this.",
      price: 0, currency: "USD", stock_qty: "", duration_mins: 30, capacity_per_slot: 1, image_url: "",
      status: "active",
    },
    {
      item_id: "ITM004", item_type: "product", name: "Discontinued Cable", category: "Electronics",
      description: "Example of a hidden row — status isn't \"active\" so this never shows up.",
      price: 9.99, currency: "USD", stock_qty: 0, duration_mins: "", capacity_per_slot: "", image_url: "",
      status: "inactive",
    },
  ],

  Availability: [
    NOTE("Bookable slots for every service/meeting item_id in Items. A stock-counted (product) row never needs a row here. booked_count starts at 0 and the bot updates it automatically."),
    { item_id: "ITM002", date: "2026-09-01", time_slot: "10:00-11:00", capacity: 1, booked_count: 0, status: "available" },
    { item_id: "ITM002", date: "2026-09-01", time_slot: "14:00-15:00", capacity: 1, booked_count: 1, status: "available" },
    { item_id: "ITM003", date: "2026-09-02", time_slot: "All Day", capacity: 5, booked_count: 2, status: "available" },
    { item_id: "ITM003", date: "2026-09-03", time_slot: "All Day", capacity: 5, booked_count: 5, status: "closed" },
  ],

  Orders: [
    NOTE("Written automatically by the bot when a customer orders/books — you don't need to fill this in yourself. Left here filled in just so you can see the shape of what gets written."),
    {
      order_id: "ORD1001", user_id: "USR001", item_id: "ITM001", qty_or_people: 2, date_or_slot: "",
      delivery_address: "12 Baker Street, London", total_amount: 51.98, order_status: "confirmed",
      payment_status: "paid", created_at: "2026-08-20T10:15:00Z", updated_at: "2026-08-20T10:16:00Z",
    },
    {
      order_id: "ORD1002", user_id: "USR002", item_id: "ITM002", qty_or_people: 1, date_or_slot: "2026-09-01 10:00-11:00",
      delivery_address: "", total_amount: 49.0, order_status: "pending", payment_status: "pending",
      created_at: "2026-08-21T09:00:00Z", updated_at: "2026-08-21T09:00:00Z",
    },
  ],

  Users: [
    NOTE("Written automatically the first time a customer gives their name/phone."),
    { user_id: "USR001", name: "Priya Sharma", phone: "+919812345670", email: "priya@example.com", address: "12 Baker Street, London", created_at: "2026-08-20T10:14:00Z" },
    { user_id: "USR002", name: "Alex Chen", phone: "+14155550123", email: "alex@example.com", address: "", created_at: "2026-08-21T08:58:00Z" },
  ],

  Payments: [
    NOTE("Written automatically by the payment tools — or add a row manually to record an offline/cash payment. status is one of pending / paid / failed / refunded."),
    {
      payment_id: "PAY2001", order_id: "ORD1001", amount: 51.98, status: "paid", method: "razorpay",
      paid_at: "2026-08-20T10:16:00Z", gateway_ref: "rzp_order_abc123", gateway_payment_id: "pay_xyz789",
      payment_link_url: "",
    },
    {
      payment_id: "PAY2002", order_id: "ORD1002", amount: 49.0, status: "pending", method: "cash", paid_at: "",
      gateway_ref: "", gateway_payment_id: "", payment_link_url: "",
    },
  ],

  Tickets: [
    NOTE("Written automatically when the bot opens a support ticket. status is one of open / in_progress / resolved / closed."),
    { ticket_id: "TKT3001", user_id: "USR001", order_id: "ORD1001", category: "delivery", description: "Order arrived a day late.", status: "resolved", created_at: "2026-08-22T11:00:00Z" },
    { ticket_id: "TKT3002", user_id: "USR002", order_id: "", category: "general", description: "Asked about bulk pricing.", status: "open", created_at: "2026-08-23T13:20:00Z" },
  ],

  Mentors: [
    NOTE("One row per bookable mentor, matching an item_id in Items with item_type \"meeting\". provider decides which columns matter — see the three example rows below, one per provider."),
    {
      item_id: "ITM003", provider: "google_meet", host_name: "Dr. Meera Rao", host_email: "meera@example.com",
      timezone: "Asia/Kolkata", meeting_title: "Career Mentorship with {customer}", buffer_mins: 10,
      calendar_id: "primary", calendly_event_url: "", cal_username: "", cal_event_type_id: "",
      notes: "Prefers mornings IST.", status: "active",
    },
    {
      item_id: "ITM003", provider: "cal_com", host_name: "Jordan Lee", host_email: "jordan@example.com",
      timezone: "America/New_York", meeting_title: "", buffer_mins: 15, calendar_id: "",
      calendly_event_url: "", cal_username: "jordanlee", cal_event_type_id: "123456",
      notes: "", status: "active",
    },
    {
      item_id: "ITM003", provider: "calendly", host_name: "Sam Patel", host_email: "sam@example.com",
      timezone: "Europe/London", meeting_title: "", buffer_mins: "", calendar_id: "",
      calendly_event_url: "https://calendly.com/sam-patel/30min", cal_username: "", cal_event_type_id: "",
      notes: "Calendly can't book on the customer's behalf — link is sent for them to pick a time.",
      status: "active",
    },
  ],

  Bookings: [
    NOTE("Written automatically by book_meeting/cancel_meeting_booking — kept separate from Orders so the real meeting link/provider bookkeeping doesn't clutter non-meeting order rows."),
    {
      booking_id: "BKG4001", order_id: "ORD1002", item_id: "ITM003", user_id: "USR002", provider: "google_meet",
      date: "2026-09-05", time_slot: "16:00-16:30", timezone: "America/New_York",
      meeting_link: "https://meet.google.com/abc-defg-hij", meeting_id: "abc-defg-hij",
      host_email: "meera@example.com", attendee_name: "Alex Chen", attendee_email: "alex@example.com",
      attendee_phone: "+14155550123", status: "confirmed", created_at: "2026-08-21T09:05:00Z",
      updated_at: "2026-08-21T09:05:00Z",
    },
  ],
});

// Builds the workbook and returns it as a Buffer ready to stream as an
// attachment. Kept synchronous and pure (no I/O) so it's trivially testable
// and cheap to call on every request — no need to cache/regenerate on disk.
const buildDemoSheetBuffer = () => {
  const rows = buildRows();
  const workbook = XLSX.utils.book_new();

  for (const [tabName, headers] of Object.entries(REQUIRED_TABS)) {
    const tabRows = rows[tabName] ?? [];

    // First row is the real header row; the leading "# ..." note (if any)
    // goes on the row above it as a single merged-looking comment cell so
    // it doesn't get mistaken for a column header by the bot's own reader
    // (which only ever looks at the row it's told is the header row, i.e.
    // row 1 in the actual Google Sheet the user creates from this).
    const noteRow = typeof tabRows[0] === "string" ? [tabRows[0]] : null;
    const dataRows = (noteRow ? tabRows.slice(1) : tabRows).map((row) =>
      headers.map((h) => (row[h] !== undefined && row[h] !== null ? row[h] : ""))
    );

    const aoa = noteRow ? [noteRow, headers, ...dataRows] : [headers, ...dataRows];
    const sheet = XLSX.utils.aoa_to_sheet(aoa);

    // Merge the note row across all columns so it reads as one line, and
    // give the header row a bit of column width so it isn't unreadably
    // cramped when opened in Excel/Sheets.
    if (noteRow && headers.length > 1) {
      sheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }];
    }
    sheet["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 2, 14) }));

    XLSX.utils.book_append_sheet(workbook, sheet, tabName);
  }

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
};

module.exports = { buildDemoSheetBuffer };