const express = require("express");

const {
  register,
  login,
  googleLogin,
  verifyEmail,
  resendVerification,
  getMe,
  updateMe,
  changePassword,
  forgotPassword,
  resetPassword,
  logout,
} = require("../controllers/authController");

const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/google", googleLogin);
router.post("/verify-email", verifyEmail);
router.post("/resend-verification", resendVerification);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

router.get("/me", protect, getMe);
router.put("/me", protect, updateMe);
router.put("/change-password", protect, changePassword);
router.post("/logout", protect, logout);

module.exports = router;
