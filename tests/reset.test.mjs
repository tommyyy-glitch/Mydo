import test from "node:test";
import assert from "node:assert/strict";
import {
  recoveryToken,
  passwordError,
  sendRecovery,
  updatePassword,
  RESET_URL,
} from "../reset.js";
test("only explicit bearer recovery links are accepted", () => {
  assert.equal(
    recoveryToken("#access_token=test&type=recovery&token_type=bearer"),
    "test",
  );
  for (const fragment of [
    "#access_token=test&type=signup&token_type=bearer",
    "#access_token=test&type=recovery",
    "#error=expired&access_token=test&type=recovery&token_type=bearer",
    "",
  ])
    assert.equal(recoveryToken(fragment), null);
});
test("password updates reject missing recovery token, short and mismatched passwords before network", async () => {
  let calls = 0;
  const request = async () => {
    calls++;
    return Response.json({});
  };
  await assert.rejects(
    updatePassword(null, "long-password-a", "long-password-a", request),
  );
  await assert.rejects(updatePassword("test", "short", "short", request));
  await assert.rejects(
    updatePassword("test", "long-password-a", "long-password-b", request),
  );
  assert.equal(calls, 0);
  assert.equal(passwordError("long-password-a", "long-password-a"), "");
});
test("recovery mail has a fixed HTTPS return destination and sends only trimmed email", async () => {
  let captured;
  await sendRecovery(" example@example.com ", async (url, options) => {
    captured = { url, options };
    return Response.json({});
  });
  assert.equal(
    new URL(captured.url).searchParams.get("redirect_to"),
    RESET_URL,
  );
  assert.deepEqual(JSON.parse(captured.options.body), {
    email: "example@example.com",
  });
  assert.equal(captured.options.headers.Authorization, undefined);
  assert.equal(captured.options.redirect, "error");
});
test("password update authenticates to Supabase and does not put secrets in URLs", async () => {
  let captured;
  await updatePassword(
    "test-token",
    "long-password-a",
    "long-password-a",
    async (url, options) => {
      captured = { url, options };
      return Response.json({ id: "test-user" });
    },
  );
  assert.ok(captured.url.endsWith("/auth/v1/user"));
  assert.equal(captured.options.method, "PUT");
  assert.equal(captured.options.headers.Authorization, "Bearer test-token");
  assert.deepEqual(JSON.parse(captured.options.body), {
    password: "long-password-a",
  });
  assert.equal(captured.options.credentials, "omit");
});
test("email errors are mapped without reflecting server messages", async () => {
  await assert.rejects(
    sendRecovery("example@example.com", async () =>
      Response.json({ message: "sensitive detail" }, { status: 429 }),
    ),
    /^Error: rate$/,
  );
  await assert.rejects(
    sendRecovery("example@example.com", async () =>
      Response.json({ message: "sensitive detail" }, { status: 500 }),
    ),
    /^Error: request$/,
  );
});
