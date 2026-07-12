const express = require("express");

const {
  getPerformanceSummary,
} = require("../controllers/aiController");

const {
  protect,
} = require("../middleware/authMiddleware");

const router = express.Router();

// Every AI endpoint below this line requires a valid logged-in user.
router.use(protect);

// GET /api/ai/performance-summary?days=30
router.get("/performance-summary", getPerformanceSummary);

module.exports = router;
