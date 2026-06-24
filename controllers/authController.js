const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");

const User = require("../models/User");
const { sendEmail } = require("../utils/sendEmail");

const RESET_TOKEN_MINUTES = 15;

const getGoogleClient = () => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    throw new Error("GOOGLE_CLIENT_ID is missing from environment variables");
  }

  return new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
};

const verifyGoogleCredential = async (credential) => {
  const ticket = await getGoogleClient().verifyIdToken({
    idToken: credential,
    audience: process.env.GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();

  if (
    !payload ||
    !payload.sub ||
    !payload.email ||
    payload.email_verified !== true
  ) {
    throw new Error("Google account could not be verified.");
  }

  return {
    googleId: payload.sub,
    email: String(payload.email).trim().toLowerCase(),
    name: String(payload.name || payload.given_name || "Google User").trim(),
    avatarUrl: String(payload.picture || "").trim(),
  };
};


const publicUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  isActive: user.isActive,
  lastLoginAt: user.lastLoginAt,
  createdAt: user.createdAt,
  authProvider: user.authProvider,
  avatarUrl: user.avatarUrl || "",
  updatedAt: user.updatedAt,
});

const createToken = (user) => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is missing from environment variables");
  }

  return jwt.sign(
    {
      id: user._id,
      tokenVersion: user.tokenVersion || 0,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    }
  );
};

const validateStrongPassword = (password, label = "Password") => {
  if (password.length < 8) {
    return `${label} must contain at least 8 characters.`;
  }

  if (!/[A-Z]/.test(password)) {
    return `${label} must contain at least one uppercase letter.`;
  }

  if (!/[a-z]/.test(password)) {
    return `${label} must contain at least one lowercase letter.`;
  }

  if (!/\d/.test(password)) {
    return `${label} must contain at least one number.`;
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    return `${label} must contain at least one special character.`;
  }

  return null;
};

const normalizeFrontendUrl = () =>
  String(
    process.env.FRONTEND_URL ||
      "https://eklavya0507.github.io/protrader"
  ).replace(/\/+$/, "");

const createResetEmail = ({ user, resetUrl }) => {
  const subject = "Reset your ProTrade password";

  const text = [
    `Hello ${user.name},`,
    "",
    "We received a request to reset your ProTrade password.",
    `Open this link within ${RESET_TOKEN_MINUTES} minutes:`,
    resetUrl,
    "",
    "If you did not request this change, you can ignore this email.",
  ].join("\n");

  const html = `
    <div style="margin:0;padding:30px;background:#0b0f10;font-family:Arial,sans-serif;color:#edf2f5">
      <div style="max-width:600px;margin:0 auto;background:#151a1d;border:1px solid #30383d;border-radius:20px;overflow:hidden">
        <div style="padding:24px 28px;border-bottom:1px solid #30383d">
          <div style="font-size:24px;font-weight:800;color:#aec3ff">ProTrade</div>
          <div style="margin-top:4px;font-size:11px;letter-spacing:2px;color:#9da8af">ACCOUNT SECURITY</div>
        </div>
        <div style="padding:28px">
          <h1 style="margin:0 0 12px;font-size:24px">Reset your password</h1>
          <p style="margin:0 0 16px;line-height:1.7;color:#b8c1c6">
            Hello ${user.name}, we received a request to reset your ProTrade password.
          </p>
          <p style="margin:0 0 22px;line-height:1.7;color:#b8c1c6">
            This secure link expires in ${RESET_TOKEN_MINUTES} minutes.
          </p>
          <a href="${resetUrl}"
             style="display:inline-block;padding:14px 20px;border-radius:12px;background:#7da1ff;color:#14203b;text-decoration:none;font-weight:800">
            Reset Password
          </a>
          <p style="margin:24px 0 0;line-height:1.6;font-size:13px;color:#8f9aa1">
            If you did not request this password reset, ignore this email. Your current password will remain unchanged.
          </p>
        </div>
      </div>
    </div>
  `;

  return { subject, text, html };
};

