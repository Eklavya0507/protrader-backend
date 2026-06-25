require("dotenv").config();

const mongoose = require("mongoose");
const User = require("../models/User");
const Trade = require("../models/Trade");
const Journal = require("../models/Journal");

const run = async () => {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing from .env");
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const users = await User.find({})
    .select("name email authProvider isEmailVerified createdAt")
    .sort({ createdAt: 1 })
    .lean();

  const settingsCollection = mongoose.connection.collection("settings");

  console.log("");
  console.log("ProTrade user-owned data audit");
  console.log("--------------------------------");

  for (const user of users) {
    const [trades, journals, settings] = await Promise.all([
      Trade.countDocuments({ user: user._id }),
      Journal.countDocuments({ user: user._id }),
      settingsCollection.countDocuments({ user: user._id }),
    ]);

    console.log(`${user.name} <${user.email}>`);
    console.log(
      `  provider=${user.authProvider || "local"} verified=${
        user.isEmailVerified !== false
      }`
    );
    console.log(
      `  trades=${trades} journals=${journals} settings=${settings}`
    );
  }

  const orphanFilter = {
    $or: [{ user: { $exists: false } }, { user: null }],
  };

  const [orphanTrades, orphanJournals, orphanSettings] = await Promise.all([
    Trade.countDocuments(orphanFilter),
    Journal.countDocuments(orphanFilter),
    settingsCollection.countDocuments(orphanFilter),
  ]);

  console.log("");
  console.log(
    `Orphans: trades=${orphanTrades} journals=${orphanJournals} settings=${orphanSettings}`
  );
};

run()
  .catch((error) => {
    console.error("Audit failed:");
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
