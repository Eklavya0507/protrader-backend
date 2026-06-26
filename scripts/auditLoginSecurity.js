require("dotenv").config();

const mongoose = require("mongoose");
const User = require("../models/User");
const Session = require("../models/Session");

const run = async () => {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing from .env");
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const users = await User.find({})
    .select(
      "name email isActive tokenVersion +loginFailedAttempts +loginLockUntil"
    )
    .sort({ email: 1 })
    .lean();

  const now = new Date();

  console.log("");
  console.log("ProTrade Batch 1 login-security audit");
  console.log("--------------------------------------");

  for (const user of users) {
    const activeSessions = await Session.countDocuments({
      user: user._id,
      revokedAt: null,
      expiresAt: { $gt: now },
      tokenVersion: user.tokenVersion || 0,
    });

    const locked =
      user.loginLockUntil instanceof Date &&
      user.loginLockUntil.getTime() > Date.now();

    console.log(`${user.name} <${user.email}>`);
    console.log(
      `  active=${user.isActive !== false} failedAttempts=${
        user.loginFailedAttempts || 0
      } locked=${locked} activeSessions=${activeSessions}`
    );

    if (locked) {
      console.log(`  lockUntil=${user.loginLockUntil.toISOString()}`);
    }
  }
};

run()
  .catch((error) => {
    console.error("Login-security audit failed:");
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
