require("dotenv").config();

const mongoose = require("mongoose");
const User = require("../models/User");
const Session = require("../models/Session");

const run = async () => {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing from .env");
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const users = await User.find({}).select("name email tokenVersion").lean();
  const now = new Date();

  console.log("");
  console.log("ProTrade device-session audit");
  console.log("--------------------------------");

  for (const user of users) {
    const active = await Session.countDocuments({
      user: user._id,
      revokedAt: null,
      expiresAt: { $gt: now },
      tokenVersion: user.tokenVersion || 0,
    });

    const revoked = await Session.countDocuments({
      user: user._id,
      revokedAt: { $ne: null },
    });

    console.log(`${user.name} <${user.email}>`);
    console.log(`  active sessions=${active} revoked sessions=${revoked}`);
  }

  const expiredNotRevoked = await Session.countDocuments({
    revokedAt: null,
    expiresAt: { $lte: now },
  });

  console.log("");
  console.log(`Expired sessions awaiting TTL cleanup: ${expiredNotRevoked}`);
};

run()
  .catch((error) => {
    console.error("Session audit failed:");
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
