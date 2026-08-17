const mongoose = require("mongoose");

const subscriptionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    plan: { type: mongoose.Schema.Types.ObjectId, ref: "Plan", required: true },

    currency: { type: String, enum: ["inr", "usd"], required: true },
    amount: { type: Number, required: true }, // paise or cents, matches `currency`

    status: {
      type: String,
      enum: ["created", "active", "expired", "cancelled", "failed"],
      default: "created",
    },

    // Razorpay identifiers
    razorpayOrderId: { type: String },
    razorpayPaymentId: { type: String },
    razorpaySignature: { type: String },

    startDate: { type: Date },
    endDate: { type: Date },

    // --- Upgrade/proration audit trail ---
    isUpgrade: { type: Boolean, default: false },
    proratedCreditApplied: { type: Number, default: 0 }, // in smallest currency unit
    upgradeDiscountApplied: { type: Number, default: 0 }, // in smallest currency unit
    listPrice: { type: Number, default: null }, // the plan's undiscounted price, for reference

    // --- Coupon (admin-managed, manually entered at checkout) ---
    couponCode: { type: String, default: null },
    couponDiscountApplied: { type: Number, default: 0 }, // in smallest currency unit

    // --- Referral offer (automatic, only for users who were themselves
    // referred, and only ever once per account — see User.referralDiscountUsed) ---
    referralDiscountApplied: { type: Number, default: 0 }, // in smallest currency unit

    // --- Wallet balance redeemed against this purchase ---
    walletAmountApplied: { type: Number, default: 0 }, // in smallest currency unit
  },
  { timestamps: true }
);

subscriptionSchema.index({ user: 1, status: 1 });

module.exports = mongoose.model("Subscription", subscriptionSchema);
