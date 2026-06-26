const target = String(
  process.argv[2] ||
    process.env.API_BASE_URL ||
    "https://protrader-backend-n8oj.onrender.com"
).replace(/\/+$/, "");

const requiredHeaders = [
  "content-security-policy",
  "cross-origin-opener-policy",
  "referrer-policy",
  "strict-transport-security",
  "x-content-type-options",
  "x-dns-prefetch-control",
  "x-frame-options",
  "x-request-id",
];

const run = async () => {
  console.log(`Checking: ${target}`);

  const health = await fetch(`${target}/api/health`);
  const body = await health.json().catch(() => ({}));

  console.log("");
  console.log("Health:");
  console.log(`  status=${health.status}`);
  console.log(`  success=${body.success === true}`);

  console.log("");
  console.log("Security headers:");

  let missing = 0;

  for (const header of requiredHeaders) {
    const value = health.headers.get(header);
    console.log(`  ${header}: ${value ? "present" : "MISSING"}`);

    if (!value) {
      missing += 1;
    }
  }

  const notFound = await fetch(`${target}/api/security-audit-does-not-exist`);
  const notFoundBody = await notFound.json().catch(() => ({}));

  console.log("");
  console.log("Safe 404:");
  console.log(`  status=${notFound.status}`);
  console.log(`  code=${notFoundBody.code || "missing"}`);
  console.log(
    `  requestId=${notFoundBody.requestId ? "present" : "missing"}`
  );

  const unsafeInput = await fetch(`${target}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: {
        $ne: null,
      },
      password: "security-audit-test",
    }),
  });

  const unsafeBody = await unsafeInput.json().catch(() => ({}));

  console.log("");
  console.log("Unsafe input rejection:");
  console.log(`  status=${unsafeInput.status}`);
  console.log(`  code=${unsafeBody.code || "missing"}`);

  const failed =
    health.status !== 200 ||
    missing > 0 ||
    notFound.status !== 404 ||
    notFoundBody.code !== "ROUTE_NOT_FOUND" ||
    unsafeInput.status !== 400 ||
    unsafeBody.code !== "INVALID_REQUEST_INPUT";

  console.log("");

  if (failed) {
    console.error("Batch 2 audit FAILED.");
    process.exitCode = 1;
    return;
  }

  console.log("Batch 2 audit PASSED.");
};

run().catch((error) => {
  console.error("Audit failed:");
  console.error(error.message);
  process.exitCode = 1;
});
