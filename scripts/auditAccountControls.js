const target = String(
  process.argv[2] ||
    process.env.API_BASE_URL ||
    "https://protrader-backend-n8oj.onrender.com"
).replace(/\/+$/, "");

const readJson = async (response) =>
  response.json().catch(() => ({}));

const run = async () => {
  console.log(`Checking: ${target}`);

  const statusResponse = await fetch(
    `${target}/api/account/email-change/status`
  );
  const statusBody = await readJson(statusResponse);

  console.log("");
  console.log("Protected email-change status:");
  console.log(`  status=${statusResponse.status}`);
  console.log(`  success=${statusBody.success}`);

  const exportResponse = await fetch(`${target}/api/account/export`);
  const exportBody = await readJson(exportResponse);

  console.log("");
  console.log("Protected account export:");
  console.log(`  status=${exportResponse.status}`);
  console.log(`  success=${exportBody.success}`);

  const deleteResponse = await fetch(`${target}/api/account`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      confirmationText: "DELETE",
      emailConfirmation: "nobody@example.com",
      currentPassword: "not-a-real-password",
    }),
  });
  const deleteBody = await readJson(deleteResponse);

  console.log("");
  console.log("Protected account deletion:");
  console.log(`  status=${deleteResponse.status}`);
  console.log(`  success=${deleteBody.success}`);

  const confirmResponse = await fetch(
    `${target}/api/account/email-change/confirm`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: "invalid",
        side: "new",
        token: "invalid",
      }),
    }
  );
  const confirmBody = await readJson(confirmResponse);

  console.log("");
  console.log("Safe public email action:");
  console.log(`  status=${confirmResponse.status}`);
  console.log(`  code=${confirmBody.code || "missing"}`);
  console.log(
    `  requestId=${confirmBody.requestId ? "present" : "missing"}`
  );

  const passed =
    statusResponse.status === 401 &&
    exportResponse.status === 401 &&
    deleteResponse.status === 401 &&
    confirmResponse.status === 400 &&
    confirmBody.code === "INVALID_EMAIL_CHANGE_LINK";

  console.log("");

  if (!passed) {
    console.error("Batch 4 public account-control audit FAILED.");
    process.exitCode = 1;
    return;
  }

  console.log("Batch 4 public account-control audit PASSED.");
};

run().catch((error) => {
  console.error("Audit failed:");
  console.error(error.message);
  process.exitCode = 1;
});
