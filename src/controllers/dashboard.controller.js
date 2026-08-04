const asyncHandler = require("../utils/asyncHandler");
const Bot = require("../models/Bot");
const Document = require("../models/Document");
const botService = require("../services/bot.service");

// GET /api/dashboard/summary
// One call for the frontend to render the main dashboard: plan, usage, bots overview.
const getSummary = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const [bots, plan] = await Promise.all([
    Bot.find({ user: userId }).sort({ createdAt: -1 }),
    botService.getActivePlan(userId),
  ]);

  const botIds = bots.map((b) => b._id);
  const totalDocuments = await Document.countDocuments({ bot: { $in: botIds } });
  const totalMessagesThisMonth = bots.reduce((sum, b) => sum + b.messagesThisMonth, 0);

  res.status(200).json({
    success: true,
    data: {
      plan: {
        name: plan.name,
        slug: plan.slug,
        limits: plan.limits,
      },
      usage: {
        botsUsed: bots.length,
        botsLimit: plan.limits.maxBots,
        totalDocuments,
        messagesThisMonth: totalMessagesThisMonth,
        messagesLimit: plan.limits.maxMessagesPerMonth,
      },
      bots: bots.map((b) => ({
        id: b._id,
        name: b.name,
        isActive: b.isActive,
        documentCount: b.documentCount,
        messagesThisMonth: b.messagesThisMonth,
        provider: b.llmConfig.provider,
        createdAt: b.createdAt,
      })),
    },
  });
});

module.exports = { getSummary };
