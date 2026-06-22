const Setting = require("../models/Setting");

const SINGLETON_KEY = "global";

const allowedFields = [
  "fullName",
  "email",
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

const getOrCreateSettings = async () => {
  let settings = await Setting.findOne({ singletonKey: SINGLETON_KEY });

  if (!settings) {
    settings = await Setting.create({ singletonKey: SINGLETON_KEY });
  }

  return settings;
};

// GET /api/settings
const getSettings = async (req, res) => {
  try {
    const settings = await getOrCreateSettings();

    res.status(200).json({
      success: true,
      data: settings,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// PUT /api/settings
const updateSettings = async (req, res) => {
  try {
    const updates = pickAllowedFields(req.body);

    if (
      Object.prototype.hasOwnProperty.call(updates, "startingBalance") &&
      Number(updates.startingBalance) < 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Starting balance cannot be negative",
      });
    }

    if (
      Object.prototype.hasOwnProperty.call(updates, "targetBalance") &&
      Number(updates.targetBalance) < 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Target balance cannot be negative",
      });
    }

    const settings = await Setting.findOneAndUpdate(
      { singletonKey: SINGLETON_KEY },
      {
        $set: updates,
        $setOnInsert: { singletonKey: SINGLETON_KEY },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );

    res.status(200).json({
      success: true,
      message: "Settings updated successfully",
      data: settings,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// POST /api/settings/reset
const resetSettings = async (req, res) => {
  try {
    await Setting.deleteOne({ singletonKey: SINGLETON_KEY });
    const settings = await Setting.create({ singletonKey: SINGLETON_KEY });

    res.status(200).json({
      success: true,
      message: "Settings reset to defaults",
      data: settings,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  getSettings,
  updateSettings,
  resetSettings,
};
