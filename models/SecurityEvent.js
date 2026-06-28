"use strict";

const mongoose = require("mongoose");

const securityEventSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
      immutable: true,
    },
    eventType: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
      index: true,
      immutable: true,
    },
    outcome: {
      type: String,
      enum: ["success", "failure"],
      required: true,
      index: true,
      immutable: true,
    },
    severity: {
      type: String,
      enum: ["info", "warning", "critical"],
      default: "info",
      index: true,
      immutable: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 140,
      immutable: true,
    },
    message: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
      immutable: true,
    },
    requestId: {
      type: String,
      default: "",
      trim: true,
      maxlength: 128,
      immutable: true,
    },
    sessionId: {
      type: String,
      default: "",
      trim: true,
      maxlength: 128,
      immutable: true,
    },
    clientDeviceIdHash: {
      type: String,
      default: "",
      select: false,
      immutable: true,
    },
    ipAddressHash: {
      type: String,
      default: "",
      select: false,
      immutable: true,
    },
    userAgent: {
      type: String,
      default: "",
      trim: true,
      maxlength: 320,
      immutable: true,
    },
    browser: {
      type: String,
      default: "Unknown browser",
      trim: true,
      maxlength: 80,
      immutable: true,
    },
    operatingSystem: {
      type: String,
      default: "Unknown OS",
      trim: true,
      maxlength: 80,
      immutable: true,
    },
    deviceType: {
      type: String,
      enum: ["desktop", "mobile", "tablet", "unknown"],
      default: "unknown",
      immutable: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
      immutable: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      immutable: true,
    },
  },
  {
    timestamps: {
      createdAt: true,
      updatedAt: false,
    },
    versionKey: false,
  }
);

securityEventSchema.index({ user: 1, createdAt: -1 });
securityEventSchema.index({ user: 1, eventType: 1, createdAt: -1 });
securityEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("SecurityEvent", securityEventSchema);
