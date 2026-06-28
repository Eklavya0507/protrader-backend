"use strict";

const mongoose = require("mongoose");
const SecurityAlert = require("../models/SecurityAlert");
const SecurityAlertPreference = require(
  "../models/SecurityAlertPreference"
);
const {
  getPreferences,
} = require("../utils/securityAlertEngine");

const positiveInteger = (value, fallback, max) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, max)
    : fallback;
};

const publicAlert = (alert) => ({
  id: alert._id,
  type: alert.type,
  severity: alert.severity,
  title: alert.title,
  message: alert.message,
  status: alert.status,
  browser: alert.browser,
  operatingSystem: alert.operatingSystem,
  deviceType: alert.deviceType,
  emailSent: alert.emailSent === true,
  emailSentAt: alert.emailSentAt || null,
  readAt: alert.readAt || null,
  metadata: alert.metadata || {},
  createdAt: alert.createdAt,
});

const publicPreferences = (preferences) => ({
  inAppAlerts: preferences.inAppAlerts === true,
  emailCriticalAlerts:
    preferences.emailCriticalAlerts === true,
  emailWarningAlerts:
    preferences.emailWarningAlerts === true,
  updatedAt: preferences.updatedAt,
});

const getSecurityAlerts = async (req, res, next) => {
  try {
    const page = positiveInteger(req.query.page, 1, 10000);
    const limit = positiveInteger(req.query.limit, 20, 100);
    const status = String(req.query.status || "")
      .trim()
      .toLowerCase();
    const severity = String(req.query.severity || "")
      .trim()
      .toLowerCase();

    const query = {
      user: req.user._id,
    };

    if (["unread", "read"].includes(status)) {
      query.status = status;
    }

    if (["info", "warning", "critical"].includes(severity)) {
      query.severity = severity;
    }

    const [alerts, total] = await Promise.all([
      SecurityAlert.find(query)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      SecurityAlert.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      count: alerts.length,
      total,
      page,
      limit,
      hasMore: page * limit < total,
      data: alerts.map(publicAlert),
    });
  } catch (error) {
    next(error);
  }
};

const getSecurityAlertSummary = async (req, res, next) => {
  try {
    const since = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000
    );

    const [
      unread,
      criticalUnread,
      warningUnread,
      total30Days,
      latest,
    ] = await Promise.all([
      SecurityAlert.countDocuments({
        user: req.user._id,
        status: "unread",
      }),
      SecurityAlert.countDocuments({
        user: req.user._id,
        status: "unread",
        severity: "critical",
      }),
      SecurityAlert.countDocuments({
        user: req.user._id,
        status: "unread",
        severity: "warning",
      }),
      SecurityAlert.countDocuments({
        user: req.user._id,
        createdAt: { $gte: since },
      }),
      SecurityAlert.findOne({
        user: req.user._id,
      })
        .sort({ createdAt: -1, _id: -1 })
        .lean(),
    ]);

    res.status(200).json({
      success: true,
      data: {
        unread,
        criticalUnread,
        warningUnread,
        total30Days,
        latest: latest ? publicAlert(latest) : null,
      },
    });
  } catch (error) {
    next(error);
  }
};

const getSecurityAlertPreferences = async (
  req,
  res,
  next
) => {
  try {
    const preferences = await getPreferences(req.user._id);

    res.status(200).json({
      success: true,
      data: publicPreferences(preferences),
    });
  } catch (error) {
    next(error);
  }
};

const updateSecurityAlertPreferences = async (
  req,
  res,
  next
) => {
  try {
    const allowed = [
      "inAppAlerts",
      "emailCriticalAlerts",
      "emailWarningAlerts",
    ];

    const update = {};

    for (const key of allowed) {
      if (Object.hasOwn(req.body, key)) {
        if (typeof req.body[key] !== "boolean") {
          return res.status(400).json({
            success: false,
            message: `${key} must be true or false.`,
          });
        }

        update[key] = req.body[key];
      }
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({
        success: false,
        message:
          "At least one security-alert preference is required.",
      });
    }

    const preferences =
      await SecurityAlertPreference.findOneAndUpdate(
        { user: req.user._id },
        {
          $set: update,
          $setOnInsert: {
            user: req.user._id,
          },
        },
        {
          new: true,
          upsert: true,
          setDefaultsOnInsert: true,
          runValidators: true,
        }
      );

    res.status(200).json({
      success: true,
      message: "Security-alert preferences updated.",
      data: publicPreferences(preferences),
    });
  } catch (error) {
    next(error);
  }
};

const markSecurityAlertRead = async (req, res, next) => {
  try {
    const alertId = String(req.params.alertId || "").trim();

    if (!mongoose.isValidObjectId(alertId)) {
      return res.status(400).json({
        success: false,
        message: "Security alert identifier is invalid.",
      });
    }

    const alert = await SecurityAlert.findOneAndUpdate(
      {
        _id: alertId,
        user: req.user._id,
      },
      {
        $set: {
          status: "read",
          readAt: new Date(),
        },
      },
      {
        new: true,
        runValidators: true,
      }
    );

    if (!alert) {
      return res.status(404).json({
        success: false,
        message: "Security alert was not found.",
      });
    }

    res.status(200).json({
      success: true,
      message: "Security alert marked as read.",
      data: publicAlert(alert),
    });
  } catch (error) {
    next(error);
  }
};

const markAllSecurityAlertsRead = async (
  req,
  res,
  next
) => {
  try {
    const result = await SecurityAlert.updateMany(
      {
        user: req.user._id,
        status: "unread",
      },
      {
        $set: {
          status: "read",
          readAt: new Date(),
        },
      }
    );

    res.status(200).json({
      success: true,
      updatedCount: result.modifiedCount,
      message: `${result.modifiedCount} alert(s) marked as read.`,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getSecurityAlerts,
  getSecurityAlertSummary,
  getSecurityAlertPreferences,
  updateSecurityAlertPreferences,
  markSecurityAlertRead,
  markAllSecurityAlertsRead,
};
