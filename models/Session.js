const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      select: false,
    },

    refreshTokenHash: {
      type: String,
      required: true,
      select: false,
    },

    tokenVersion: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },

    deviceName: {
      type: String,
      default: "Unknown device",
      maxlength: 160,
    },

    browser: {
      type: String,
      default: "Unknown browser",
      maxlength: 80,
    },

    operatingSystem: {
      type: String,
      default: "Unknown OS",
      maxlength: 80,
    },

    deviceType: {
      type: String,
      enum: ["desktop", "mobile", "tablet", "unknown"],
      default: "unknown",
    },

    userAgent: {
      type: String,
      default: "",
      maxlength: 1000,
      select: false,
    },

    ipAddressMasked: {
      type: String,
      default: "Unavailable",
      maxlength: 100,
    },

    ipAddressHash: {
      type: String,
      default: "",
      maxlength: 128,
      select: false,
    },

    approximateLocation: {
      type: String,
      default: "Location unavailable",
      maxlength: 160,
    },

    timezone: {
      type: String,
      default: "Timezone unavailable",
      maxlength: 120,
    },

    fingerprintHash: {
      type: String,
      default: "",
      maxlength: 128,
      index: true,
      select: false,
    },

    isNewDevice: {
      type: Boolean,
      default: false,
    },

    isTrusted: {
      type: Boolean,
      default: false,
      index: true,
    },

    trustedAt: {
      type: Date,
      default: null,
    },

    newDeviceAlertSentAt: {
      type: Date,
      default: null,
    },

    lastActiveAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    expiresAt: {
      type: Date,
      required: true,
    },

    revokedAt: {
      type: Date,
      default: null,
      index: true,
    },

    revokeReason: {
      type: String,
      default: "",
      maxlength: 120,
    },
  },
  {
    timestamps: true,
  }
);

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
sessionSchema.index({ user: 1, revokedAt: 1, expiresAt: 1 });
sessionSchema.index({ user: 1, fingerprintHash: 1, isTrusted: 1 });

module.exports = mongoose.model("Session", sessionSchema);
