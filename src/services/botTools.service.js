const ApiError = require("../utils/ApiError");
const IntegrationCredential = require("../models/IntegrationCredential");
const sheets = require("./googleSheets.service");
const sheetsOauth = require("./googleSheetsOauth.service");
const razorpayService = require("./razorpay.service");
const ragService = require("./rag.service");
const handoverService = require("./handover.service");
const logger = require("../utils/logger");

// Short random IDs in the same style the master spec uses (ORD00123 etc).
const genId = (prefix) => `${prefix}${Date.now().toString(36).toUpperCase().slice(-4)}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

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
    if (args.item_type && r.item_type !== args.item_type) return false;
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
      stock_qty: r.item_type === "product" ? r.stock_qty : undefined,
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

  if (item.item_type === "product") {
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
    date_or_slot: item.item_type === "service" ? args.date_or_slot || "" : "",
    delivery_address: item.item_type === "product" ? args.delivery_address || "" : "",
    total_amount: price * qty,
    order_status: "pending",
    payment_status: "unpaid",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await sheets.appendRow(auth.accessToken, auth.spreadsheetId, "Orders", order);

  // side effects — decrement stock / increment booked_count
  if (item.item_type === "product") {
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
  if (item?.item_type === "product") {
    await sheets.updateRowByKey(auth.accessToken, auth.spreadsheetId, "Items", "item_id", item.item_id, {
      stock_qty: (Number(item.stock_qty) || 0) + (Number(order.qty_or_people) || 0),
    });
  } else if (item?.item_type === "service") {
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

async function verify_payment_status(auth, args, ctx) {
  const payments = await sheets.getRows(auth.accessToken, auth.spreadsheetId, "Payments");
  const payment = payments.filter((p) => p.order_id === args.order_id).sort((a, b) => (a.payment_id < b.payment_id ? 1 : -1))[0];
  if (!payment) return { found: false };

  const razorpayAuth = await getRazorpayAuth(ctx.bot);
  if (razorpayAuth && payment.gateway_ref) {
    const link = await razorpayService.getPaymentLink({ ...razorpayAuth, paymentLinkId: payment.gateway_ref });
    const paidEntry = (link.payments || []).find((p) => p.status === "captured");
    const status = link.status === "paid" ? "success" : link.status === "expired" || link.status === "cancelled" ? "failed" : "pending";

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

// How long a just-opened ticket protects against an accidental duplicate.
// Covers the case this was written for: the model (or the customer, via a
// retried "raise a ticket" message) calls this tool again for the same
// issue moments after the first call already succeeded — e.g. because the
// *next* model call in the loop timed out and the customer never actually
// saw the first ticket_id, so naturally asked again. 10 minutes is long
// enough to cover that retry window without accidentally blocking a
// genuinely new ticket the customer opens later for a different issue.
const DUPLICATE_TICKET_WINDOW_MS = 10 * 60 * 1000;

async function create_support_ticket(auth, args, ctx) {
  const user = await resolveOrCreateUser(auth, {
    user_id: ctx.conversation?.visitor?.sheetUserId,
    phone: args.phone || ctx.conversation?.visitor?.phone,
    name: ctx.conversation?.visitor?.name,
  });

  if (user?.user_id) {
    const recentRows = await sheets.getRows(auth.accessToken, auth.spreadsheetId, "Tickets");
    const cutoff = Date.now() - DUPLICATE_TICKET_WINDOW_MS;
    const dup = recentRows.find(
      (t) =>
        t.user_id === user.user_id &&
        t.status === "open" &&
        (t.order_id || "") === (args.order_id || "") &&
        t.category === args.category &&
        new Date(t.created_at).getTime() >= cutoff
    );
    if (dup) {
      return { ok: true, ticket_id: dup.ticket_id, duplicate: true };
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