// POST /api/auth/register
const register = async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email and password are required.",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must contain at least 8 characters.",
      });
    }

    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    const user = await User.create({
      name,
      email,
      password,
      authProvider: "local",
    });

    const token = createToken(user);

    res.status(201).json({
      success: true,
      message: "Account created successfully.",
      token,
      data: publicUser(user),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists.",
      });
    }

    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// POST /api/auth/login
const login = async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    const user = await User.findOne({ email }).select("+password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Incorrect email or password.",
      });
    }

    if (!user.password) {
      return res.status(401).json({
        success: false,
        message:
          "This account uses Google Sign-In. Continue with Google or use Forgot password to create a password.",
      });
    }

    if (!(await user.comparePassword(password))) {
      return res.status(401).json({
        success: false,
        message: "Incorrect email or password.",
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "This account is disabled.",
      });
    }

    user.lastLoginAt = new Date();
    await user.save({ validateBeforeSave: false });

    const token = createToken(user);

    res.status(200).json({
      success: true,
      message: "Login successful.",
      token,
      data: publicUser(user),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};


// POST /api/auth/google
const googleLogin = async (req, res) => {
  try {
    const credential = String(req.body.credential || "").trim();

    if (!credential) {
      return res.status(400).json({
        success: false,
        message: "Google credential is required.",
      });
    }

    const googleProfile = await verifyGoogleCredential(credential);

    let user = await User.findOne({
      $or: [
        { googleId: googleProfile.googleId },
        { email: googleProfile.email },
      ],
    }).select("+password");

    let isNewAccount = false;

    if (user) {
      if (!user.isActive) {
        return res.status(403).json({
          success: false,
          message: "This account is disabled.",
        });
      }

      if (
        user.googleId &&
        user.googleId !== googleProfile.googleId
      ) {
        return res.status(409).json({
          success: false,
          message:
            "This email is already linked to a different Google identity.",
        });
      }

      user.googleId = googleProfile.googleId;
      user.avatarUrl = googleProfile.avatarUrl || user.avatarUrl;
      user.authProvider = user.password ? "both" : "google";
      user.lastLoginAt = new Date();

      if (!user.name && googleProfile.name) {
        user.name = googleProfile.name;
      }

      await user.save({ validateBeforeSave: false });
    } else {
      user = await User.create({
        name: googleProfile.name,
        email: googleProfile.email,
        googleId: googleProfile.googleId,
        avatarUrl: googleProfile.avatarUrl,
        authProvider: "google",
        lastLoginAt: new Date(),
      });

      isNewAccount = true;
    }

    const token = createToken(user);

    res.status(isNewAccount ? 201 : 200).json({
      success: true,
      message: isNewAccount
        ? "Google account connected and ProTrade account created."
        : "Google sign-in successful.",
      token,
      data: publicUser(user),
    });
  } catch (error) {
    console.error("Google sign-in failed:", error.message);

    res.status(401).json({
      success: false,
      message:
        "Google sign-in could not be verified. Please try again.",
    });
  }
};

// GET /api/auth/me
const getMe = async (req, res) => {
  res.status(200).json({
    success: true,
    data: publicUser(req.user),
  });
};

// PUT /api/auth/me
const updateMe = async (req, res) => {
  try {
    const updates = {};

    if (Object.prototype.hasOwnProperty.call(req.body, "name")) {
      const name = String(req.body.name || "").trim();

      if (!name) {
        return res.status(400).json({
          success: false,
          message: "Name cannot be empty.",
        });
      }

      updates.name = name;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "email")) {
      const email = String(req.body.email || "").trim().toLowerCase();

      if (!email) {
        return res.status(400).json({
          success: false,
          message: "Email cannot be empty.",
        });
      }

      const existingUser = await User.findOne({
        email,
        _id: { $ne: req.user._id },
      });

      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: "Another account already uses this email.",
        });
      }

      updates.email = email;
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      data: publicUser(user),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Another account already uses this email.",
      });
    }

    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// PUT /api/auth/change-password
