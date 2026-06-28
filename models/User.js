const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      maxlength: [100, "Name cannot exceed 100 characters"],
    },

    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: [150, "Email cannot exceed 150 characters"],
      match: [
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        "Please enter a valid email address",
      ],
    },

    authProvider: {
      type: String,
      enum: ["local", "google", "both"],
      default: "local",
    },

    googleId: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      default: undefined,
    },

    avatarUrl: {
      type: String,
      trim: true,
      default: "",
    },

    password: {
      type: String,
      required: function passwordIsRequired() {
        return this.authProvider === "local" || this.authProvider === "both";
      },
      minlength: [8, "Password must contain at least 8 characters"],
      select: false,
    },

    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    // Default true preserves existing accounts created before this feature.
    // New password registrations explicitly set this to false.
    isEmailVerified: {
      type: Boolean,
      default: true,
    },

    emailVerificationToken: {
      type: String,
      select: false,
      default: null,
    },

    emailVerificationExpires: {
      type: Date,
      select: false,
      default: null,
    },

    // Short-lived browser session used by the original device to wait for
    // email verification completed on another device.
    emailVerificationSessionToken: {
      type: String,
      select: false,
      default: null,
    },

    emailVerificationSessionExpires: {
      type: Date,
      select: false,
      default: null,
    },


    // Password sign-in protection. These fields are hidden from normal queries.
    loginFailedAttempts: {
      type: Number,
      default: 0,
      min: 0,
      select: false,
    },

    loginLockUntil: {
      type: Date,
      default: null,
      select: false,
    },

    lastLoginAt: {
      type: Date,
      default: null,
    },

    tokenVersion: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Authenticator two-factor authentication.
    twoFactorEnabled: {
      type: Boolean,
      default: false,
    },
    twoFactorSecretEncrypted: {
      type: String,
      select: false,
      default: null,
    },
    twoFactorPendingSecretEncrypted: {
      type: String,
      select: false,
      default: null,
    },
    twoFactorPendingExpires: {
      type: Date,
      select: false,
      default: null,
    },
    twoFactorRecoveryCodeHashes: {
      type: [String],
      select: false,
      default: [],
    },
    twoFactorEnabledAt: {
      type: Date,
      default: null,
    },
    twoFactorLastUsedAt: {
      type: Date,
      default: null,
    },
    twoFactorLastUsedCounter: {
      type: Number,
      select: false,
      default: null,
    },
    twoFactorFailedAttempts: {
      type: Number,
      min: 0,
      select: false,
      default: 0,
    },
    twoFactorLockUntil: {
      type: Date,
      select: false,
      default: null,
    },


    passwordResetToken: {
      type: String,
      select: false,
      default: null,
    },

    passwordResetExpires: {
      type: Date,
      select: false,
      default: null,
    },

    // Short-lived browser session used by the original device to wait for
    // password reset completion on another device.
    passwordResetSessionToken: {
      type: String,
      select: false,
      default: null,
    },

    passwordResetSessionExpires: {
      type: Date,
      select: false,
      default: null,
    },

    passwordResetSessionCompletedAt: {
      type: Date,
      select: false,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

userSchema.pre("save", async function hashPassword() {
  if (!this.isModified("password") || !this.password) {
    return;
  }

  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.comparePassword = async function comparePassword(
  candidatePassword
) {
  if (!this.password) {
    return false;
  }

  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model("User", userSchema);
