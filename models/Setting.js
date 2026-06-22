const mongoose = require("mongoose");

const settingSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Settings owner is required"],
      unique: true,
      index: true,
    },

    // Kept for compatibility with the old global settings index.
    // New users receive a unique value based on their user ID.
    singletonKey: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
    },

    fullName: {
      type: String,
      trim: true,
      maxlength: 100,
      default: "Trader",
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 150,
      default: "",
    },

    timezone: {
      type: String,
      trim: true,
      default: "Asia/Kolkata",
    },

    tradingRole: {
      type: String,
      trim: true,
      maxlength: 100,
      default: "Independent Trader",
    },

    currency: {
      type: String,
      enum: ["USD", "INR", "EUR", "GBP", "JPY"],
      default: "USD",
    },

    startingBalance: {
      type: Number,
      min: 0,
      default: 100000,
    },

    targetBalance: {
      type: Number,
      min: 0,
      default: 150000,
    },

    riskPerTrade: {
      type: Number,
      min: 0,
      max: 100,
      default: 1,
    },

    maxDailyLoss: {
      type: Number,
      min: 0,
      max: 100,
      default: 3,
    },

    maxTradesPerDay: {
      type: Number,
      min: 1,
      max: 100,
      default: 3,
    },

    defaultRR: {
      type: Number,
      min: 0,
      max: 100,
      default: 2,
    },

    preferredSession: {
      type: String,
      enum: ["London", "New York", "Asia", "Other"],
      default: "London",
    },

    theme: {
      type: String,
      enum: ["Dark", "Light", "System"],
      default: "Dark",
    },

    dateFormat: {
      type: String,
      enum: ["DD MMM YYYY", "MM/DD/YYYY", "YYYY-MM-DD"],
      default: "DD MMM YYYY",
    },

    tradeReminders: {
      type: Boolean,
      default: true,
    },

    weeklySummary: {
      type: Boolean,
      default: true,
    },

    emailNotifications: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Setting", settingSchema);
