const Setting = require("../models/Setting");

const allowedFields = [
  "fullName",
  "timezone",
  "tradingRole",
  "currency",
  "startingBalance",
  "targetBalance",
  "riskPerTrade",
  "maxDailyLoss",
  "maxTradesPerDay",
  "defaultRR",
  "preferredSession",
  "theme",
  "dateFormat",
  "tradeReminders",
  "weeklySummary",
  "emailNotifications",
];

const pickAllowedFields = (body = {}) => {
  const clean = {};

  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      clean[field] = body[field];
    }
  }

  return clean;
};

const createDefaultSettings = (user) => ({
  user: user._id,
  singletonKey: `user:${user._id}`,
  fullName: user.name || "Trader",
  email: user.email || "",
});

const getOrCreateSettings = async (user) => {
  let settings = await Setting.findOne({ user: user._id });

  if (!settings) {
    settings = await Setting.create(createDefaultSettings(user));
  }

  // The authentication email is controlled by the verified email-change flow,
  // not by ordinary workspace settings.
  if (settings.email !== (user.email || "")) {
    settings.email = user.email || "";
    await settings.save({ validateBeforeSave: false });
  }

  return settings;
};

// GET /api/settings
const getSettings = async (req, res, next) => {
  try {
    const settings = await getOrCreateSettings(req.user);

    res.status(200).json({
      success: true,
      data: settings,
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/settings
const updateSettings = async (req, res, next) => {
  try {
    const updates = pickAllowedFields(req.body);

    if (
      Object.prototype.hasOwnProperty.call(updates, "startingBalance") &&
      Number(updates.startingBalance) < 0
    ) {
      return res.status(400).json({
        success: false,
        code: "INVALID_STARTING_BALANCE",
        message: "Starting balance cannot be negative.",
        requestId: req.requestId,
      });
    }

    if (
      Object.prototype.hasOwnProperty.call(updates, "targetBalance") &&
      Number(updates.targetBalance) < 0
    ) {
      return res.status(400).json({
        success: false,
        code: "INVALID_TARGET_BALANCE",
        message: "Target balance cannot be negative.",
        requestId: req.requestId,
      });
    }

    // Avoid MongoDB's "$set + $setOnInsert" path conflict when fields such as
    // fullName or email are included in both objects. Load/create the user's
    // settings document first, then apply only the requested fields and save.
    const settings = await getOrCreateSettings(req.user);

    for (const [field, value] of Object.entries(updates)) {
      settings[field] = value;
    }

    await settings.save();

    res.status(200).json({
      success: true,
      message: "Settings updated successfully",
      data: settings,
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/settings/reset
const resetSettings = async (req, res, next) => {
  try {
    await Setting.deleteOne({ user: req.user._id });
    const settings = await Setting.create(createDefaultSettings(req.user));

    res.status(200).json({
      success: true,
      message: "Settings reset to defaults",
      data: settings,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getSettings,
  updateSettings,
  resetSettings,
};
