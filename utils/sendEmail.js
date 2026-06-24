const dns = require("node:dns").promises;
const nodemailer = require("nodemailer");

const requiredEnvironmentVariables = [
  "EMAIL_HOST",
  "EMAIL_PORT",
  "EMAIL_USER",
  "EMAIL_PASS",
  "EMAIL_FROM",
];

const assertEmailConfiguration = () => {
  const missing = requiredEnvironmentVariables.filter(
    (name) => !process.env[name]
  );

  if (missing.length > 0) {
    throw new Error(
      `Email configuration is incomplete: ${missing.join(", ")}`
    );
  }
};

const resolveIpv4Host = async (hostname) => {
  const addresses = await dns.resolve4(hostname);

  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new Error(`No IPv4 address found for SMTP host: ${hostname}`);
  }

  return addresses[0];
};

const createTransporter = async () => {
  assertEmailConfiguration();

  const smtpHostname = process.env.EMAIL_HOST;
  const ipv4Address = await resolveIpv4Host(smtpHostname);

  const secure =
    String(process.env.EMAIL_SECURE || "false").toLowerCase() === "true";

  return nodemailer.createTransport({
    host: ipv4Address,
    port: Number(process.env.EMAIL_PORT),
    secure,

    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },

    tls: {
      servername: smtpHostname,
    },

    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 60000,
  });
};

const sendEmail = async ({ to, subject, text, html }) => {
  const transporter = await createTransporter();

  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    text,
    html,
  });
};

module.exports = { sendEmail };