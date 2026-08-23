const transporter = require("../config/mailer");
const logger = require("../utils/logger");
const credentialEmailSender = require("./credentialEmailSender.service");
const { getDefaultCredential } = require("./integrationCredential.service");

// ---------------------------------------------------------------------------
// Sends order/booking/payment confirmation emails to a BOT'S OWN CUSTOMER
// (the visitor placing the order/booking) — not to be confused with
// services/email.service.js, which sends JestBot's own platform emails
// (OTP, subscription receipts) to the bot OWNER.
//
// Delivery uses the bot owner's connected Email credential (Credentials →
// Email & Sheets) so the message actually comes from their own inbox/
// domain, exactly the same resolution otpDelivery.service.js uses for lead-
// verification OTPs. Falls back to the platform SMTP transporter (branded
// with the bot's own name in the From header) if the owner hasn't
// connected one yet, so this keeps working out of the box.
//
// Every send here is gated by the CALLER checking
// bot.toolsConfig.sendCustomerEmails !== false first (default true — see
// botTools.service.js) — this file itself doesn't apply that toggle, so it
// stays a plain "send this email" module.
// ---------------------------------------------------------------------------

const money = (amount, currency) => `${currency || "INR"} ${Number(amount || 0).toFixed(2)}`;

const shell = (botName, bodyHtml) => `
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${botName}</title>
    </head>
    <body style="margin:0; padding:0; background-color:#FBF9F6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FBF9F6; padding: 32px 16px;">
        <tr>
          <td align="center">
            <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px; width:100%;">
              <tr>
                <td align="center" style="padding-bottom: 20px;">
                  <div style="font-size:18px; font-weight:700; letter-spacing:-0.02em; color:#201A12;">${botName}</div>
                </td>
              </tr>
              <tr>
                <td style="background-color:#FFFFFF; border:1px solid #ECE2D3; border-radius:16px; padding:32px;">
                  ${bodyHtml}
                </td>
              </tr>
              <tr>
                <td align="center" style="padding-top: 20px;">
                  <p style="margin:0; font-size:12px; line-height:18px; color:#8A7D6B;">
                    This is an automated message from ${botName}.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>
`;

const heading = (text) =>
  `<h2 style="margin:0 0 14px; font-size:20px; line-height:28px; font-weight:700; color:#201A12;">${text}</h2>`;

const paragraph = (text) =>
  `<p style="margin:0 0 12px; font-size:14px; line-height:22px; color:#5B5142;">${text}</p>`;

const row = (label, value) =>
  value
    ? `<tr>
        <td style="padding:6px 0; font-size:13px; color:#8A7D6B; width:40%; vertical-align:top;">${label}</td>
        <td style="padding:6px 0; font-size:13px; color:#201A12; font-weight:600; vertical-align:top;">${value}</td>
      </tr>`
    : "";

const table = (rowsHtml) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0; border-top:1px solid #ECE2D3; border-bottom:1px solid #ECE2D3; padding:4px 0;">${rowsHtml}</table>`;

const linkButton = (label, href) =>
  href
    ? `<div style="margin: 20px 0;">
        <a href="${href}" style="display:inline-block; background-color:#FF6A1A; color:#FFFFFF; font-size:14px; font-weight:600; text-decoration:none; padding:12px 22px; border-radius:10px;">${label}</a>
      </div>`
    : "";

// Renders the shared "Billing details" + "Item" block used by every
// confirmation email below — name/email/address/mobile plus what was
// ordered/booked, exactly the fields the product owner asked for.
const billingBlock = ({ billing = {}, item, order }) =>
  table(
    [
      row("Order ID", order?.order_id),
      row("Item", item?.name),
      row("Quantity / people", order?.qty_or_people),
      row("Date / slot", order?.date_or_slot),
      row("Amount", order?.total_amount !== undefined ? money(order.total_amount, item?.currency) : undefined),
      row("Name", billing.name),
      row("Email", billing.email),
      row("Mobile", billing.phone),
      row("Address", billing.address),
    ].join("")
  );

async function deliver(bot, { to, subject, html, text }) {
  if (!to) return; // no email on file for this customer — nothing to send
  const cred = await getDefaultCredential(bot.user, "email").catch(() => null);

  if (cred) {
    try {
      await credentialEmailSender.sendEmail(cred, { to, subject, html, text });
      return;
    } catch (err) {
      logger.error(`[Bot email] Send failed via credential ${cred._id}, falling back to platform SMTP: ${err.message}`);
      await cred.markFailed(err.message).catch(() => {});
      // fall through to the platform transporter below rather than losing the email
    }
  }

  try {
    await transporter.sendMail({
      from: `"${bot.name || "JestBot"}" <${process.env.EMAIL_FROM}>`,
      to,
      subject,
      html,
      text,
    });
  } catch (err) {
    logger.error(`[Bot email] Platform SMTP fallback also failed for bot ${bot._id}: ${err.message}`);
  }
}

