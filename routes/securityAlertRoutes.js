"use strict";

const express = require("express");

const {
  getSecurityAlerts,
  getSecurityAlertSummary,
  getSecurityAlertPreferences,
  updateSecurityAlertPreferences,
  markSecurityAlertRead,
  markAllSecurityAlertsRead,
} = require("../controllers/securityAlertController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(protect);

router.get("/", getSecurityAlerts);
router.get("/summary", getSecurityAlertSummary);
router.get("/preferences", getSecurityAlertPreferences);
router.patch(
  "/preferences",
  updateSecurityAlertPreferences
);
router.patch("/read-all", markAllSecurityAlertsRead);
router.patch("/:alertId/read", markSecurityAlertRead);

module.exports = router;
