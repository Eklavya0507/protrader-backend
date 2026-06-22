require("dotenv").config();

const mongoose = require("mongoose");
const User = require("../models/User");
const Trade = require("../models/Trade");
const Journal = require("../models/Journal");
const Setting = require("../models/Setting");

const ownerEmail = String(process.argv[2] || "").trim().toLowerCase();

const legacyFilter = {
  $or: [
    { user: { $exists: false } },
    { user: null },
  ],
};

const settingFields = [
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

const run = async () => {
  if (!ownerEmail) {
    throw new Error(
      "Owner email is required. Example: node scripts/migrateLegacyData.js your@email.com"
    );
  }

  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing from .env");
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const owner = await User.findOne({ email: ownerEmail });

  if (!owner) {
    throw new Error(`No registered user found for ${ownerEmail}`);
  }

  const tradeResult = await Trade.updateMany(
    legacyFilter,
    { $set: { user: owner._id } }
  );

  const journalResult = await Journal.updateMany(
    legacyFilter,
    { $set: { user: owner._id } }
  );

  const settingsCollection = mongoose.connection.collection("settings");

  const existingOwnedSetting = await settingsCollection.findOne({
    user: owner._id,
  });

  const legacySettings = await settingsCollection
    .find(legacyFilter)
    .sort({ updatedAt: -1, createdAt: -1 })
    .toArray();

  let settingsAction = "No legacy settings found";

  if (legacySettings.length > 0) {
    const primaryLegacy = legacySettings[0];

    if (existingOwnedSetting) {
      const copiedValues = {};

      for (const field of settingFields) {
        if (Object.prototype.hasOwnProperty.call(primaryLegacy, field)) {
          copiedValues[field] = primaryLegacy[field];
        }
      }

      await settingsCollection.updateOne(
        { _id: existingOwnedSetting._id },
        { $set: copiedValues }
      );

      await settingsCollection.deleteMany({
        _id: { $in: legacySettings.map((item) => item._id) },
      });

      settingsAction =
        "Copied legacy settings into the existing owner settings document";
    } else {
      await settingsCollection.updateOne(
        { _id: primaryLegacy._id },
        {
          $set: { user: owner._id },
          $setOnInsert: { singletonKey: `user:${owner._id}` },
        }
      );

      if (legacySettings.length > 1) {
        await settingsCollection.deleteMany({
          _id: { $in: legacySettings.slice(1).map((item) => item._id) },
        });
      }

      settingsAction = "Assigned legacy settings to the owner";
    }
  }

  console.log("Legacy migration completed.");
  console.log(`Owner: ${owner.name} <${owner.email}>`);
  console.log(`Trades assigned: ${tradeResult.modifiedCount}`);
  console.log(`Journals assigned: ${journalResult.modifiedCount}`);
  console.log(`Settings: ${settingsAction}`);
};

run()
  .catch((error) => {
    console.error("Migration failed:");
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
