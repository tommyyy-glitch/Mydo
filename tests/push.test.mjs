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
  assert.equal((await handle(req({ text: "x".repeat(1000001) }))).status, 413);
  assert.equal(
    (
      await handle(
        new Request("https://test", { method: "POST", body: "oops" }),
      )
    ).status,
    400,
  );
});
test("push service accepts and preserves weekly/monthly repeating reminders",()=>{
  for(const repeat of ['weekly','monthly']){
    const t={...task,due:'',reminder:{...task.reminder,onDue:false,daily:false,repeat}};
    assert.equal(validateTasks([t])[0].reminder.repeat,repeat);
    assert.throws(()=>validateTasks([{...t,reminder:{...t.reminder,start:''}}]),/tasks/);
  }
});
test("weekly and monthly notification titles match the selected language",async()=>{
  for(const [language,frequency,title] of [['en','weekly','Weekly reminder'],['zh','monthly','每月提醒']]){
    let payload;await deliverDue({claim:async()=>[{task_id:'a',device_id:device,title:'Task',subscription:sub,language,frequency}],current:async()=>true,markSent:async()=>{}},async(s,p)=>{payload=p;return {ok:true}});
    assert.ok(payload.title.includes(title));
  }
});
const routineTask = {
  ...task, kind: "routine", due: "", notes: "Private medication notes",
  routine: { frequency: "weekly", weekdays: [1, 3, 5], start: "2026-10-03",
    timeZone: "Asia/Hong_Kong", paused: false,
    checks: { "2026-10-05": true, "2026-10-07": false } },
  reminder: { ...task.reminder, onDue: false, daily: false, repeat: "weekly", start: "2026-10-03" },
};
test("routine push projection keeps recurrence/checks and strips private notes", () => {
  const [saved] = validateTasks([routineTask]);
  assert.equal(saved.kind, "routine");
  assert.deepEqual(saved.routine, routineTask.routine);
  assert.equal(saved.notes, undefined);
  assert.notEqual(saved.routine.checks, routineTask.routine.checks);
  assert.deepEqual(validateTasks([{ ...routineTask, routine: { ...routineTask.routine, paused: true } }])[0].routine.paused, true);
});
test("routine push validation rejects malformed schedules and inconsistent reminders", () => {
  for (const routine of [
    { ...routineTask.routine, weekdays: [] },
    { ...routineTask.routine, weekdays: [1, 1] },
    { ...routineTask.routine, weekdays: [7] },
    { ...routineTask.routine, weekdays: [1.5] },
    { ...routineTask.routine, frequency: "daily" },
    { ...routineTask.routine, start: "2026-02-30" },
    { ...routineTask.routine, paused: "false" },
    { ...routineTask.routine, checks: { "2026-02-30": true } },
    { ...routineTask.routine, checks: { "2026-10-05": 1 } },
  ]) assert.throws(() => validateTasks([{ ...routineTask, routine }]), /tasks/);
  for (const reminder of [
    { ...routineTask.reminder, onDue: true },
    { ...routineTask.reminder, repeat: "monthly" },
    { ...routineTask.reminder, start: "2026-10-04" },
    { ...routineTask.reminder, timeZone: "UTC" },
  ]) assert.throws(() => validateTasks([{ ...routineTask, reminder }]), /tasks/);
  assert.throws(() => validateTasks([{ ...routineTask, kind: "task" }]), /tasks/);
  assert.throws(() => validateTasks([{ ...routineTask, done: true }]), /tasks/);
});
test("routine jobs use bilingual routine titles and route markers; invalidated checked jobs skip delivery", async () => {
  for (const language of ["en", "zh"]) {
    let payload;
    const jobs = ["checked", "open"].map((task_id) => ({ task_id, device_id: device,
      title: "Routine", subscription: sub, language, is_routine: true, frequency: "weekly" }));
    const result = await deliverDue({ claim: async () => jobs,
      current: async (job) => job.task_id !== "checked", markSent: async () => {} },
    async (s, p) => { payload = p; return { ok: true }; });
    assert.equal(payload.title, language === "zh" ? "Mydo · 日常提醒" : "Mydo · Routine reminder");
    assert.equal(payload.kind, "routine");
    assert.equal(payload.taskId, "open");
    assert.deepEqual(result, { sent: 1, failed: 0 });
  }
});
