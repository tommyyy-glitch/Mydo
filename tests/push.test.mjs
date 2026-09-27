import test from "node:test";
import assert from "node:assert/strict";
import {
  createHandler,
  deliverDue,
  validateSubscription,
  validateTasks,
} from "../supabase/functions/mydo-push/core.js";
const user = "01234567-1234-4123-8123-012345678901",
  device = "01234567-1234-4123-8123-012345678902";
const sub = {
  endpoint: "https://web.push.apple.com/QAtest",
  keys: { p256dh: "A".repeat(87), auth: "A".repeat(22) },
};
const task = {
  id: "a",
  title: "Task",
  due: "2026-09-27",
  done: false,
  notes: "private",
  reminder: {
    onDue: true,
    daily: true,
    time: "09:00",
    timeZone: "Asia/Hong_Kong",
    start: "2026-09-27",
  },
};
function setup(overrides = {}) {
  const calls = [];
  const db = {
    sync: async (...args) => calls.push(args),
    disable: async (...args) => calls.push(args),
    claim: async () => [],
    ...overrides,
  };
  const handle = createHandler({
    db,
    verifyUser: async (token) => (token === "valid" ? { id: user } : null),
    send: async () => ({ ok: true }),
    publicKey: "public",
    cronSecret: "cron-only",
    origin: "https://tommyyy-glitch.github.io",
  });
  return { calls, handle };
}
const req = (
  body,
  token = "valid",
  origin = "https://tommyyy-glitch.github.io",
) =>
  new Request("https://test/functions/v1/mydo-push", {
    method: "POST",
    headers: { authorization: "Bearer " + token, origin },
    body: JSON.stringify(body),
  });
test("rejects untrusted push endpoints and strips extra data", () => {
  assert.throws(() =>
    validateSubscription({ ...sub, endpoint: "https://localhost/" }),
  );
  assert.throws(() =>
    validateSubscription({
      ...sub,
      endpoint: "https://web.push.apple.com.evil.test/",
    }),
  );
  assert.equal(validateTasks([task])[0].notes, undefined);
});
test("rejects invalid dates, duplicate tasks and completed reminders", () => {
  assert.throws(() => validateTasks([{ ...task, due: "2026-02-30" }]));
  assert.throws(() => validateTasks([task, task]));
  assert.throws(() => validateTasks([{ ...task, done: true }]));
});
test("sync identity comes from verified token, never request user", async () => {
  const { handle, calls } = setup();
  assert.equal(
    (
      await handle(
        req({
          action: "sync",
          userId: device,
          deviceId: device,
          tasks: [task],
          subscription: sub,
          language: "en",
        }),
      )
    ).status,
    200,
  );
  assert.equal(calls[0][0], user);
});
test("denies missing auth, foreign origins and cron with ordinary user JWT", async () => {
  const { handle } = setup();
  assert.equal(
    (await handle(req({ action: "disable", deviceId: device }, "bad"))).status,
    401,
  );
  assert.equal(
    (
      await handle(
        req(
          { action: "disable", deviceId: device },
          "valid",
          "https://evil.test",
        ),
      )
    ).status,
    403,
  );
  assert.equal((await handle(req({ action: "dispatch" }))).status, 401);
  assert.equal(
    (await handle(req({ action: "dispatch" }, "cron-only"))).status,
    200,
  );
});
test("invalidated jobs are skipped; successful deliveries acknowledged; expired devices disabled", async () => {
  let marked = [],
    disabled = [],
    sent = [];
  const jobs = [0, 1, 2, 3].map((n) => ({
    task_id: String(n),
    user_id: user,
    device_id: device,
    title: "Task",
    subscription: sub,
    language: "en",
  }));
  const result = await deliverDue(
    {
      claim: async () => jobs,
      current: async (j) => j.task_id !== "0",
      markSent: async (j) => marked.push(j.task_id),
      disable: async (...a) => disabled.push(a),
    },
    async (s, p) => {
      sent.push(p.taskId);
      return p.taskId === "1"
        ? { ok: true }
        : p.taskId === "2"
          ? { ok: false, status: 410 }
          : { ok: false, status: 503 };
    },
  );
  assert.deepEqual(sent, ["1", "2", "3"]);
  assert.deepEqual(marked, ["1"]);
  assert.equal(disabled.length, 1);
  assert.deepEqual(result, { sent: 1, failed: 2 });
});
test("body limit and invalid JSON fail safely", async () => {
  const { handle } = setup();
  assert.equal((await handle(req({ text: "x".repeat(100001) }))).status, 413);
  assert.equal(
    (
      await handle(
        new Request("https://test", { method: "POST", body: "oops" }),
      )
    ).status,
    400,
  );
});
