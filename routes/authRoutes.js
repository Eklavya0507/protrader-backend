const express = require("express");

const {
  register,
  login,
  googleLogin,
  verifyEmail,
  verificationStatus,
  resendVerification,
  getMe,
  updateMe,
  changePassword,
  forgotPassword,
  resetPassword,
  passwordResetStatus,
  logout,
} = require("../controllers/authController");

const {
  startSession,
  refreshSession,
  listSessions,
  revokeCurrentSession,
  revokeSession,
  logoutOtherSessions,
  logoutAllSessions,
} = require("../controllers/sessionController");

const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/google", googleLogin);
router.post("/verify-email", verifyEmail);
router.post("/verification-status", verificationStatus);
router.post("/resend-verification", resendVerification);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/password-reset-status", passwordResetStatus);

// Device and refresh-session routes.
router.post("/sessions/refresh", refreshSession);
router.post("/sessions/start", protect, startSession);
router.get("/sessions", protect, listSessions);
router.delete("/sessions/current", protect, revokeCurrentSession);
router.post("/sessions/logout-others", protect, logoutOtherSessions);
router.post("/sessions/logout-all", protect, logoutAllSessions);
router.delete("/sessions/:sessionId", protect, revokeSession);

router.get("/me", protect, getMe);
router.put("/me", protect, updateMe);
router.put("/change-password", protect, changePassword);
router.post("/logout", protect, logout);

module.exports = router;
