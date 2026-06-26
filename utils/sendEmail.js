const https = require("node:https");

const BREVO_API_HOST = "api.brevo.com";
const BREVO_API_PATH = "/v3/smtp/email";

const requiredEnvironmentVariables = [
  "BREVO_API_KEY",
  "BREVO_SENDER_EMAIL",
  "BREVO_SENDER_NAME",
];

const assertBrevoConfiguration = () => {
  const missing = requiredEnvironmentVariables.filter(
    (name) => !process.env[name]
  );

  if (missing.length > 0) {
    throw new Error(
      `Brevo configuration is incomplete: ${missing.join(", ")}`
    );
  }
};

const postJson = ({ hostname, path, headers, body }) =>
  new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);

    const request = https.request(
      {
        hostname,
        path,
        method: "POST",
        port: 443,
        headers: {
          ...headers,
          "Content-Type": "application/json",
          Accept: "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
        timeout: 30000,
      },
      (response) => {
        let responseBody = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });

        response.on("end", () => {
          let parsedBody = {};

          if (responseBody) {
            try {
              parsedBody = JSON.parse(responseBody);
            } catch {
              parsedBody = { raw: responseBody };
            }
          }

          if (
            response.statusCode &&
            response.statusCode >= 200 &&
            response.statusCode < 300
          ) {
            return resolve({
              statusCode: response.statusCode,
              data: parsedBody,
            });
          }

          const message =
            parsedBody.message ||
            parsedBody.code ||
            `Brevo API request failed with status ${response.statusCode}`;

          const error = new Error(message);
          error.statusCode = response.statusCode;
          error.response = parsedBody;
          reject(error);
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error("Brevo API request timed out."));
    });

    request.on("error", reject);
    request.write(payload);
    request.end();
  });

const inferTags = ({ subject, tags }) => {
  const supplied = Array.isArray(tags)
    ? tags
        .map((tag) => String(tag || "").trim())
        .filter(Boolean)
        .slice(0, 10)
    : [];

  if (supplied.length > 0) return supplied;

  const value = String(subject || "").toLowerCase();
  if (value.includes("new login") || value.includes("new device")) {
    return ["protrade-new-device-login"];
  }
  if (value.includes("verify") || value.includes("verification")) {
    return ["protrade-email-verification"];
  }
  if (value.includes("password") || value.includes("reset")) {
    return ["protrade-password-reset"];
  }
  return ["protrade-security"];
};

const sendEmail = async ({ to, subject, text, html, tags = [] }) => {
  assertBrevoConfiguration();

  const recipientEmail = String(to || "").trim();

  if (!recipientEmail) {
    throw new Error("Recipient email is required.");
  }

  const result = await postJson({
    hostname: BREVO_API_HOST,
    path: BREVO_API_PATH,
    headers: {
      "api-key": process.env.BREVO_API_KEY,
    },
    body: {
      sender: {
        name: process.env.BREVO_SENDER_NAME,
        email: process.env.BREVO_SENDER_EMAIL,
      },
      to: [{ email: recipientEmail }],
      subject,
      htmlContent: html,
      textContent: text,
      tags: inferTags({ subject, tags }),
    },
  });

  return {
    messageId: result.data.messageId || null,
    statusCode: result.statusCode,
  };
};

module.exports = { sendEmail };
