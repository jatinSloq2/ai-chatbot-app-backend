const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const referralService = require("../services/referral.service");
const walletService = require("../services/wallet.service");
const ReferralReward = require("../models/ReferralReward");

// GET /api/referral/me
const getMyReferralOverview = asyncHandler(async (req, res) => {
  const overview = await referralService.getReferralOverview(req.user._id);
  res.status(200).json({ success: true, data: overview });
});

// POST /api/referral/apply  body: { code }
// Usable once ever per account — either right after signup or later from
// the profile page. See referral.service#applyReferralCode.
const applyReferralCode = asyncHandler(async (req, res) => {
  const { code } = req.body;
  if (!code) throw new ApiError(400, "Referral code is required");

  const user = await referralService.applyReferralCode(req.user._id, code);
  res.status(200).json({
    success: true,
    message: "Referral code applied. You'll see the discount at checkout.",
    data: { referredBy: user.referredBy },
  });
});

// GET /api/referral/wallet/transactions?page=1&limit=20
const listWalletTransactions = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  const result = await walletService.listTransactions(req.user._id, { page, limit });
  res.status(200).json({ success: true, data: result });
});

// --- Admin ---

// GET /api/referral/admin/settings
const getSettings = asyncHandler(async (req, res) => {
  const settings = await referralService.getSettings();
  res.status(200).json({ success: true, data: { settings } });
});

// PUT /api/referral/admin/settings
const updateSettings = asyncHandler(async (req, res) => {
  const settings = await referralService.updateSettings(req.user._id, req.body);
  res.status(200).json({ success: true, message: "Referral settings updated", data: { settings } });
});

// GET /api/referral/admin/rewards?page=1&limit=20
const listRewards = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 20);
  const skip = (page - 1) * limit;

  const [rewards, total] = await Promise.all([
    ReferralReward.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("referrer", "name email referralCode")
      .populate("referredUser", "name email"),
    ReferralReward.countDocuments(),
  ]);

  res.status(200).json({ success: true, data: { rewards, total, page, limit } });
});

module.exports = {
  getMyReferralOverview,
  applyReferralCode,
  listWalletTransactions,
  getSettings,
  updateSettings,
  listRewards,
};
