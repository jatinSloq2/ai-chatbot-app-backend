const mongoose = require("mongoose");

/**
 * Append-only ledger behind User.wallet.{inr,usd}. Every credit/debit goes
 * through services/wallet.service.js, which writes one of these AND updates
 * the running balance on the User doc in the same call — this collection
 * is the audit trail (and the source of truth if the two ever need to be
 * reconciled), not the primary read path for "what's my balance".
 */
const walletTransactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: ["credit", "debit"], required: true },
    amount: { type: Number, required: true, min: 0 }, // always positive; `type` gives direction
    currency: { type: String, enum: ["inr", "usd"], required: true },

    // Extensible on purpose — "gift_card" / other consumables mentioned as
    // a later addition slot in here without a schema change.
    reason: {
      type: String,
      enum: ["referral_bonus", "plan_purchase_redeem", "admin_adjustment", "refund"],
      required: true,
    },

    balanceAfter: { type: Number, required: true }, // wallet balance (that currency) after this entry

    referenceModel: { type: String }, // e.g. "ReferralReward", "Subscription"
    referenceId: { type: mongoose.Schema.Types.ObjectId },

    note: { type: String },
  },
  { timestamps: true }
);

walletTransactionSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("WalletTransaction", walletTransactionSchema);
