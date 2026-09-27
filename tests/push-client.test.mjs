import test from "node:test";
import assert from "node:assert/strict";
import { PhoneReminders } from "../push-client.js";
function setup(getTasks = () => []) {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (k) => storage.get(k),
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => storage.delete(k),
  };
  globalThis.window = { addEventListener() {} };
  globalThis.document = { addEventListener() {} };
  globalThis.Notification = { permission: "granted" };
  let unsubscribed = false;
  const sub = {
    toJSON: () => ({}),
    unsubscribe: async () => {
      unsubscribed = true;
    },
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      onLine: true,
      serviceWorker: {
        ready: Promise.resolve({
          pushManager: { getSubscription: async () => sub },
        }),
      },
    },
  });
  const phone = new PhoneReminders({ getTasks, getLanguage: () => "en" });
  phone.enabled = true;
  return { phone, unsubscribed: () => unsubscribed };
}
test("offline completion stays pending and removes server reminders when online", async () => {
  let tasks = [
    {
      id: "a",
      title: "Task",
      due: "",
      done: false,
      reminder: {
        daily: true,
        onDue: false,
        start: "2026-09-27",
        time: "09:00",
        timeZone: "UTC",
      },
    },
  ];
  const { phone } = setup(() => tasks);
  const calls = [];
  phone.call = async (a, p) => calls.push(p);
  navigator.onLine = false;
  tasks[0].done = true;
  await phone.sync();
  assert.equal(phone.dirty, true);
  assert.equal(calls.length, 0);
  navigator.onLine = true;
  await phone.sync();
  assert.deepEqual(calls[0].tasks, []);
  assert.equal(phone.dirty, false);
});
test("stop waits for in-flight sync before disabling device", async () => {
  const { phone, unsubscribed } = setup();
  const calls = [];
  let release;
  const gate = new Promise((r) => (release = r));
  phone.call = async (a) => {
    calls.push(a);
    if (a === "sync") await gate;
  };
  const syncing = phone.sync();
  await new Promise((r) => setTimeout(r, 0));
  const stopping = phone.disable();
  assert.deepEqual(calls, ["sync"]);
  release();
  await Promise.all([syncing, stopping]);
  assert.deepEqual(calls, ["sync", "disable"]);
  assert.equal(phone.enabled, false);
  assert.equal(unsubscribed(), true);
});
test("unreadable local tasks cannot erase server reminder copy", async () => {
  const { phone } = setup(() => {
    throw Error("storage");
  });
  let calls = 0;
  phone.call = async () => calls++;
  await phone.sync();
  assert.equal(calls, 0);
  assert.equal(phone.dirty, true);
  assert.equal(phone.message, "pending");
});
