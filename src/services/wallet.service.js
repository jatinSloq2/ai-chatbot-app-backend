const User = require("../models/User");
const WalletTransaction = require("../models/WalletTransaction");
const ApiError = require("../utils/ApiError");

// Fetches just the wallet sub-doc for a user; throws if the user is gone
// (shouldn't happen in practice — callers always have an authenticated or
// already-looked-up user — but keeps this safe to call standalone).
const getBalance = async (userId) => {
  const user = await User.findById(userId).select("wallet");
  if (!user) throw new ApiError(404, "User not found");
  return { inr: user.wallet?.inr || 0, usd: user.wallet?.usd || 0 };
};

// Adds `amount` (smallest currency unit, must be > 0) to a user's wallet
// and writes the ledger entry in the same call. Returns the transaction.
const credit = async (userId, { amount, currency, reason, referenceModel, referenceId, note }) => {
  if (!amount || amount <= 0) throw new ApiError(400, "Credit amount must be greater than zero");
  if (!["inr", "usd"].includes(currency)) throw new ApiError(400, "Invalid currency");

  const user = await User.findById(userId);
  if (!user) throw new ApiError(404, "User not found");

  user.wallet[currency] = (user.wallet[currency] || 0) + amount;
  await user.save();

  return WalletTransaction.create({
    user: userId,
    type: "credit",
    amount,
    currency,
    reason,
    balanceAfter: user.wallet[currency],
    referenceModel,
    referenceId,
    note,
  });
};

// Subtracts `amount` from a user's wallet. Throws if the balance is
// insufficient — callers should check getBalance()/cap the redeemable
// amount before offering it to the user, this is the final guard.
const debit = async (userId, { amount, currency, reason, referenceModel, referenceId, note }) => {
  if (!amount || amount <= 0) throw new ApiError(400, "Debit amount must be greater than zero");
  if (!["inr", "usd"].includes(currency)) throw new ApiError(400, "Invalid currency");

  const user = await User.findById(userId);
  if (!user) throw new ApiError(404, "User not found");

  const current = user.wallet[currency] || 0;
  if (current < amount) throw new ApiError(400, "Insufficient wallet balance");

  user.wallet[currency] = current - amount;
  await user.save();

  return WalletTransaction.create({
    user: userId,
    type: "debit",
    amount,
    currency,
    reason,
    balanceAfter: user.wallet[currency],
    referenceModel,
    referenceId,
    note,
  });
};

const listTransactions = async (userId, { page = 1, limit = 20 } = {}) => {
  const skip = (page - 1) * limit;
  const [transactions, total] = await Promise.all([
    WalletTransaction.find({ user: userId }).sort({ createdAt: -1 }).skip(skip).limit(limit),
    WalletTransaction.countDocuments({ user: userId }),
  ]);
  return { transactions, total, page, limit };
};

module.exports = { getBalance, credit, debit, listTransactions };
