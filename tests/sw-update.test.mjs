import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../sw.js", import.meta.url), "utf8");
function worker(addAll = async () => {}, { showNotification = async () => {}, clients = {} } = {}) {
  const listeners = new Map();
  let activated = false;
  vm.runInNewContext(source, {
    URL, Request,
    caches: { open: async () => ({ addAll }) },
    self: {
      registration: { scope: "https://example.test/Mydo/", showNotification },
      clients,
      addEventListener: (name, fn) => listeners.set(name, fn),
      skipWaiting: async () => { activated = true; },
    },
  });
  return { listeners, get activated() { return activated; } };
}
test("an update waits for a complete revalidated shell before activating with other tabs open", async () => {
  let complete, requests, started;
  const ready = new Promise(resolve => { complete = resolve; });
  const beginning = new Promise(resolve => { started = resolve; });
  const w = worker(async items => { requests = items; started(); await ready; });
  let installed;
  w.listeners.get("install")({ waitUntil: promise => { installed = promise; } });
  await beginning;
  assert.equal(w.activated, false);
  assert.ok(requests.some(request => request.url.endsWith("/cloud-sync.js")));
  assert.ok(requests.some(request => request.url.endsWith("/routines.js")));
  assert.ok(requests.some(request => request.url.endsWith("/routine-ui.js")));
  assert.ok(requests.every(request => request.cache === "reload"));
  complete();
  await installed;
  assert.equal(w.activated, true);
});
test("a failed shell download leaves the previous app version active", async () => {
  const w = worker(async () => { throw Error("offline"); });
  let installed;
  w.listeners.get("install")({ waitUntil: promise => { installed = promise; } });
  await assert.rejects(installed, /offline/);
  assert.equal(w.activated, false);
});
async function dispatch(w, name, event) {
  let finished;
  w.listeners.get(name)({ ...event, waitUntil: promise => { finished = promise; } });
  await finished;
}
test("routine notifications retain only a safe kind for navigation", async () => {
  let shown;
  const w = worker(undefined, { showNotification: async (title, options) => { shown = { title, options }; } });
  await dispatch(w, "push", { data: { json: () => ({ title: "Routine reminder", taskId: "routine-1", kind: "routine" }) } });
  assert.equal(shown.title, "Routine reminder");
  assert.equal(shown.options.data.taskId, "routine-1");
  assert.equal(shown.options.data.kind, "routine");
  await dispatch(w, "push", { data: { json: () => ({ taskId: "task-1", kind: "https://elsewhere.test/" }) } });
  assert.equal(shown.options.data.kind, "task");
});
test("notification clicks open the routine page or the ordinary task page for legacy payloads", async () => {
  const opened = [];
  let closed = 0;
  const w = worker(undefined, { clients: {
    matchAll: async () => [], openWindow: async url => { opened.push(new URL(url)); },
  } });
  await dispatch(w, "notificationclick", { notification: { data: { taskId: "routine-1", kind: "routine" }, close: () => { closed++; } } });
  await dispatch(w, "notificationclick", { notification: { data: { taskId: "task-1" }, close: () => { closed++; } } });
  assert.equal(opened[0].hash, "#routines");
  assert.equal(opened[0].searchParams.get("task"), "routine-1");
  assert.equal(opened[1].hash, "#tasks");
  assert.equal(opened[1].searchParams.get("task"), "task-1");
  assert.equal(closed, 2);
});
test("an existing app window receives the routine kind without opening another window", async () => {
  let focused = 0, message;
  const w = worker(undefined, { clients: {
    matchAll: async () => [{ url: "https://unrelated.test/" }, {
      url: "https://example.test/Mydo/#tasks", focus: async () => { focused++; }, postMessage: value => { message = value; },
    }],
    openWindow: async () => { throw Error("unexpected new window"); },
  } });
  await dispatch(w, "notificationclick", { notification: { data: { taskId: "routine-1", kind: "routine" }, close: () => {} } });
  assert.equal(focused, 1);
  assert.equal(message.type, "mydo-open-task");
  assert.equal(message.taskId, "routine-1");
  assert.equal(message.kind, "routine");
});
