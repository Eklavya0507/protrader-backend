const jwt = require("jsonwebtoken");
const { sendEmail } = require("./sendEmail");

const positiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const SECURITY_ACTION_TOKEN_HOURS = positiveInteger(
  process.env.SECURITY_ACTION_TOKEN_HOURS,
  24
);

const frontendBaseUrl = () =>
  String(process.env.FRONTEND_URL || "https://eklavya0507.github.io/protrader")
    .trim()
    .replace(/\/+$/, "");

const assertSecret = () => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is missing from environment variables");
  }
};

const createSecurityActionToken = ({ userId, sessionId }) => {
  assertSecret();

  return jwt.sign(
    {
      purpose: "reject-new-device",
      userId: String(userId),
      sessionId: String(sessionId),
    },
    process.env.JWT_SECRET,
    { expiresIn: `${SECURITY_ACTION_TOKEN_HOURS}h` }
  );
};

const verifySecurityActionToken = (token) => {
  assertSecret();

  const payload = jwt.verify(String(token || ""), process.env.JWT_SECRET);

  if (
    payload?.purpose !== "reject-new-device" ||
    !payload?.userId ||
    !payload?.sessionId
  ) {
    const error = new Error("Security action token is invalid.");
    error.statusCode = 400;
    error.code = "INVALID_SECURITY_ACTION";
    throw error;
  }

  return payload;
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const sendNewDeviceLoginAlert = async ({ user, session }) => {
  if (!user?.email || !session?.sessionId) return null;
  if (session.newDeviceAlertSentAt) return null;

  const token = createSecurityActionToken({
    userId: user._id,
    sessionId: session.sessionId,
  });

  const reviewUrl = `${frontendBaseUrl()}/security-action.html?token=${encodeURIComponent(token)}`;
  const location =
    session.approximateLocation &&
    session.approximateLocation !== "Location unavailable"
      ? session.approximateLocation
      : session.timezone || "Location unavailable";

  const time = new Date(session.createdAt || Date.now()).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });

  const subject = "New login detected on your ProTrade account";
  const text = [
    "A new device signed in to your ProTrade account.",
    "",
    `Device: ${session.deviceName || "Unknown device"}`,
    `Location: ${location}`,
    `IP: ${session.ipAddressMasked || "Unavailable"}`,
    `Time: ${time} IST`,
    "",
    "If this was you, no action is required. You can mark the device as trusted in Settings > Security.",
    "If this was not you, review and revoke the device:",
    reviewUrl,
    "",
    `This security action link expires in ${SECURITY_ACTION_TOKEN_HOURS} hours.`,
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#17202a;line-height:1.6">
      <h2 style="margin-bottom:8px">New login detected</h2>
      <p>A new device signed in to your ProTrade account.</p>
      <div style="background:#f4f7fb;border:1px solid #dce4ee;border-radius:12px;padding:18px;margin:20px 0">
        <p style="margin:0 0 8px"><strong>Device:</strong> ${escapeHtml(session.deviceName || "Unknown device")}</p>
        <p style="margin:0 0 8px"><strong>Location:</strong> ${escapeHtml(location)}</p>
        <p style="margin:0 0 8px"><strong>IP:</strong> ${escapeHtml(session.ipAddressMasked || "Unavailable")}</p>
        <p style="margin:0"><strong>Time:</strong> ${escapeHtml(time)} IST</p>
      </div>
      <p>If this was you, no action is required. You can mark the device as trusted in <strong>Settings → Security</strong>.</p>
      <p>If this was not you, review and revoke the device:</p>
      <p style="margin:24px 0">
        <a href="${escapeHtml(reviewUrl)}" style="display:inline-block;background:#1469df;color:#fff;text-decoration:none;padding:13px 20px;border-radius:10px;font-weight:700">Review this login</a>
      </p>
      <p style="font-size:13px;color:#667085">The security link expires in ${SECURITY_ACTION_TOKEN_HOURS} hours. Opening the page does not revoke anything until you confirm.</p>
    </div>
  `;

  const result = await sendEmail({
    to: user.email,
    subject,
    text,
    html,
    tags: ["protrade-new-device-login"],
  });

  session.newDeviceAlertSentAt = new Date();
  await session.save({ validateBeforeSave: false });

  return result;
};

module.exports = {
  createSecurityActionToken,
  verifySecurityActionToken,
  sendNewDeviceLoginAlert,
};
