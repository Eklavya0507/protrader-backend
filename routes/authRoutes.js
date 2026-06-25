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

router.get("/me", protect, getMe);
router.put("/me", protect, updateMe);
router.put("/change-password", protect, changePassword);
router.post("/logout", protect, logout);

module.exports = router;
