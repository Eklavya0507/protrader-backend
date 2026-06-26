const crypto = require("node:crypto");
const mongoose = require("mongoose");

const User = require("../models/User");
const Trade = require("../models/Trade");
const Journal = require("../models/Journal");
const Setting = require("../models/Setting");
const Session = require("../models/Session");
const AccountAction = require("../models/AccountAction");

const { sendEmail } = require("../utils/sendEmail");
const {
  hashValue,
  safeEqualHex,
  revokeAllUserSessions,
} = require("../utils/sessionManager");

const EMAIL_ACTION_MINUTES = (() => {
  const parsed = Number(process.env.EMAIL_CHANGE_ACTION_MINUTES);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 30;
})();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const accountError = (statusCode, code, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.publicMessage = message;
  return error;
};

const normalizeEmail = (value) =>
  String(value || "").trim().toLowerCase();

const isValidEmail = (value) =>
  value.length <= 150 && EMAIL_PATTERN.test(value);

const escapeHtml = (value) =>
  String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const maskEmail = (email) => {
  const [local = "", domain = ""] = String(email || "").split("@");
  if (!local || !domain) return "Hidden email";

  const visible =
    local.length <= 2
      ? `${local.charAt(0) || "*"}*`
      : `${local.slice(0, 2)}${"*".repeat(Math.min(6, local.length - 2))}`;

  return `${visible}@${domain}`;
};

const frontendUrl = () =>
  String(
    process.env.FRONTEND_URL ||
      "https://eklavya0507.github.io/protrader"
  ).replace(/\/+$/, "");

const createActionLink = ({ actionId, side, token }) => {
  const params = new URLSearchParams({
    id: String(actionId),
    side,
    token,
  });

  return `${frontendUrl()}/account-action.html?${params.toString()}`;
};