const changePassword = async (req, res) => {
  try {
    const currentPassword = String(req.body.currentPassword || "");
    const newPassword = String(req.body.newPassword || "");
    const confirmPassword = String(req.body.confirmPassword || "");

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message:
          "Current password, new password and confirmation are required.",
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "New password and confirmation do not match.",
      });
    }

    const passwordError = validateStrongPassword(
      newPassword,
      "New password"
    );

    if (passwordError) {
      return res.status(400).json({
        success: false,
        message: passwordError,
      });
    }

    const user = await User.findById(req.user._id).select("+password");

    if (!user || !(await user.comparePassword(currentPassword))) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect.",
      });
    }

    if (await user.comparePassword(newPassword)) {
      return res.status(400).json({
        success: false,
        message: "New password must be different from the current password.",
      });
    }

    user.password = newPassword;
    user.authProvider = user.googleId ? "both" : "local";
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    await user.save();

    const token = createToken(user);

    res.status(200).json({
      success: true,
      message:
        "Password changed successfully. Other signed-in sessions have been invalidated.",
      token,
      data: publicUser(user),
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// POST /api/auth/forgot-password
const forgotPassword = async (req, res) => {
  const genericResponse = {
    success: true,
    message:
      "If an account exists for that email, a password reset link has been sent.",
  };

  try {
    const email = String(req.body.email || "").trim().toLowerCase();

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email address is required.",
      });
    }

    const user = await User.findOne({ email });

    // Prevent account enumeration.
    if (!user || !user.isActive) {
      return res.status(200).json(genericResponse);
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const hashedResetToken = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");

    user.passwordResetToken = hashedResetToken;
    user.passwordResetExpires = new Date(
      Date.now() + RESET_TOKEN_MINUTES * 60 * 1000
    );

    await user.save({ validateBeforeSave: false });

    const resetUrl =
      `${normalizeFrontendUrl()}/reset-password.html` +
      `?token=${encodeURIComponent(resetToken)}` +
      `&email=${encodeURIComponent(user.email)}`;

    const emailContent = createResetEmail({ user, resetUrl });

    try {
      await sendEmail({
        to: user.email,
        ...emailContent,
      });
    } catch (emailError) {
      user.passwordResetToken = null;
      user.passwordResetExpires = null;
      await user.save({ validateBeforeSave: false });

      console.error("Password reset email failed:", emailError.message);

      return res.status(503).json({
        success: false,
        message:
          "Password reset email could not be sent. Please try again later.",
      });
    }

    res.status(200).json(genericResponse);
  } catch (error) {
    console.error("Forgot password error:", error);

    res.status(500).json({
      success: false,
      message: "Password reset could not be started.",
    });
  }
};

// POST /api/auth/reset-password
const resetPassword = async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const resetToken = String(req.body.token || "");
    const newPassword = String(req.body.newPassword || "");
    const confirmPassword = String(req.body.confirmPassword || "");

    if (!email || !resetToken || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message:
          "Email, reset token, new password and confirmation are required.",
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "New password and confirmation do not match.",
      });
    }

    const passwordError = validateStrongPassword(
      newPassword,
      "New password"
    );

    if (passwordError) {
      return res.status(400).json({
        success: false,
        message: passwordError,
      });
    }

    const hashedResetToken = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");

    const user = await User.findOne({
      email,
      passwordResetToken: hashedResetToken,
      passwordResetExpires: { $gt: new Date() },
      isActive: true,
    }).select("+password +passwordResetToken +passwordResetExpires");

    if (!user) {
      return res.status(400).json({
        success: false,
        message:
          "This reset link is invalid or has expired. Request a new link.",
      });
    }

    if (await user.comparePassword(newPassword)) {
      return res.status(400).json({
        success: false,
        message: "New password must be different from the current password.",
      });
    }

    user.password = newPassword;
    user.authProvider = user.googleId ? "both" : "local";
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    user.lastLoginAt = new Date();

    await user.save();

    const token = createToken(user);

    res.status(200).json({
      success: true,
      message:
        "Password reset successfully. Older login sessions have been invalidated.",
      token,
      data: publicUser(user),
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// POST /api/auth/logout
const logout = async (req, res) => {
  res.status(200).json({
    success: true,
    message: "Logout successful. Remove the token from the client.",
  });
};

module.exports = {
  register,
  login,
  googleLogin,
  getMe,
  updateMe,
  changePassword,
  forgotPassword,
  resetPassword,
  logout,
};
