"use strict";

const SecurityEvent = require("../models/SecurityEvent");

const toPositiveInteger = (value, fallback, max) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, max)
    : fallback;
};

const publicEvent = (event) => ({
  id: event._id,
  eventType: event.eventType,
  outcome: event.outcome,
  severity: event.severity,
  title: event.title,
  message: event.message,
  requestId: event.requestId || "",
  sessionId: event.sessionId || "",
  browser: event.browser,
  operatingSystem: event.operatingSystem,
  deviceType: event.deviceType,
  metadata: event.metadata || {},
  createdAt: event.createdAt,
});

const getSecurityActivity = async (req, res, next) => {
  try {
    const page = toPositiveInteger(req.query.page, 1, 10000);
    const limit = toPositiveInteger(req.query.limit, 30, 100);
    const eventType = String(req.query.eventType || "")
      .trim()
      .slice(0, 80);
    const outcome = String(req.query.outcome || "")
      .trim()
      .toLowerCase();

    const query = {
      user: req.user._id,
    };

    if (eventType) {
      query.eventType = eventType;
    }

    if (["success", "failure"].includes(outcome)) {
      query.outcome = outcome;
    }

    const [events, total] = await Promise.all([
      SecurityEvent.find(query)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      SecurityEvent.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      count: events.length,
      total,
      page,
      limit,
      hasMore: page * limit < total,
      data: events.map(publicEvent),
    });
  } catch (error) {
    next(error);
  }
};

const getSecurityActivitySummary = async (req, res, next) => {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [total30Days, failed30Days, critical30Days, latest] =
      await Promise.all([
        SecurityEvent.countDocuments({
          user: req.user._id,
          createdAt: { $gte: since },
        }),
        SecurityEvent.countDocuments({
          user: req.user._id,
          outcome: "failure",
          createdAt: { $gte: since },
        }),
        SecurityEvent.countDocuments({
          user: req.user._id,
          severity: "critical",
          createdAt: { $gte: since },
        }),
        SecurityEvent.findOne({ user: req.user._id })
          .sort({ createdAt: -1, _id: -1 })
          .lean(),
      ]);

    res.status(200).json({
      success: true,
      data: {
        windowDays: 30,
        total: total30Days,
        failed: failed30Days,
        critical: critical30Days,
        latest: latest ? publicEvent(latest) : null,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getSecurityActivity,
  getSecurityActivitySummary,
};
