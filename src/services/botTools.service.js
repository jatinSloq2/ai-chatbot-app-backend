const ApiError = require("../utils/ApiError");
const IntegrationCredential = require("../models/IntegrationCredential");
const sheets = require("./googleSheets.service");
const sheetsOauth = require("./googleSheetsOauth.service");
const razorpayService = require("./razorpay.service");
const ragService = require("./rag.service");
const handoverService = require("./handover.service");
const meetingProviders = require("./meetingProviders.service");
const botEmail = require("./botTransactionalEmail.service");
const logger = require("../utils/logger");

// Short random IDs in the same style the master spec uses (ORD00123 etc).
const genId = (prefix) => `${prefix}${Date.now().toString(36).toUpperCase().slice(-4)}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

// Items are tracked one of two ways: by a plain stock count (a physical
// good sitting in inventory) or by bookable slots in the Availability tab
// (a service/rental with a schedule). Sheet owners fill in item_type
// themselves and reasonably write "physical" or "rental" instead of the
// literal word "product" — this is what actually distinguishes the two
// paths, not the exact string used. Anything not recognized as
// slot-based falls back to stock-based, since that's the more common
// case and the safer default (a typo'd item_type shouldn't make a real
// item register as permanently unavailable).
const SLOT_BASED_TYPES = new Set(["service", "booking", "appointment", "meeting"]);
const isStockTracked = (itemType) => !SLOT_BASED_TYPES.has(String(itemType || "").toLowerCase());

// Master switch (Bot.toolsConfig.sendCustomerEmails, default true) for every
// customer-facing transactional email this file sends — order confirmation,
// booking confirmation (with the real meeting link), payment-received, and
// booking-cancelled. Checked before every send below so a bot owner can turn
// it off entirely without touching individual call sites.
const emailsEnabled = (bot) => bot?.toolsConfig?.sendCustomerEmails !== false;

// Loads + decrypts the bot's connected Google Sheets credential, returns a
// ready-to-use { accessToken, spreadsheetId }. Cached per bot object for the
// lifetime of one chat turn (a turn may call several tools).
const getSheetAuth = async (bot) => {
  if (!bot.toolsConfig?.sheetsCredentialId) {
    throw new ApiError(400, "No Google Sheet connected — connect one in the bot's Tools tab first");
  }
  if (bot._sheetAuthCache) return bot._sheetAuthCache;

  const cred = await IntegrationCredential.findOne({
    _id: bot.toolsConfig.sheetsCredentialId,
    user: bot.user,
    channel: "google_sheets",
  });
  if (!cred) throw new ApiError(400, "Connected Google Sheet credential not found");

  let spreadsheetId;
  let accessToken;

  if (cred.googleSheets.method === "oauth") {
    // One Google account can back several sheets — the bot must say which
    // one (bot.toolsConfig.spreadsheetId), the credential just holds the
    // shared OAuth tokens.
    if (!bot.toolsConfig?.spreadsheetId) {
      throw new ApiError(400, "No sheet selected for this bot — pick one in the bot's Tools tab");
    }
    const sheet = cred.googleSheets.sheets.find((s) => s.spreadsheetId === bot.toolsConfig.spreadsheetId);
    if (!sheet) throw new ApiError(400, "The sheet selected for this bot is no longer connected");
    spreadsheetId = sheet.spreadsheetId;
    accessToken = await sheetsOauth.getValidAccessToken(cred); // refreshes + persists as needed
  } else {
    if (!cred.googleSheets.spreadsheetId) {
      throw new ApiError(400, "This Google Sheet connection hasn't had a sheet created/attached yet");
    }
    spreadsheetId = cred.googleSheets.spreadsheetId;
    accessToken = (await sheets.authFromCredential(cred.googleSheets)).accessToken;
  }

  const auth = { accessToken, spreadsheetId };
  bot._sheetAuthCache = auth;
  return auth;
};

// Loads + decrypts the bot's connected Razorpay credential. Returns null
// (not an error) when none is connected — callers use that to fall back to
// the sheet-only "pending payment" bookkeeping behavior.
const getRazorpayAuth = async (bot) => {
  if (!bot.toolsConfig?.razorpayCredentialId) return null;
  if (bot._razorpayAuthCache !== undefined) return bot._razorpayAuthCache;

  const cred = await IntegrationCredential.findOne({
    _id: bot.toolsConfig.razorpayCredentialId,
    user: bot.user,
    channel: "razorpay",
  });
  const auth = cred?.razorpay?.keyId && cred?.razorpay?.keySecret
    ? { keyId: cred.razorpay.keyId, keySecret: cred.razorpay.keySecret }
    : null;
  bot._razorpayAuthCache = auth;
  return auth;
};

// Loads the bot's connected Meeting Scheduling credential (full document —
// meetingProviders.service.js needs the whole meetingScheduling sub-object,
// not just a couple of fields). Returns null (not an error) when none is
// connected, same convention as getRazorpayAuth.
const getMeetingCredential = async (bot) => {
  if (!bot.toolsConfig?.meetingCredentialId) return null;
  if (bot._meetingCredCache !== undefined) return bot._meetingCredCache;

  const cred = await IntegrationCredential.findOne({
    _id: bot.toolsConfig.meetingCredentialId,
    user: bot.user,
    channel: "meeting_scheduling",
  });
  bot._meetingCredCache = cred || null;
  return bot._meetingCredCache;
};

// A "Mentors" row is required for every bookable item_id under the
// "meetings" purpose — it's what tells us WHO is being booked and WHICH
// provider actually creates the meeting (services/meetingProviders.service.js).
const resolveMentor = async (auth, itemId) => {
  const mentor = await sheets.findRow(auth.accessToken, auth.spreadsheetId, "Mentors", "item_id", itemId);
  if (!mentor) {
    throw new ApiError(400, `No "Mentors" row found for item_id "${itemId}" — add one to the Mentors tab first (provider, host_name, host_email, ...).`);
  }
  return mentor;
};

// Finds (or creates) a Users row for the given phone/email, returns the
// user_id. Used by capture_user_info, create_order, create_support_ticket
// whenever the caller only has name/phone rather than an existing user_id.
const resolveOrCreateUser = async ({ accessToken, spreadsheetId }, { user_id, name, phone, email, address }) => {
  if (user_id) {
    const existing = await sheets.findRow(accessToken, spreadsheetId, "Users", "user_id", user_id);
    if (existing) return existing;
  }
  if (phone) {
    const byPhone = await sheets.findRow(accessToken, spreadsheetId, "Users", "phone", phone);
    if (byPhone) {
      if (name || email || address) {
        return sheets.updateRowByKey(accessToken, spreadsheetId, "Users", "user_id", byPhone.user_id, {
          name: name || byPhone.name,
          email: email || byPhone.email,
          address: address || byPhone.address,
        });
      }
      return byPhone;
    }
  }
  if (!name && !phone && !email) return null;

  const newUser = {
    user_id: genId("USR"),
    name: name || "",
    phone: phone || "",
    email: email || "",
    address: address || "",
    created_at: new Date().toISOString(),
  };
  await sheets.appendRow(accessToken, spreadsheetId, "Users", newUser);
  return newUser;
};

// --- Individual tool implementations ---
// Each receives (auth, args, ctx) where ctx = { bot, conversation, sessionId }
// and returns a plain JSON-serializable result fed back to the LLM.

async function list_items(auth, args) {
  const rows = await sheets.getRows(auth.accessToken, auth.spreadsheetId, "Items");
  const filtered = rows.filter((r) => {
    if (r.status && r.status !== "active") return false;
    if (args.item_type && args.item_type !== "any") {
      const wantsStock = args.item_type === "product";
      if (isStockTracked(r.item_type) !== wantsStock) return false;
    }
    if (args.category && String(r.category).toLowerCase() !== String(args.category).toLowerCase()) return false;
    if (args.keyword) {
      const kw = args.keyword.toLowerCase();
      if (!`${r.name} ${r.description}`.toLowerCase().includes(kw)) return false;
    }
    return true;
  });
  return {
    items: filtered.slice(0, 20).map((r) => ({
      item_id: r.item_id,
      name: r.name,
      item_type: r.item_type,
      category: r.category,
      price: r.price,
      currency: r.currency || "INR",
      image_url: r.image_url,
      stock_qty: isStockTracked(r.item_type) ? r.stock_qty : undefined,
    })),
  };
}

async function get_item_details(auth, args) {
  const item = await sheets.findRow(auth.accessToken, auth.spreadsheetId, "Items", "item_id", args.item_id);
  if (!item) return { found: false };
  return { found: true, item };
}

async function check_availability(auth, args) {
  const item = await sheets.findRow(auth.accessToken, auth.spreadsheetId, "Items", "item_id", args.item_id);
  if (!item) return { available: false, reason: "Item not found" };

  if (isStockTracked(item.item_type)) {
    const remaining = Number(item.stock_qty) || 0;
    return { available: remaining >= (args.qty_or_people || 1), remaining_qty: remaining };
  }

  // service — look at Availability rows for this item (+ date if given)
  const slots = await sheets.getRows(auth.accessToken, auth.spreadsheetId, "Availability");
  const matching = slots.filter((s) => s.item_id === args.item_id && s.status !== "closed" && (!args.date || s.date === args.date));
  const withSeats = matching.map((s) => ({
    date: s.date,
    time_slot: s.time_slot,
    remaining_seats: (Number(s.capacity) || 0) - (Number(s.booked_count) || 0),
  }));
  const requested = args.date ? withSeats.find((s) => s.date === args.date) : withSeats[0];
  return {
    available: !!requested && requested.remaining_seats >= (args.qty_or_people || 1),
    remaining_seats: requested?.remaining_seats ?? 0,
    alternate_slots: withSeats.filter((s) => s.remaining_seats >= (args.qty_or_people || 1)).slice(0, 5),
  };
}

async function create_order(auth, args, ctx) {
  const item = await sheets.findRow(auth.accessToken, auth.spreadsheetId, "Items", "item_id", args.item_id);
  if (!item) throw new ApiError(400, "That item wasn't found");

  const qty = Number(args.qty_or_people) || 1;
  const avail = await check_availability(auth, { item_id: args.item_id, qty_or_people: qty, date: args.date_or_slot?.split(" / ")[0] });
  if (!avail.available) return { ok: false, message: "Not enough stock/seats available for that request.", ...avail };

  const user = await resolveOrCreateUser(auth, {
    user_id: ctx.conversation?.visitor?.sheetUserId,
    name: args.name || ctx.conversation?.visitor?.name,
    phone: args.phone || ctx.conversation?.visitor?.phone,
    email: ctx.conversation?.visitor?.email,
    address: args.delivery_address,
  });
  if (!user) {
    return { ok: false, message: "Need at least a name or phone number to place this order — please ask the customer for one." };
  }

  const price = Number(item.price) || 0;
  const order = {
    order_id: genId("ORD"),
    user_id: user.user_id,
    item_id: item.item_id,
    qty_or_people: qty,
    date_or_slot: !isStockTracked(item.item_type) ? args.date_or_slot || "" : "",
    delivery_address: isStockTracked(item.item_type) ? args.delivery_address || "" : "",
    total_amount: price * qty,
    order_status: "pending",
    payment_status: "unpaid",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await sheets.appendRow(auth.accessToken, auth.spreadsheetId, "Orders", order);

  // side effects — decrement stock / increment booked_count
  if (isStockTracked(item.item_type)) {
    await sheets.updateRowByKey(auth.accessToken, auth.spreadsheetId, "Items", "item_id", item.item_id, {
      stock_qty: Math.max(0, (Number(item.stock_qty) || 0) - qty),
    });
  } else {
    const [date] = (args.date_or_slot || "").split(" / ");
    const slots = await sheets.getRows(auth.accessToken, auth.spreadsheetId, "Availability");
    const slot = slots.find((s) => s.item_id === item.item_id && (s.date === date || s.time_slot === args.date_or_slot));
    if (slot) {
      await sheets.updateRowByKey(auth.accessToken, auth.spreadsheetId, "Availability", "item_id", slot.item_id, {
        booked_count: (Number(slot.booked_count) || 0) + qty,
      });
    }
  }

  // Order confirmation email — billing details + what was ordered, per the
  // product spec. Fires for every order type (not just meetings); meeting
  // bookings additionally get the richer sendBookingConfirmationEmail from
  // book_meeting once the actual slot/link exists. Never blocks the order
  // itself on email delivery — a bounced/misconfigured mailbox shouldn't
  // fail the order.
  if (emailsEnabled(ctx.bot) && user.email) {
    botEmail.sendOrderConfirmationEmail({ bot: ctx.bot, to: user.email, billing: user, order, item }).catch((err) => {
      logger.error(`[botTools] order confirmation email failed: ${err.message}`);
    });
  }

  return { ok: true, order_id: order.order_id, status: order.order_status, total_amount: order.total_amount, sheet_user_id: user.user_id };
}

async function update_order(auth, args) {
  const order = await sheets.findRow(auth.accessToken, auth.spreadsheetId, "Orders", "order_id", args.order_id);
  if (!order) return { ok: false, message: "Order not found" };
  if (!["pending", "confirmed"].includes(order.order_status)) {
    return { ok: false, message: `Can't modify an order that's already ${order.order_status}` };
  }
  const patch = { updated_at: new Date().toISOString() };
  if (args.qty_or_people !== undefined) patch.qty_or_people = args.qty_or_people;
  if (args.date_or_slot !== undefined) patch.date_or_slot = args.date_or_slot;
  if (args.delivery_address !== undefined) patch.delivery_address = args.delivery_address;
  const updated = await sheets.updateRowByKey(auth.accessToken, auth.spreadsheetId, "Orders", "order_id", args.order_id, patch);
  return { ok: true, order: updated };
}

async function cancel_order(auth, args) {
  const order = await sheets.findRow(auth.accessToken, auth.spreadsheetId, "Orders", "order_id", args.order_id);
  if (!order) return { ok: false, message: "Order not found" };
  if (["cancelled", "completed"].includes(order.order_status)) {
    return { ok: false, message: `Order is already ${order.order_status}` };
  }

  await sheets.updateRowByKey(auth.accessToken, auth.spreadsheetId, "Orders", "order_id", args.order_id, {
    order_status: "cancelled",
    updated_at: new Date().toISOString(),
  });

  // release stock/slot
  const item = await sheets.findRow(auth.accessToken, auth.spreadsheetId, "Items", "item_id", order.item_id);
  if (item && isStockTracked(item.item_type)) {
    await sheets.updateRowByKey(auth.accessToken, auth.spreadsheetId, "Items", "item_id", item.item_id, {
      stock_qty: (Number(item.stock_qty) || 0) + (Number(order.qty_or_people) || 0),
    });
  } else if (item) {
    const [date] = (order.date_or_slot || "").split(" / ");
    const slots = await sheets.getRows(auth.accessToken, auth.spreadsheetId, "Availability");
    const slot = slots.find((s) => s.item_id === item.item_id && (s.date === date || s.time_slot === order.date_or_slot));
    if (slot) {
      await sheets.updateRowByKey(auth.accessToken, auth.spreadsheetId, "Availability", "item_id", slot.item_id, {
        booked_count: Math.max(0, (Number(slot.booked_count) || 0) - (Number(order.qty_or_people) || 0)),
      });
    }
  }

  return {
    ok: true,
    order_id: args.order_id,
    status: "cancelled",
    refund_needed: order.payment_status === "paid",
  };
}

async function get_order_status(auth, args) {
  let order = null;
  if (args.order_id) {
    order = await sheets.findRow(auth.accessToken, auth.spreadsheetId, "Orders", "order_id", args.order_id);
  } else if (args.phone_number) {
    const user = await sheets.findRow(auth.accessToken, auth.spreadsheetId, "Users", "phone", args.phone_number);
    if (user) {
      const orders = await sheets.getRows(auth.accessToken, auth.spreadsheetId, "Orders");
      const mine = orders.filter((o) => o.user_id === user.user_id).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      order = mine[0] || null;
    }
  }
  if (!order) return { found: false };

  const item = await sheets.findRow(auth.accessToken, auth.spreadsheetId, "Items", "item_id", order.item_id);
  return { found: true, order, item_name: item?.name };
}

async function get_order_history(auth, args) {
  const user = await sheets.findRow(auth.accessToken, auth.spreadsheetId, "Users", "phone", args.phone_number);
  if (!user) return { orders: [] };
  const orders = await sheets.getRows(auth.accessToken, auth.spreadsheetId, "Orders");
  const mine = orders
    .filter((o) => o.user_id === user.user_id)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 15);
  return { orders: mine };
}

async function create_payment_link(auth, args, ctx) {
  const order = await sheets.findRow(auth.accessToken, auth.spreadsheetId, "Orders", "order_id", args.order_id);
  if (!order) return { ok: false, message: "Order not found" };

  const amount = args.amount ?? order.total_amount;
  const razorpayAuth = await getRazorpayAuth(ctx.bot);

  const payment = {
    payment_id: genId("PAY"),
    order_id: args.order_id,
    amount,
    status: "pending",
    method: "",
    paid_at: "",
    gateway_ref: "",
    gateway_payment_id: "",
    payment_link_url: "",
  };

  if (razorpayAuth) {
    const user = order.user_id
      ? await sheets.findRow(auth.accessToken, auth.spreadsheetId, "Users", "user_id", order.user_id)
      : null;

    const link = await razorpayService.createPaymentLink({
      ...razorpayAuth,
      amount: Math.round(Number(amount) * 100), // rupees -> paise
      currency: "INR",
      description: `Order ${args.order_id}`,
      customer: user ? { name: user.name || undefined, contact: user.phone || undefined, email: user.email || undefined } : undefined,
      notes: { order_id: args.order_id },
      referenceId: args.order_id,
    });

    payment.gateway_ref = link.id;
    payment.payment_link_url = link.short_url;
    await sheets.appendRow(auth.accessToken, auth.spreadsheetId, "Payments", payment);

    return {
      ok: true,
      payment_id: payment.payment_id,
      amount,
      payment_link: link.short_url,
      instructions: "Send the customer this real payment link — it's a hosted Razorpay checkout page.",
    };
  }

  // No Razorpay connected — sheet-only bookkeeping, as before.
  await sheets.appendRow(auth.accessToken, auth.spreadsheetId, "Payments", payment);
  return {
    ok: true,
    payment_id: payment.payment_id,
    amount,
    instructions: ctx.bot?.toolsConfig?.paymentInstructions ||
      "We've noted this order as pending payment — our team will share payment details shortly.",
  };
}

// Fires payment-received (+ finalizes a meeting booking, if this order is
// one) the moment a payment first flips to "success". Never blocks the
// status response on email/meeting-creation trouble — those are reported
// via logger, not thrown, since the payment itself already succeeded.
async function finalizePaidOrder(auth, orderId, ctx) {
  const order = await sheets.findRow(auth.accessToken, auth.spreadsheetId, "Orders", "order_id", orderId);
  if (!order) return;
  const item = await sheets.findRow(auth.accessToken, auth.spreadsheetId, "Items", "item_id", order.item_id);
  const user = order.user_id ? await sheets.findRow(auth.accessToken, auth.spreadsheetId, "Users", "user_id", order.user_id) : null;
  const paymentsRows = await sheets.getRows(auth.accessToken, auth.spreadsheetId, "Payments");
  const payment = paymentsRows.filter((p) => p.order_id === orderId).sort((a, b) => (a.payment_id < b.payment_id ? 1 : -1))[0];

  let booking = null;
  if (item && String(item.item_type).toLowerCase() === "meeting") {
    booking = await sheets.findRow(auth.accessToken, auth.spreadsheetId, "Bookings", "order_id", orderId);
    if (booking && booking.status === "pending_payment") {
      try {
        const mentor = await resolveMentor(auth, item.item_id);
        const meetingCred = await getMeetingCredential(ctx.bot);
        let created = { meeting_link: "", meeting_id: "", provider_status: "confirmed" };
        if (meetingCred) {
          created = await meetingProviders.createMeeting({
            credential: meetingCred,
            mentor,
            item,
            date: booking.date,
            timeSlot: booking.time_slot,
            attendee: { name: booking.attendee_name, email: booking.attendee_email, phone: booking.attendee_phone },
          });
        }
        booking = await sheets.updateRowByKey(auth.accessToken, auth.spreadsheetId, "Bookings", "booking_id", booking.booking_id, {
          meeting_link: created.meeting_link || "",
          meeting_id: created.meeting_id || "",
          status: "confirmed",
          updated_at: new Date().toISOString(),
        });
        await sheets.updateRowByKey(auth.accessToken, auth.spreadsheetId, "Orders", "order_id", orderId, {
          order_status: "confirmed",
          updated_at: new Date().toISOString(),
        });
      } catch (err) {
        logger.error(`[botTools] finalizing meeting for order ${orderId} failed: ${err.message}`);
      }
    }
  }

  if (emailsEnabled(ctx.bot) && user?.email) {
    botEmail.sendPaymentReceivedEmail({ bot: ctx.bot, to: user.email, billing: user, order, payment, item, booking }).catch((err) => {
      logger.error(`[botTools] payment-received email failed: ${err.message}`);
    });
    if (booking && booking.status === "confirmed") {
      botEmail.sendBookingConfirmationEmail({ bot: ctx.bot, to: user.email, billing: user, order, booking, item, mentor: null }).catch((err) => {
        logger.error(`[botTools] booking confirmation email failed: ${err.message}`);
      });
    }
  }
}

async function verify_payment_status(auth, args, ctx) {
  const payments = await sheets.getRows(auth.accessToken, auth.spreadsheetId, "Payments");
  const payment = payments.filter((p) => p.order_id === args.order_id).sort((a, b) => (a.payment_id < b.payment_id ? 1 : -1))[0];
  if (!payment) return { found: false };

  const razorpayAuth = await getRazorpayAuth(ctx.bot);
  if (razorpayAuth && payment.gateway_ref) {
    const link = await razorpayService.getPaymentLink({ ...razorpayAuth, paymentLinkId: payment.gateway_ref });
    const paidEntry = (link.payments || []).find((p) => p.status === "captured");
    const status = link.status === "paid" ? "success" : link.status === "expired" || link.status === "cancelled" ? "failed" : "pending";
    const wasAlreadySuccess = payment.status === "success";

    await sheets.updateRowByKey(auth.accessToken, auth.spreadsheetId, "Payments", "payment_id", payment.payment_id, {
      status,
      gateway_payment_id: paidEntry?.payment_id || payment.gateway_payment_id,
      paid_at: status === "success" ? new Date().toISOString() : payment.paid_at,
    });
    if (status === "success") {
      await sheets.updateRowByKey(auth.accessToken, auth.spreadsheetId, "Orders", "order_id", args.order_id, {
        payment_status: "paid",
        updated_at: new Date().toISOString(),
      });
      if (!wasAlreadySuccess) await finalizePaidOrder(auth, args.order_id, ctx);
    }
    return { found: true, status, amount: payment.amount, payment_link: payment.payment_link_url || null };
  }

  return { found: true, status: payment.status, amount: payment.amount, paid_at: payment.paid_at || null };
}

async function initiate_refund(auth, args, ctx) {
  const payments = await sheets.getRows(auth.accessToken, auth.spreadsheetId, "Payments");
  const payment = payments.find((p) => p.order_id === args.order_id && p.status === "success");
  if (!payment) return { ok: false, message: "No successful payment found for that order to refund" };

  const razorpayAuth = await getRazorpayAuth(ctx.bot);
  if (razorpayAuth && payment.gateway_payment_id) {
    const refund = await razorpayService.refundPayment({
      ...razorpayAuth,
      paymentId: payment.gateway_payment_id,
      notes: { order_id: args.order_id, reason: args.reason || "" },
    });
    await sheets.updateRowByKey(auth.accessToken, auth.spreadsheetId, "Payments", "payment_id", payment.payment_id, {
      status: "refunded",
    });
    await sheets.updateRowByKey(auth.accessToken, auth.spreadsheetId, "Orders", "order_id", args.order_id, {
      payment_status: "refunded",
      updated_at: new Date().toISOString(),
    });
    return { ok: true, refund_id: refund.id, status: refund.status, note: "Refund submitted to Razorpay for real — funds return to the customer per Razorpay's normal refund timeline." };
  }

  // No Razorpay connected (or no captured payment id on file) — log only.
  await sheets.updateRowByKey(auth.accessToken, auth.spreadsheetId, "Payments", "payment_id", payment.payment_id, {
    status: "refunded",
  });
  await sheets.updateRowByKey(auth.accessToken, auth.spreadsheetId, "Orders", "order_id", args.order_id, {
    payment_status: "refunded",
    updated_at: new Date().toISOString(),
  });
  return {
    ok: true,
    payment_id: payment.payment_id,
    status: "refunded",
    note: "Logged for the team to action — no Razorpay account is connected, so this doesn't move money automatically.",
  };
}

// --- Meeting bookings (1-on-1s — Google Meet / Cal.com / Calendly) ---

async function list_mentors(auth, args) {
  const items = await sheets.getRows(auth.accessToken, auth.spreadsheetId, "Items");
  const mentorRows = await sheets.getRows(auth.accessToken, auth.spreadsheetId, "Mentors");
  const mentorByItem = new Map(mentorRows.map((m) => [m.item_id, m]));

  const meetingItems = items.filter((r) => {
    if (r.status && r.status !== "active") return false;
    if (String(r.item_type).toLowerCase() !== "meeting") return false;
    if (args.keyword) {
      const kw = args.keyword.toLowerCase();
      if (!`${r.name} ${r.description}`.toLowerCase().includes(kw)) return false;
    }
    return true;
  });

  return {
    mentors: meetingItems.slice(0, 20).map((r) => {
      const mentor = mentorByItem.get(r.item_id) || {};
      return {
        item_id: r.item_id,
        name: r.name,
        description: r.description,
        price: r.price,
        currency: r.currency || "INR",
        duration_mins: r.duration_mins,
        host_name: mentor.host_name || "",
        provider: mentor.provider || "",
      };
    }),
  };
}

async function book_meeting(auth, args, ctx) {
  const item = await sheets.findRow(auth.accessToken, auth.spreadsheetId, "Items", "item_id", args.item_id);
  if (!item) throw new ApiError(400, "That mentor/item wasn't found");

  const mentor = await resolveMentor(auth, args.item_id);

  const avail = await check_availability(auth, { item_id: args.item_id, qty_or_people: 1, date: args.date });
  if (!avail.available) {
    return { ok: false, message: "That date/slot isn't available.", ...avail };
  }

  if (!args.email) {
    return { ok: false, message: "An email address is required to send the meeting confirmation/join link — please ask the customer for one." };
  }

  const user = await resolveOrCreateUser(auth, {
    user_id: ctx.conversation?.visitor?.sheetUserId,
    name: args.name || ctx.conversation?.visitor?.name,
    phone: args.phone || ctx.conversation?.visitor?.phone,
    email: args.email,
  });
  if (!user) return { ok: false, message: "Need at least a name, phone, or email to book this." };

  const price = Number(item.price) || 0;
  const now = new Date().toISOString();
  const order = {
    order_id: genId("ORD"),
    user_id: user.user_id,
    item_id: item.item_id,
    qty_or_people: 1,
    date_or_slot: `${args.date} / ${args.time_slot}`,
    delivery_address: "",
    total_amount: price,
    order_status: price > 0 ? "pending" : "confirmed",
    payment_status: price > 0 ? "unpaid" : "paid",
    created_at: now,
    updated_at: now,
  };
  await sheets.appendRow(auth.accessToken, auth.spreadsheetId, "Orders", order);

  // hold the slot immediately — same as create_order's service path
  const slots = await sheets.getRows(auth.accessToken, auth.spreadsheetId, "Availability");
  const slot = slots.find((s) => s.item_id === item.item_id && (s.date === args.date || s.time_slot === args.time_slot));
  if (slot) {
    await sheets.updateRowByKey(auth.accessToken, auth.spreadsheetId, "Availability", "item_id", slot.item_id, {
      booked_count: (Number(slot.booked_count) || 0) + 1,
    });
  }

  const attendee = { name: user.name || args.name, email: args.email, phone: user.phone || args.phone };
  let created = { meeting_link: "", meeting_id: "", provider_status: "confirmed" };
  const meetingCred = await getMeetingCredential(ctx.bot);

  if (price === 0) {
    // Free — create the real meeting right away.
    if (meetingCred) {
      try {
        created = await meetingProviders.createMeeting({ credential: meetingCred, mentor, item, date: args.date, timeSlot: args.time_slot, attendee });
      } catch (err) {
        logger.error(`[botTools] book_meeting provider create failed: ${err.message}`);
        // still record the booking — the mentor/team can complete scheduling manually
      }
    }
  }

  const booking = {
    booking_id: genId("MTG"),
    order_id: order.order_id,
    item_id: item.item_id,
    user_id: user.user_id,
    provider: mentor.provider || "",
    date: args.date,
    time_slot: args.time_slot,
    timezone: mentor.timezone || "",
    meeting_link: created.meeting_link || "",
    meeting_id: created.meeting_id || "",
    host_email: mentor.host_email || "",
    attendee_name: attendee.name || "",
    attendee_email: attendee.email || "",
    attendee_phone: attendee.phone || "",
    status: price > 0 ? "pending_payment" : "confirmed",
    created_at: now,
    updated_at: now,
  };
  await sheets.appendRow(auth.accessToken, auth.spreadsheetId, "Bookings", booking);

  if (price === 0) {
    if (emailsEnabled(ctx.bot)) {
      botEmail.sendBookingConfirmationEmail({ bot: ctx.bot, to: attendee.email, billing: user, order, booking, item, mentor }).catch((err) => {
        logger.error(`[botTools] booking confirmation email failed: ${err.message}`);
      });
    }
    return {
      ok: true,
      order_id: order.order_id,
      booking_id: booking.booking_id,
      status: "confirmed",
      meeting_link: booking.meeting_link || null,
      note: booking.meeting_link ? undefined : "No meeting-scheduling provider is connected — share the meeting link with the customer manually once arranged.",
    };
  }

  // Paid — create a real payment link (or fall back to pending bookkeeping),
  // same behavior as create_payment_link. The actual meeting is only
  // created once payment is verified (see finalizePaidOrder above), so we
  // never book a real calendar slot before money changes hands.
  const paymentResult = await create_payment_link(auth, { order_id: order.order_id, amount: price }, ctx);

  return {
    ok: true,
    order_id: order.order_id,
    booking_id: booking.booking_id,
    status: "pending_payment",
    ...paymentResult,
  };
}

async function get_booking_details(auth, args) {
  const booking = args.booking_id
    ? await sheets.findRow(auth.accessToken, auth.spreadsheetId, "Bookings", "booking_id", args.booking_id)
    : args.order_id
    ? await sheets.findRow(auth.accessToken, auth.spreadsheetId, "Bookings", "order_id", args.order_id)
    : null;
  if (!booking) return { found: false };

  const item = await sheets.findRow(auth.accessToken, auth.spreadsheetId, "Items", "item_id", booking.item_id);
  return { found: true, booking, item_name: item?.name };
}

async function cancel_meeting_booking(auth, args, ctx) {
  const booking = args.booking_id
    ? await sheets.findRow(auth.accessToken, auth.spreadsheetId, "Bookings", "booking_id", args.booking_id)
    : args.order_id
    ? await sheets.findRow(auth.accessToken, auth.spreadsheetId, "Bookings", "order_id", args.order_id)
    : null;
  if (!booking) return { ok: false, message: "Booking not found" };
  if (booking.status === "cancelled") return { ok: false, message: "This booking is already cancelled" };

  const order = await sheets.findRow(auth.accessToken, auth.spreadsheetId, "Orders", "order_id", booking.order_id);
  const item = await sheets.findRow(auth.accessToken, auth.spreadsheetId, "Items", "item_id", booking.item_id);
  const user = booking.user_id ? await sheets.findRow(auth.accessToken, auth.spreadsheetId, "Users", "user_id", booking.user_id) : null;

  await sheets.updateRowByKey(auth.accessToken, auth.spreadsheetId, "Bookings", "booking_id", booking.booking_id, {
    status: "cancelled",
    updated_at: new Date().toISOString(),
  });
  if (order && !["cancelled", "completed"].includes(order.order_status)) {
    await sheets.updateRowByKey(auth.accessToken, auth.spreadsheetId, "Orders", "order_id", booking.order_id, {
      order_status: "cancelled",
      updated_at: new Date().toISOString(),
    });
  }

  // release the slot
  const slots = await sheets.getRows(auth.accessToken, auth.spreadsheetId, "Availability");
  const slot = slots.find((s) => s.item_id === booking.item_id && (s.date === booking.date || s.time_slot === booking.time_slot));
  if (slot) {
    await sheets.updateRowByKey(auth.accessToken, auth.spreadsheetId, "Availability", "item_id", slot.item_id, {
      booked_count: Math.max(0, (Number(slot.booked_count) || 0) - 1),
    });
  }

  // best-effort — cancel the real meeting/event too, if one exists
  if (booking.meeting_id) {
    try {
      const mentor = await sheets.findRow(auth.accessToken, auth.spreadsheetId, "Mentors", "item_id", booking.item_id);
      const meetingCred = await getMeetingCredential(ctx.bot);
      if (meetingCred) await meetingProviders.cancelMeeting({ credential: meetingCred, mentor, provider: booking.provider, meetingId: booking.meeting_id });
    } catch (err) {
      logger.error(`[botTools] cancelling provider meeting failed: ${err.message}`);
    }
  }

  if (emailsEnabled(ctx.bot) && user?.email) {
    botEmail.sendBookingCancelledEmail({ bot: ctx.bot, to: user.email, billing: user, order, item }).catch((err) => {
      logger.error(`[botTools] booking cancellation email failed: ${err.message}`);
    });
  }

  return { ok: true, booking_id: booking.booking_id, status: "cancelled", refund_needed: order?.payment_status === "paid" };
}

async function capture_user_info(auth, args, ctx) {
  const user = await resolveOrCreateUser(auth, args);
  if (!user) return { ok: false, message: "Provide at least a name or phone number" };
  if (ctx.conversation) ctx.conversation.visitor.sheetUserId = user.user_id;
  return { ok: true, user_id: user.user_id };
}

async function get_user_profile(auth, args, ctx) {
  const user = await sheets.findRow(auth.accessToken, auth.spreadsheetId, "Users", "phone", args.phone_number);
  if (!user) return { found: false };
  if (ctx.conversation) ctx.conversation.visitor.sheetUserId = user.user_id;
  return { found: true, profile: user };
}

async function search_faq_kb(auth, args, ctx) {
  const chunks = await ragService.retrieveRelevantChunks(ctx.bot._id, args.query, ctx.bot.embeddingConfig);
  if (!chunks.length) return { answer: null, source: null };
  return { answer: chunks.map((c) => c.content).join("\n\n"), source: "knowledge base" };
}

// One open ticket per user at a time, full stop — not scoped to category,
// order, or a time window. If this user already has ANY ticket with
// status "open", every subsequent create_support_ticket call just returns
// that same ticket instead of opening a new one, no matter what the new
// issue is about. A second, genuinely different problem gets folded into
// the same open ticket rather than fragmenting into parallel tickets your
// team then has to de-duplicate by hand; support can always split it back
// out on their end if it turns out to be unrelated.
async function create_support_ticket(auth, args, ctx) {
  const user = await resolveOrCreateUser(auth, {
    user_id: ctx.conversation?.visitor?.sheetUserId,
    phone: args.phone || ctx.conversation?.visitor?.phone,
    name: ctx.conversation?.visitor?.name,
  });

  if (user?.user_id) {
    const allTickets = await sheets.getRows(auth.accessToken, auth.spreadsheetId, "Tickets");
    const openTicket = allTickets.find((t) => t.user_id === user.user_id && t.status === "open");
    if (openTicket) {
      return { ok: true, ticket_id: openTicket.ticket_id, duplicate: true, message: "You already have an open ticket — reusing it instead of creating a new one." };
    }
  }

  const ticket = {
    ticket_id: genId("TKT"),
    user_id: user?.user_id || "",
    order_id: args.order_id || "",
    category: args.category,
    description: args.description,
    status: "open",
    created_at: new Date().toISOString(),
  };
  await sheets.appendRow(auth.accessToken, auth.spreadsheetId, "Tickets", ticket);
  return { ok: true, ticket_id: ticket.ticket_id };
}

async function escalate_to_human(auth, args, ctx) {
  if (!ctx.sessionId) return { ok: false, message: "No active session to escalate" };
  try {
    const result = await handoverService.requestHandover(ctx.bot, ctx.sessionId);
    return { ok: true, offHours: !!result.offHours, message: result.message || "Connecting to a human agent" };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

const IMPLEMENTATIONS = {
  list_items,
  get_item_details,
  check_availability,
  create_order,
  update_order,
  cancel_order,
  get_order_status,
  get_order_history,
  create_payment_link,
  verify_payment_status,
  initiate_refund,
  list_mentors,
  book_meeting,
  get_booking_details,
  cancel_meeting_booking,
  capture_user_info,
  get_user_profile,
  search_faq_kb,
  create_support_ticket,
  escalate_to_human,
};

// Entry point used by the tool-calling orchestrator. `ctx` = { bot, conversation, sessionId }.
const executeTool = async (bot, name, args, ctx) => {
  const impl = IMPLEMENTATIONS[name];
  if (!impl) return { error: `Unknown tool "${name}"` };

  try {
    const auth = name === "search_faq_kb" || name === "escalate_to_human" ? null : await getSheetAuth(bot);
    return await impl(auth, args || {}, { ...ctx, bot });
  } catch (err) {
    logger.error(`[botTools] ${name} failed: ${err.message}`);
    return { error: err.message || "Tool call failed" };
  }
};

module.exports = { executeTool, getSheetAuth };