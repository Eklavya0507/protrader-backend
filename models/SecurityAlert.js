"use strict";

const mongoose = require("mongoose");

const securityAlertSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
      immutable: true,
    },
    sourceEvent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SecurityEvent",
      default: null,
      index: true,
      immutable: true,
    },
    alertKey: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
      index: true,
      immutable: true,
    },
    type: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
      index: true,
      immutable: true,
    },
    severity: {
      type: String,
      enum: ["info", "warning", "critical"],
      required: true,
      index: true,
      immutable: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
      immutable: true,
    },
    message: {
      type: String,
      default: "",
      trim: true,
      maxlength: 700,
      immutable: true,
    },
    status: {
      type: String,
      enum: ["unread", "read"],
      default: "unread",
      index: true,
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
    emailSent: {
      type: Boolean,
      default: false,
    },
    emailSentAt: {
      type: Date,
      default: null,
    },
    readAt: {
      type: Date,
      default: null,
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
      updatedAt: true,
    },
    versionKey: false,
  }
);

securityAlertSchema.index({ user: 1, createdAt: -1 });
securityAlertSchema.index({ user: 1, status: 1, createdAt: -1 });
securityAlertSchema.index({ user: 1, alertKey: 1, createdAt: -1 });
securityAlertSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("SecurityAlert", securityAlertSchema);
