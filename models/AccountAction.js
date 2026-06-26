const mongoose = require("mongoose");

const accountActionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["email-change"],
      required: true,
      index: true,
    },

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    currentEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 150,
    },

    newEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 150,
    },

    currentEmailTokenHash: {
      type: String,
      required: true,
      select: false,
    },

    newEmailTokenHash: {
      type: String,
      required: true,
      select: false,
    },

    currentEmailApprovedAt: {
      type: Date,
      default: null,
    },

    newEmailApprovedAt: {
      type: Date,
      default: null,
    },

    requestedSessionId: {
      type: String,
      default: "",
      maxlength: 128,
      select: false,
    },

    finalizingAt: {
      type: Date,
      default: null,
    },

    usedAt: {
      type: Date,
      default: null,
      index: true,
    },

    canceledAt: {
      type: Date,
      default: null,
      index: true,
    },

    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

accountActionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
accountActionSchema.index({ user: 1, type: 1, createdAt: -1 });

module.exports = mongoose.model("AccountAction", accountActionSchema);
