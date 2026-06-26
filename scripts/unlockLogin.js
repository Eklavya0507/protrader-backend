require("dotenv").config();

const mongoose = require("mongoose");
const User = require("../models/User");

const email = String(process.argv[2] || "").trim().toLowerCase();

const run = async () => {
  if (!email) {
    throw new Error(
      "Email is required. Example: node scripts/unlockLogin.js user@example.com"
    );
  }

  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing from .env");
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const user = await User.findOne({ email }).select(
    "+loginFailedAttempts +loginLockUntil"
  );

  if (!user) {
    throw new Error("User not found.");
  }

  user.loginFailedAttempts = 0;
  user.loginLockUntil = null;
  await user.save({ validateBeforeSave: false });

  console.log(`Login protection cleared for ${user.email}`);
};

run()
  .catch((error) => {
    console.error("Unlock failed:");
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
