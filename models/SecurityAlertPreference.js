"use strict";

const mongoose = require("mongoose");

const securityAlertPreferenceSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    inAppAlerts: {
      type: Boolean,
      default: true,
    },
    emailCriticalAlerts: {
      type: Boolean,
      default: true,
    },
    emailWarningAlerts: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

module.exports = mongoose.model(
  "SecurityAlertPreference",
  securityAlertPreferenceSchema
);
