const mongoose = require("mongoose");

// One row per add-on a user owns (or has owned). Mirrors Subscription's
// shape closely on purpose — same status lifecycle, same Razorpay fields —
// but stays independent of Plan/Subscription since an add-on is sold
// alongside a plan, not instead of one.
const userAddOnSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    addOn: { type: mongoose.Schema.Types.ObjectId, ref: "AddOn", required: true },

    // How this record came to exist.
    source: {
      type: String,
      enum: ["razorpay", "admin_grant"],
      required: true,
      default: "razorpay",
    },

    currency: { type: String, enum: ["inr", "usd"], required: true, default: "inr" },
    amount: { type: Number, required: true, default: 0 }, // 0 for admin-granted

    status: {
      type: String,
      enum: ["created", "active", "expired", "cancelled"],
      default: "created",
    },

    // Razorpay identifiers — absent when source === "admin_grant"
    razorpayOrderId: { type: String },
    razorpayPaymentId: { type: String },
    razorpaySignature: { type: String },

    startDate: { type: Date },
    endDate: { type: Date, default: null }, // null = lifetime, never expires

    // Snapshot of the limit granted at purchase/grant time, so a later
    // catalog price/limit change never rewrites what an existing buyer
    // already owns.
    limit: {
      amount: { type: Number, default: null },
      unit: { type: String, default: null },
    },

    // --- Admin-grant audit trail ---
    grantedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    note: { type: String, default: null },
  },
  { timestamps: true }
);

userAddOnSchema.index({ user: 1, status: 1 });

module.exports = mongoose.model("UserAddOn", userAddOnSchema);