const emailChangeMessage = ({
  user,
  action,
  currentLink,
  newLink,
  recipientSide,
}) => {
  const isCurrent = recipientSide === "current";
  const title = isCurrent
    ? "Approve your ProTrade email change"
    : "Verify your new ProTrade email";
  const actionUrl = isCurrent ? currentLink : newLink;
  const actionLabel = isCurrent
    ? "Approve email change"
    : "Verify new email";
  const destination = isCurrent
    ? `A request was made to change your ProTrade sign-in email to ${action.newEmail}.`
    : `This address was requested as the new ProTrade sign-in email for ${action.currentEmail}.`;

  const text = [
    `Hello ${user.name || "Trader"},`,
    "",
    destination,
    "",
    `Open this secure link within ${EMAIL_ACTION_MINUTES} minutes:`,
    actionUrl,
    "",
    "Both the current email and the new email must be approved before the change is completed.",
    "If you did not request this, do not approve it. Your current sign-in email will remain unchanged.",
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;background:#0b1117;padding:28px;color:#eef4fb">
      <div style="max-width:620px;margin:auto;background:#151d26;border:1px solid #293847;border-radius:18px;padding:30px">
        <p style="margin:0;color:#7fa9ff;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase">ProTrade Account Security</p>
        <h1 style="margin:14px 0 8px;font-size:26px">${escapeHtml(title)}</h1>
        <p style="color:#b7c2ce;line-height:1.65">${escapeHtml(destination)}</p>
        <p style="color:#b7c2ce;line-height:1.65">
          Both email addresses must be approved within ${EMAIL_ACTION_MINUTES} minutes.
        </p>
        <a href="${escapeHtml(actionUrl)}"
           style="display:inline-block;margin:16px 0 20px;background:#2877e7;color:#fff;text-decoration:none;font-weight:800;padding:13px 20px;border-radius:11px">
          ${escapeHtml(actionLabel)}
        </a>
        <p style="color:#8e9aa7;font-size:13px;line-height:1.6">
          If you did not request this change, do not approve it. Your current sign-in email will remain unchanged.
        </p>
      </div>
    </div>
  `;

  return { subject: title, text, html };
};

const sendEmailChangeCompletion = ({ userName, oldEmail, newEmail }) => {
  const subject = "Your ProTrade sign-in email was changed";
  const text = [
    `Hello ${userName || "Trader"},`,
    "",
    `Your ProTrade sign-in email was changed from ${oldEmail} to ${newEmail}.`,
    "For security, all existing device sessions were signed out.",
    "",
    "Sign in again using the new email address.",
    "If this was not you, reset your password and contact support immediately.",
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;background:#0b1117;padding:28px;color:#eef4fb">
      <div style="max-width:620px;margin:auto;background:#151d26;border:1px solid #293847;border-radius:18px;padding:30px">
        <p style="margin:0;color:#7fa9ff;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase">ProTrade Account Security</p>
        <h1 style="margin:14px 0 8px;font-size:26px">Sign-in email changed</h1>
        <p style="color:#b7c2ce;line-height:1.65">
          Your sign-in email was changed from <strong>${escapeHtml(oldEmail)}</strong>
          to <strong>${escapeHtml(newEmail)}</strong>.
        </p>
        <p style="color:#b7c2ce;line-height:1.65">
          All existing device sessions were signed out. Sign in again using the new address.
        </p>
        <p style="color:#ff9c96;font-size:13px;line-height:1.6">
          If this was not you, reset your password and contact support immediately.
        </p>
      </div>
    </div>
  `;

  const payload = {
    subject,
    text,
    html,
    tags: ["protrade-email-changed"],
  };

  return Promise.allSettled([
    sendEmail({ ...payload, to: oldEmail }),
    sendEmail({ ...payload, to: newEmail }),
  ]);
};

const sendAccountDeletedNotice = ({ name, email }) => {
  const subject = "Your ProTrade account was deleted";
  const text = [
    `Hello ${name || "Trader"},`,
    "",
    "Your ProTrade account and its stored workspace data were permanently deleted.",
    "All device sessions were revoked.",
    "",
    "If you did not perform this action, secure your email account immediately.",
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;background:#0b1117;padding:28px;color:#eef4fb">
      <div style="max-width:620px;margin:auto;background:#151d26;border:1px solid #293847;border-radius:18px;padding:30px">
        <p style="margin:0;color:#ff8f88;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase">ProTrade Account Security</p>
        <h1 style="margin:14px 0 8px;font-size:26px">Account deleted</h1>
        <p style="color:#b7c2ce;line-height:1.65">
          Your ProTrade account and its stored workspace data were permanently deleted.
          All device sessions were revoked.
        </p>
        <p style="color:#ff9c96;font-size:13px;line-height:1.6">
          If you did not perform this action, secure your email account immediately.
        </p>
      </div>
    </div>
  `;

  return sendEmail({
    to: email,
    subject,
    text,
    html,
    tags: ["protrade-account-deleted"],
  });
};

const publicEmailAction = (action) => ({
  id: action._id,
  currentEmail: maskEmail(action.currentEmail),
  newEmail: maskEmail(action.newEmail),
  currentEmailApproved: Boolean(action.currentEmailApprovedAt),
  newEmailApproved: Boolean(action.newEmailApprovedAt),
  completed: Boolean(action.usedAt),
  canceled: Boolean(action.canceledAt),
  expiresAt: action.expiresAt,
  createdAt: action.createdAt,
});

const findPendingEmailAction = (userId) =>
  AccountAction.findOne({
    user: userId,
    type: "email-change",
    usedAt: null,
    canceledAt: null,
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

// POST /api/account/email-change/request
const requestEmailChange = async (req, res, next) => {
  try {
    const newEmail = normalizeEmail(req.body?.newEmail);
    const currentPassword = String(req.body?.currentPassword || "");

    if (!isValidEmail(newEmail)) {
      throw accountError(
        400,
        "INVALID_NEW_EMAIL",
        "Enter a valid new email address."
      );
    }

    const user = await User.findById(req.user._id).select("+password");

    if (!user || !user.isActive) {
      throw accountError(404, "ACCOUNT_NOT_FOUND", "Account not found.");
    }

    if (newEmail === user.email) {
      throw accountError(
        400,
        "EMAIL_UNCHANGED",
        "The new email must be different from the current email."
      );
    }

    const duplicate = await User.exists({
      email: newEmail,
      _id: { $ne: user._id },
    });

    if (duplicate) {
      throw accountError(
        409,
        "EMAIL_ALREADY_IN_USE",
        "Another account already uses this email address."
      );
    }

    if (user.password) {
      if (!currentPassword) {
        throw accountError(
          400,
          "PASSWORD_REQUIRED",
          "Enter your current password to request an email change."
        );
      }

      const passwordMatches = await user.comparePassword(currentPassword);

      if (!passwordMatches) {
        throw accountError(
          401,
          "INCORRECT_PASSWORD",
          "Current password is incorrect."
        );
      }
    }

    await AccountAction.updateMany(
      {
        user: user._id,
        type: "email-change",
        usedAt: null,
        canceledAt: null,
      },
      {
        $set: {
          canceledAt: new Date(),
        },
      }
    );

    const currentToken = crypto.randomBytes(32).toString("hex");
    const newToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(
      Date.now() + EMAIL_ACTION_MINUTES * 60 * 1000
    );

    const action = await AccountAction.create({
      type: "email-change",
      user: user._id,
      currentEmail: user.email,
      newEmail,
      currentEmailTokenHash: hashValue(currentToken),
      newEmailTokenHash: hashValue(newToken),
      requestedSessionId: req.authSession?.sessionId || "",
      expiresAt,
    });

    const currentLink = createActionLink({
      actionId: action._id,
      side: "current",
      token: currentToken,
    });

    const newLink = createActionLink({
      actionId: action._id,
      side: "new",
      token: newToken,
    });

    const currentMessage = emailChangeMessage({
      user,
      action,
      currentLink,
      newLink,
      recipientSide: "current",
    });

    const newMessage = emailChangeMessage({
      user,
      action,
      currentLink,
      newLink,
      recipientSide: "new",
    });

    try {
      await Promise.all([
        sendEmail({
          to: action.currentEmail,
          ...currentMessage,
          tags: ["protrade-email-change-current-approval"],
        }),
        sendEmail({
          to: action.newEmail,
          ...newMessage,
          tags: ["protrade-email-change-new-verification"],
        }),
      ]);
    } catch (emailError) {
      await AccountAction.updateOne(
        { _id: action._id },
        { $set: { canceledAt: new Date() } }
      );

      throw accountError(
        502,
        "EMAIL_DELIVERY_FAILED",
        "Approval emails could not be sent. Please try again."
      );
    }

    res.status(202).json({
      success: true,
      message:
        "Approval links were sent to your current and new email addresses. Open both links to complete the change.",
      data: publicEmailAction(action),
      passwordRequired: Boolean(user.password),
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/account/email-change/status
const getEmailChangeStatus = async (req, res, next) => {
  try {
    const action = await findPendingEmailAction(req.user._id);

    res.status(200).json({
      success: true,
      pending: Boolean(action),
      data: action ? publicEmailAction(action) : null,
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/account/email-change/cancel
const cancelEmailChange = async (req, res, next) => {
  try {
    const result = await AccountAction.updateMany(
      {
        user: req.user._id,
        type: "email-change",
        usedAt: null,
        canceledAt: null,
      },
      {
        $set: {
          canceledAt: new Date(),
        },
      }
    );

    res.status(200).json({
      success: true,
      message:
        result.modifiedCount > 0
          ? "Pending email change canceled."
          : "No pending email change was found.",
    });
  } catch (error) {
    next(error);
  }
};

const completeEmailChange = async (actionId) => {
  const claimed = await AccountAction.findOneAndUpdate(
    {
      _id: actionId,
      type: "email-change",
      currentEmailApprovedAt: { $ne: null },
      newEmailApprovedAt: { $ne: null },
      usedAt: null,
      canceledAt: null,
      finalizingAt: null,
      expiresAt: { $gt: new Date() },
    },
    {
      $set: {
        finalizingAt: new Date(),
      },
    },
    {
      new: true,
    }
  );

  if (!claimed) {
    return null;
  }

  try {
    const user = await User.findOne({
      _id: claimed.user,
      email: claimed.currentEmail,
      isActive: true,
    });

    if (!user) {
      claimed.canceledAt = new Date();
      claimed.finalizingAt = null;
      await claimed.save({ validateBeforeSave: false });

      throw accountError(
        409,
        "ACCOUNT_STATE_CHANGED",
        "This email-change request is no longer valid."
      );
    }

    const duplicate = await User.exists({
      email: claimed.newEmail,
      _id: { $ne: user._id },
    });

    if (duplicate) {
      claimed.canceledAt = new Date();
      claimed.finalizingAt = null;
      await claimed.save({ validateBeforeSave: false });

      throw accountError(
        409,
        "EMAIL_ALREADY_IN_USE",
        "The new email is now used by another account."
      );
    }

    const oldEmail = user.email;
    user.email = claimed.newEmail;
    user.isEmailVerified = true;
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    user.emailVerificationToken = null;
    user.emailVerificationExpires = null;
    user.emailVerificationSessionToken = null;
    user.emailVerificationSessionExpires = null;
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    user.passwordResetSessionToken = null;
    user.passwordResetSessionExpires = null;
    user.passwordResetSessionCompletedAt = null;

    await user.save({ validateBeforeSave: false });

    await Setting.updateOne(
      { user: user._id },
      {
        $set: {
          email: user.email,
        },
      }
    );

    await revokeAllUserSessions(user._id, "email-changed");

    claimed.usedAt = new Date();
    claimed.finalizingAt = null;
    await claimed.save({ validateBeforeSave: false });

    setImmediate(() => {
      sendEmailChangeCompletion({
        userName: user.name,
        oldEmail,
        newEmail: user.email,
      }).catch((error) => {
        console.error("Email-change completion notice failed:", error.message);
      });
    });

    return {
      user,
      oldEmail,
      newEmail: user.email,
      action: claimed,
    };
  } catch (error) {
    if (!claimed.usedAt && !claimed.canceledAt) {
      claimed.finalizingAt = null;
      await claimed.save({ validateBeforeSave: false }).catch(() => {});
    }
    throw error;
  }
};

// POST /api/account/email-change/confirm (public)
const confirmEmailChange = async (req, res, next) => {
  try {
    const actionId = String(req.body?.id || "").trim();
    const side = String(req.body?.side || "").trim().toLowerCase();
    const token = String(req.body?.token || "").trim();

    if (!mongoose.isValidObjectId(actionId)) {
      throw accountError(
        400,
        "INVALID_EMAIL_CHANGE_LINK",
        "This email-change link is invalid."
      );
    }

    if (!["current", "new"].includes(side) || !/^[a-f0-9]{64}$/i.test(token)) {
      throw accountError(
        400,
        "INVALID_EMAIL_CHANGE_LINK",
        "This email-change link is invalid."
      );
    }

    const action = await AccountAction.findOne({
      _id: actionId,
      type: "email-change",
    }).select("+currentEmailTokenHash +newEmailTokenHash");

    if (
      !action ||
      action.usedAt ||
      action.canceledAt ||
      action.expiresAt <= new Date()
    ) {
      throw accountError(
        410,
        "EMAIL_CHANGE_LINK_EXPIRED",
        "This email-change link has expired or is no longer active."
      );
    }

    const expectedHash =
      side === "current"
        ? action.currentEmailTokenHash
        : action.newEmailTokenHash;

    if (!safeEqualHex(hashValue(token), expectedHash)) {
      throw accountError(
        400,
        "INVALID_EMAIL_CHANGE_LINK",
        "This email-change link is invalid."
      );
    }

    const approvalField =
      side === "current"
        ? "currentEmailApprovedAt"
        : "newEmailApprovedAt";

    if (!action[approvalField]) {
      action[approvalField] = new Date();
      await action.save({ validateBeforeSave: false });
    }

    const completion = await completeEmailChange(action._id);

    if (completion) {
      return res.status(200).json({
        success: true,
        completed: true,
        message:
          "Email changed successfully. All devices were signed out for security.",
        data: {
          newEmail: maskEmail(completion.newEmail),
        },
      });
    }

    const latest = await AccountAction.findById(action._id);

    if (latest?.usedAt) {
      return res.status(200).json({
        success: true,
        completed: true,
        message:
          "Email changed successfully. All devices were signed out for security.",
        data: {
          newEmail: maskEmail(latest.newEmail),
        },
      });
    }

    res.status(200).json({
      success: true,
      completed: false,
      message:
        side === "current"
          ? "Current email approved. Open the link sent to the new email address."
          : "New email verified. Open the approval link sent to the current email address.",
      data: latest ? publicEmailAction(latest) : null,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return next(
        accountError(
          409,
          "EMAIL_ALREADY_IN_USE",
          "The new email is now used by another account."
        )
      );
    }

    next(error);
  }
};

const cleanDocument = (document, extraFields = []) => {
  const value = JSON.parse(JSON.stringify(document || {}));

  [
    "__v",
    "user",
    "singletonKey",
    "refreshTokenHash",
    "sessionId",
    "userAgent",
    "ipAddressHash",
    "fingerprintHash",
    ...extraFields,
  ].forEach((field) => {
    delete value[field];
  });

  return value;
};

// GET /api/account/export
const exportAccountData = async (req, res, next) => {
  try {
    const userId = req.user._id;

    const [user, trades, journals, settings, sessions] = await Promise.all([
      User.findById(userId).lean(),
      Trade.find({ user: userId }).sort({ tradeDate: -1 }).lean(),
      Journal.find({ user: userId }).sort({ journalDate: -1 }).lean(),
      Setting.findOne({ user: userId }).lean(),
      Session.find({ user: userId })
        .sort({ lastActiveAt: -1 })
        .select(
          "-user -__v -refreshTokenHash -sessionId -userAgent -ipAddressHash -fingerprintHash"
        )
        .lean(),
    ]);

    if (!user) {
      throw accountError(404, "ACCOUNT_NOT_FOUND", "Account not found.");
    }

    const account = {
      id: user._id,
      name: user.name,
      email: user.email,
      authProvider: user.authProvider,
      role: user.role,
      isEmailVerified: user.isEmailVerified === true,
      isActive: user.isActive === true,
      avatarUrl: user.avatarUrl || "",
      lastLoginAt: user.lastLoginAt || null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    const exportPayload = {
      success: true,
      exportVersion: 1,
      generatedAt: new Date().toISOString(),
      account,
      counts: {
        trades: trades.length,
        journals: journals.length,
        settings: settings ? 1 : 0,
        sessions: sessions.length,
      },
      workspace: {
        settings: settings ? cleanDocument(settings) : null,
        trades: trades.map((trade) => cleanDocument(trade)),
        journals: journals.map((journal) => cleanDocument(journal)),
      },
      security: {
        sessions: sessions.map((session) => cleanDocument(session)),
        note:
          "Passwords, tokens, token hashes, raw IP addresses and private security secrets are never included.",
      },
    };

    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="protrade-account-data-${date}.json"`
    );

    res.status(200).json(exportPayload);
  } catch (error) {
    next(error);
  }
};

