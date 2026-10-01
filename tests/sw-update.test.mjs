import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../sw.js", import.meta.url), "utf8");
function worker(addAll) {
  const listeners = new Map();
  let activated = false;
  vm.runInNewContext(source, {
    URL, Request,
    caches: { open: async () => ({ addAll }) },
    self: {
      registration: { scope: "https://example.test/Mydo/" },
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
