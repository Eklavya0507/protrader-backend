"use strict";

const express = require("express");

const {
  getSecurityActivity,
  getSecurityActivitySummary,
} = require("../controllers/securityActivityController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/activity", protect, getSecurityActivity);
router.get(
  "/activity/summary",
  protect,
  getSecurityActivitySummary
);

module.exports = router;
