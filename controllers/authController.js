const jwt = require("jsonwebtoken");
const User = require("../models/User");

const publicUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  isActive: user.isActive,
  lastLoginAt: user.lastLoginAt,
  createdAt: user.createdAt,
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

const validateNewPassword = (password) => {
  if (password.length < 8) {
    return "New password must contain at least 8 characters.";
  }

  if (!/[A-Z]/.test(password)) {
    return "New password must contain at least one uppercase letter.";
  }

  if (!/[a-z]/.test(password)) {
    return "New password must contain at least one lowercase letter.";
  }

  if (!/\d/.test(password)) {
    return "New password must contain at least one number.";
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    return "New password must contain at least one special character.";
  }

  return null;
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

    if (!user || !(await user.comparePassword(password))) {
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

    const passwordError = validateNewPassword(newPassword);

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
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    // This new token is valid for the incremented tokenVersion.
    // Every older token becomes invalid immediately.
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
  getMe,
  updateMe,
  changePassword,
  logout,
};