// DELETE /api/account
const deleteAccount = async (req, res, next) => {
  let databaseSession;

  try {
    const currentPassword = String(req.body?.currentPassword || "");
    const confirmationText = String(req.body?.confirmationText || "").trim();
    const emailConfirmation = normalizeEmail(req.body?.emailConfirmation);

    if (confirmationText !== "DELETE") {
      throw accountError(
        400,
        "DELETE_CONFIRMATION_REQUIRED",
        'Type "DELETE" exactly to confirm permanent account deletion.'
      );
    }

    const user = await User.findById(req.user._id).select("+password");

    if (!user) {
      throw accountError(404, "ACCOUNT_NOT_FOUND", "Account not found.");
    }

    if (emailConfirmation !== user.email) {
      throw accountError(
        400,
        "EMAIL_CONFIRMATION_MISMATCH",
        "Enter your current account email exactly."
      );
    }

    if (user.password) {
      if (!currentPassword) {
        throw accountError(
          400,
          "PASSWORD_REQUIRED",
          "Enter your current password to delete this account."
        );
      }

      const passwordMatches = await user.comparePassword(currentPassword);

      if (!passwordMatches) {
        throw accountError(
          401,
          "INCORRECT_PASSWORD",
          "Current password is incorrect."
        );
      }
    }

    const deletedAccount = {
      name: user.name,
      email: user.email,
    };

    const counts = {
      trades: 0,
      journals: 0,
      settings: 0,
      sessions: 0,
      accountActions: 0,
      users: 0,
    };

    databaseSession = await mongoose.startSession();

    await databaseSession.withTransaction(async () => {
      const tradeResult = await Trade.deleteMany(
        { user: user._id },
        { session: databaseSession }
      );
      counts.trades = tradeResult.deletedCount;

      const journalResult = await Journal.deleteMany(
        { user: user._id },
        { session: databaseSession }
      );
      counts.journals = journalResult.deletedCount;

      const settingResult = await Setting.deleteMany(
        { user: user._id },
        { session: databaseSession }
      );
      counts.settings = settingResult.deletedCount;

      const sessionResult = await Session.deleteMany(
        { user: user._id },
        { session: databaseSession }
      );
      counts.sessions = sessionResult.deletedCount;

      const actionResult = await AccountAction.deleteMany(
        { user: user._id },
        { session: databaseSession }
      );
      counts.accountActions = actionResult.deletedCount;

      const userResult = await User.deleteOne(
        { _id: user._id },
        { session: databaseSession }
      );
      counts.users = userResult.deletedCount;

      if (counts.users !== 1) {
        throw new Error("Account deletion could not be completed.");
      }
    });

    setImmediate(() => {
      sendAccountDeletedNotice(deletedAccount).catch((error) => {
        console.error("Account-deletion notice failed:", error.message);
      });
    });

    res.status(200).json({
      success: true,
      message:
        "Your ProTrade account and stored workspace data were permanently deleted.",
      deleted: counts,
    });
  } catch (error) {
    next(error);
  } finally {
    if (databaseSession) {
      await databaseSession.endSession().catch(() => {});
    }
  }
};

module.exports = {
  requestEmailChange,
  getEmailChangeStatus,
  cancelEmailChange,
  confirmEmailChange,
  exportAccountData,
  deleteAccount,
};
