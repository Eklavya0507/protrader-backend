const target = String(
  process.argv[2] ||
    process.env.API_BASE_URL ||
    "https://protrader-backend-n8oj.onrender.com"
).replace(/\/+$/, "");

const run = async () => {
  console.log(`Checking: ${target}`);

  const response = await fetch(`${target}/api/auth/sessions/revoke-alert`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Client-Device-Id": "batch3-audit-device-1234567890",
    },
    body: JSON.stringify({ token: "invalid-audit-token" }),
  });

  const body = await response.json().catch(() => ({}));
  const corsHeader = response.headers.get("access-control-allow-origin");
  const requestId = response.headers.get("x-request-id") || body.requestId;

  console.log(`status=${response.status}`);
  console.log(`code=${body.code || "missing"}`);
  console.log(`requestId=${requestId ? "present" : "missing"}`);
  console.log(`cors=${corsHeader || "not-shown-for-server-side-request"}`);

  if (
    response.status !== 400 ||
    body.code !== "INVALID_SECURITY_ACTION" ||
    !requestId
  ) {
    console.error("Batch 3 public security-action audit FAILED.");
    process.exitCode = 1;
    return;
  }

  console.log("Batch 3 public security-action audit PASSED.");
};

run().catch((error) => {
  console.error("Audit failed:");
  console.error(error.message);
  process.exitCode = 1;
});
