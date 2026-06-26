const express = require("express");

const {
  requestEmailChange,
  getEmailChangeStatus,
  cancelEmailChange,
  confirmEmailChange,
  exportAccountData,
  deleteAccount,
} = require("../controllers/accountController");

const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

// Public signed link opened from email.
router.post("/email-change/confirm", confirmEmailChange);

// Authenticated account controls.
router.post("/email-change/request", protect, requestEmailChange);
router.get("/email-change/status", protect, getEmailChangeStatus);
router.post("/email-change/cancel", protect, cancelEmailChange);
router.get("/export", protect, exportAccountData);
router.delete("/", protect, deleteAccount);

module.exports = router;