// --- Order confirmation (products, and non-meeting services) ---
const sendOrderConfirmationEmail = async ({ bot, to, billing, order, item }) => {
  const botName = bot.name || "Your order";
  const bodyHtml = `
    ${heading("Order confirmed")}
    ${paragraph(`Thanks${billing?.name ? ` ${billing.name}` : ""}! Here's a summary of your order.`)}
    ${billingBlock({ billing, item, order })}
    ${paragraph(
      order?.payment_status === "paid"
        ? "Payment has been received in full."
        : "This order is currently marked as unpaid — you'll get a separate email once payment is confirmed."
    )}
  `;
  await deliver(bot, {
    to,
    subject: `${botName} — Order confirmed (${order?.order_id || ""})`,
    html: shell(botName, bodyHtml),
    text: `Order confirmed. Order ID: ${order?.order_id}. Item: ${item?.name}.`,
  });
};

// --- Booking confirmation (1-on-1 meetings) — includes the real join link ---
const sendBookingConfirmationEmail = async ({ bot, to, billing, order, booking, item, mentor }) => {
  const botName = bot.name || "Your booking";
  const isCustomerSchedules = booking?.provider_status === "customer_schedules";
  const bodyHtml = `
    ${heading(isCustomerSchedules ? "Pick your time" : "Meeting booked")}
    ${paragraph(`Thanks${billing?.name ? ` ${billing.name}` : ""}! ${
      isCustomerSchedules
        ? "Your slot is reserved — finish picking an exact time on the link below."
        : "Your 1-on-1 meeting is confirmed. Details are below."
    }`)}
    ${billingBlock({ billing, item, order })}
    ${table(
      [
        row("Host", mentor?.host_name),
        row("Date", booking?.date),
        row("Time", booking?.time_slot),
        row("Timezone", booking?.timezone),
      ].join("")
    )}
    ${linkButton(isCustomerSchedules ? "Choose your time" : "Join the meeting", booking?.meeting_link)}
    ${
      order?.payment_status && order.payment_status !== "paid"
        ? paragraph("This booking is currently marked as unpaid — you'll get a separate email once payment is confirmed.")
        : ""
    }
  `;
  await deliver(bot, {
    to,
    subject: `${botName} — Meeting ${isCustomerSchedules ? "reserved" : "confirmed"} (${order?.order_id || ""})`,
    html: shell(botName, bodyHtml),
    text: `Meeting ${isCustomerSchedules ? "reserved" : "confirmed"}. ${booking?.meeting_link || ""}`,
  });
};

// --- Payment received (sent for both plain orders and meeting bookings once payment clears) ---
const sendPaymentReceivedEmail = async ({ bot, to, billing, order, payment, item, booking }) => {
  const botName = bot.name || "Payment received";
  const bodyHtml = `
    ${heading("Payment received")}
    ${paragraph(`We've received your payment${billing?.name ? `, ${billing.name}` : ""}. Here are the full details.`)}
    ${billingBlock({ billing, item, order })}
    ${table(
      [
        row("Amount paid", payment?.amount !== undefined ? money(payment.amount, item?.currency) : undefined),
        row("Payment ID", payment?.payment_id),
        row("Paid at", payment?.paid_at ? new Date(payment.paid_at).toLocaleString() : undefined),
      ].join("")
    )}
    ${booking?.meeting_link ? linkButton("Join the meeting", booking.meeting_link) : ""}
    ${paragraph("This completes your order — thanks for booking with us!")}
  `;
  await deliver(bot, {
    to,
    subject: `${botName} — Payment received (${order?.order_id || ""})`,
    html: shell(botName, bodyHtml),
    text: `Payment received for order ${order?.order_id}.`,
  });
};

// --- Booking cancelled ---
const sendBookingCancelledEmail = async ({ bot, to, billing, order, item }) => {
  const botName = bot.name || "Booking cancelled";
  const bodyHtml = `
    ${heading("Booking cancelled")}
    ${paragraph(`This confirms your booking has been cancelled${billing?.name ? `, ${billing.name}` : ""}.`)}
    ${billingBlock({ billing, item, order })}
    ${
      order?.payment_status === "refunded"
        ? paragraph("A refund has been initiated and will reach you per your payment provider's normal timeline.")
        : ""
    }
  `;
  await deliver(bot, {
    to,
    subject: `${botName} — Booking cancelled (${order?.order_id || ""})`,
    html: shell(botName, bodyHtml),
    text: `Booking cancelled. Order ID: ${order?.order_id}.`,
  });
};

module.exports = {
  sendOrderConfirmationEmail,
  sendBookingConfirmationEmail,
  sendPaymentReceivedEmail,
  sendBookingCancelledEmail,
};
