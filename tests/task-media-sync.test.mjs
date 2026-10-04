import test from "node:test";
import assert from "node:assert/strict";
import { CloudTasks, mergeTasks } from "../cloud-sync.js";
import { saveTask, validate } from "../model.js";

// A real one-pixel JPEG, created specifically for these fixtures. A JPEG COM
// segment lets separate uploads have distinct values without private photos.
const JPEG = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwC/RRRXGcB//9k=";
function image(label) {
  const pixels = Buffer.from(JPEG, "base64");
  const comment = Buffer.from(label);
  const length = comment.length + 2;
  const marker = Buffer.from([0xff, 0xfe, length >> 8, length & 0xff]);
  return "data:image/jpeg;base64," + Buffer.concat([
    pixels.subarray(0, 2), marker, comment, pixels.subarray(2),
  ]).toString("base64");
}
const PHOTO_A = image("upload-a"), PHOTO_B = image("upload-b"), PHOTO_C = image("upload-c");
const task = (id = "task", fields = {}) => ({
  id, title: "Fixture task", project: "", notes: "", intent: "must", urgent: false,
  done: false, due: "", deps: [], created: "2026-10-04T00:00:00Z", ...fields,
});
const clone = value => JSON.parse(JSON.stringify(value));
const ordered = value => Array.isArray(value) ? value.map(ordered)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]))
    : value;

function setup(local, initialRemote = []) {
  const storage = new Map();
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value) };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
  let tasks = clone(local), remote = clone(initialRemote), revision = 0, writes = 0;
  const auth = {
    session: { user: { id: "fixture-owner" } }, enabled: false,
    async rpc(name, body) {
      if (name === "mydo_cloud_read") return { revision, tasks: ordered(clone(remote)) };
      assert.equal(name, "mydo_cloud_write");
      if (body.p_revision !== revision) return { ok: false, revision };
      validate(body.p_tasks);
      remote = ordered(clone(body.p_tasks));
      writes++;
      return { ok: true, revision: ++revision, tasks: clone(remote) };
    },
  };
  const cloud = new CloudTasks({ auth, getTasks: () => tasks, setTasks: value => { tasks = value; } });
  return { cloud, auth, storage,
    get tasks() { return tasks; }, set tasks(value) { tasks = value; },
    get remote() { return remote; }, set remote(value) { remote = clone(value); revision++; },
    get writes() { return writes; },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test("icon, photo and notes merge as independent task fields", () => {
  const base = [task("a", { icon: "work", image: PHOTO_A })];
  const local = [{ ...base[0], icon: "money" }];
  const remote = [{ ...base[0], image: PHOTO_B, notes: "Edited on another device" }];
  const expected = [{ ...base[0], icon: "money", image: PHOTO_B, notes: remote[0].notes }];
  assert.deepEqual(mergeTasks(base, local, remote), expected);
  assert.deepEqual(mergeTasks(base, remote, local), expected);
});

test("adding media to a legacy task combines with an independent progress edit", () => {
  const base = [task("a", { status: "preparing" })];
  const local = [{ ...base[0], icon: "ai", image: PHOTO_A }];
  const remote = [{ ...base[0], status: "ongoing" }];
  const result = mergeTasks(base, local, remote)[0];
  assert.equal(result.icon, "ai");
  assert.equal(result.image, PHOTO_A);
  assert.equal(result.status, "ongoing");
  assert.equal(result.done, false);
});

test("explicit media removal preserves independent notes and the other media field", () => {
  const base = [task("a", { icon: "work", image: PHOTO_A })];
  const remote = [{ ...base[0], notes: "Keep this note" }];
  assert.deepEqual(mergeTasks(base, [{ ...base[0], icon: "" }], remote), [
    { ...base[0], icon: "", notes: "Keep this note" },
  ]);
  assert.deepEqual(mergeTasks(base, [{ ...base[0], image: "" }], remote), [
    { ...base[0], image: "", notes: "Keep this note" },
  ]);
  assert.deepEqual(mergeTasks(base, [{ ...base[0], icon: "", image: "" }], remote), [
    { ...base[0], icon: "", image: "", notes: "Keep this note" },
  ]);
});

test("conflicting photo uploads pause and resolution retains independent edits", () => {
  const base = [task("a", { icon: "work", image: PHOTO_A })];
  const local = [{ ...base[0], image: PHOTO_B, icon: "productivity" }];
  const remote = [{ ...base[0], image: PHOTO_C, notes: "Remote note" }];
  assert.throws(() => mergeTasks(base, local, remote), /^Error: conflict$/);
  for (const preference of ["local", "remote"]) {
    const result = mergeTasks(base, local, remote, preference)[0];
    assert.equal(result.image, preference === "local" ? PHOTO_B : PHOTO_C);
    assert.equal(result.icon, "productivity");
    assert.equal(result.notes, "Remote note");
  }
});

test("photo removal conflicts with a different simultaneous upload", () => {
  const base = [task("a", { image: PHOTO_A })];
  const local = [{ ...base[0], image: "" }];
  const remote = [{ ...base[0], image: PHOTO_B }];
  assert.throws(() => mergeTasks(base, local, remote), /conflict/);
  assert.equal(mergeTasks(base, local, remote, "local")[0].image, "");
  assert.equal(mergeTasks(base, local, remote, "remote")[0].image, PHOTO_B);
});

test("the existing spread-based editor retains media fields it does not display", () => {
  const base = [task("a", { icon: "study", image: PHOTO_A })];
  // This matches the production editor's ...t save pattern before media controls.
  const legacyEdit = saveTask(base, { ...base[0], title: "Updated on the older app", notes: "Older note" });
  const remote = [{ ...base[0], icon: "reading", image: PHOTO_B }];
  const result = mergeTasks(base, legacyEdit, remote)[0];
  assert.equal(result.title, "Updated on the older app");
  assert.equal(result.notes, "Older note");
  assert.equal(result.icon, "reading");
  assert.equal(result.image, PHOTO_B);
});

test("cloud acceptance and restored sync base retain JPEG data and preset values", async () => {
  const mediaTask = task("a", { icon: "health", image: PHOTO_A });
  const state = setup([mediaTask]);
  await state.cloud.enable();
  assert.equal(state.cloud.message, "synced");
  assert.deepEqual(state.remote, ordered([mediaTask]));
  assert.deepEqual(state.tasks, ordered([mediaTask]));
  assert.deepEqual(state.cloud.base, ordered([mediaTask]));
  assert.equal(JSON.parse(state.storage.get("mydo.cloud.backup.fixture-owner")).tasks[0].image, PHOTO_A);
  const saved = JSON.parse(state.storage.get("mydo.cloud.state"));
  assert.equal(saved.base[0].image, PHOTO_A);
  const restored = new CloudTasks({ auth: state.auth, getTasks: () => state.tasks,
    setTasks: value => { state.tasks = value; } });
  assert.equal(restored.base[0].icon, "health");
  assert.equal(restored.base[0].image, PHOTO_A);
  const written = state.writes;
  await restored.sync();
  assert.equal(restored.message, "synced");
  assert.equal(state.writes, written, "JSONB key ordering must not trigger another media upload");
});

test("remote media survives an older spread-based edit through a complete cloud exchange", async () => {
  const initial = task("a", { icon: "work", image: PHOTO_A });
  const state = setup([initial]);
  await state.cloud.enable();
  state.tasks = [{ ...state.tasks[0], notes: "Saved on older app" }];
  state.remote = [{ ...state.remote[0], icon: "money", image: PHOTO_B }];
  await state.cloud.sync();
  assert.equal(state.cloud.message, "synced");
  assert.equal(state.remote[0].notes, "Saved on older app");
  assert.equal(state.remote[0].icon, "money");
  assert.equal(state.remote[0].image, PHOTO_B);
  assert.deepEqual(state.tasks, state.remote);
});

test("a photo selected during an accepted write is uploaded on the next CAS pass", async () => {
  const state = setup([task("a", { icon: "gym", image: PHOTO_A })]);
  const original = state.auth.rpc;
  let edited = false;
  state.auth.rpc = async (name, body) => {
    const result = await original(name, body);
    if (name === "mydo_cloud_write" && !edited) {
      edited = true;
      state.tasks = [{ ...state.tasks[0], image: PHOTO_B }];
    }
    return result;
  };
  await state.cloud.enable();
  assert.equal(state.cloud.message, "synced");
  assert.equal(state.writes, 2);
  assert.equal(state.remote[0].image, PHOTO_B);
  assert.equal(state.tasks[0].icon, "gym");
});

test("a cloud photo conflict performs no write until the user chooses a version", async () => {
  const state = setup([task("a", { image: PHOTO_A })]);
  await state.cloud.enable();
  state.tasks = [{ ...state.tasks[0], image: PHOTO_B, icon: "ai" }];
  state.remote = [{ ...state.remote[0], image: PHOTO_C, notes: "Remote note" }];
  const written = state.writes;
  await state.cloud.sync();
  assert.equal(state.cloud.message, "conflict");
  assert.equal(state.writes, written);
  assert.equal(state.remote[0].image, PHOTO_C);
  assert.equal(state.tasks[0].image, PHOTO_B);
  await state.cloud.sync("local");
  assert.equal(state.cloud.message, "synced");
  assert.equal(state.remote[0].image, PHOTO_B);
  assert.equal(state.remote[0].icon, "ai");
  assert.equal(state.remote[0].notes, "Remote note");
});

test("explicit icon and photo removals survive cloud persistence and later stale reads", async () => {
  const original = task("a", { icon: "shopping", image: PHOTO_A });
  const state = setup([original]);
  await state.cloud.enable();
  state.tasks = [{ ...state.tasks[0], icon: "", image: "" }];
  state.remote = [{ ...state.remote[0], notes: "Another device note" }];
  await state.cloud.sync();
  assert.equal(state.cloud.message, "synced");
  assert.equal(state.remote[0].icon, "");
  assert.equal(state.remote[0].image, "");
  assert.equal(state.remote[0].notes, "Another device note");
  // A stale device's unchanged media is compared to its prior base, preserving
  // the accepted removal while still allowing its independent title to merge.
  const stale = mergeTasks([original], [{ ...original, title: "Offline title" }], state.remote)[0];
  assert.equal(stale.icon, "");
  assert.equal(stale.image, "");
  assert.equal(stale.title, "Offline title");
  assert.equal(stale.notes, "Another device note");
});

test("merged media that exceeds the cloud budget pauses safely and recovers after removing a photo", async () => {
  const largePhoto = image("fixture-padding".padEnd(59000, "x"));
  const local = Array.from({ length: 6 }, (_, index) => task(`local-${index}`, { image: largePhoto }));
  const remote = Array.from({ length: 6 }, (_, index) => task(`remote-${index}`, { image: largePhoto }));
  // Each device's list is valid; only combining their distinct tasks exceeds
  // the aggregate budget. No user content is modified to force it to fit.
  validate(local);
  validate(remote);
  const state = setup(local, remote);
  await assert.rejects(state.cloud.enable(), /^Error: mediaBudget$/);
  assert.equal(state.cloud.message, "mediaBudget");
  assert.equal(state.writes, 0);
  assert.deepEqual(state.tasks, local);
  assert.deepEqual(state.remote, remote);
  assert.deepEqual(state.cloud.base, []);

  state.tasks = state.tasks.map((item, index) => index === 0 ? { ...item, image: "" } : item);
  await state.cloud.sync();
  assert.equal(state.cloud.message, "synced");
  assert.equal(state.writes, 1);
  assert.equal(state.remote.length, 12);
  assert.equal(state.remote.find(item => item.id === "local-0").image, "");
  assert.equal(state.remote.filter(item => item.image).length, 11);
  assert.deepEqual(state.tasks, state.remote);
});

test("an account switch after a read resolves cannot upload the old account's photo to the new account", async () => {
  const state = setup([task("a", { image: PHOTO_A })]);
  await state.cloud.enable();
  const original = state.auth.rpc;
  const acceptedBase = clone(state.cloud.base);
  const savedState = state.storage.get("mydo.cloud.state");
  const written = state.writes;
  state.tasks = [{ ...state.tasks[0], image: PHOTO_B }];
  state.auth.rpc = async (name, body, owner) => {
    assert.equal(owner, "fixture-owner", "RPC must bind the operation's owner");
    const result = await original(name, body);
    if (name === "mydo_cloud_read") queueMicrotask(() => {
      state.auth.session = { user: { id: "new-owner" } };
      state.tasks = [task("new-owner-task", { image: PHOTO_C })];
    });
    return result;
  };
  await state.cloud.sync();
  assert.equal(state.cloud.message, "account");
  assert.equal(state.writes, written);
  assert.equal(state.remote[0].image, PHOTO_A);
  assert.equal(state.tasks[0].id, "new-owner-task");
  assert.deepEqual(state.cloud.base, acceptedBase);
  assert.equal(state.storage.get("mydo.cloud.state"), savedState);
});

test("an account switch after an accepted write cannot replace the new account's local state or sync base", async () => {
  const state = setup([task("a", { image: PHOTO_A })]);
  await state.cloud.enable();
  const original = state.auth.rpc;
  const acceptedBase = clone(state.cloud.base);
  const savedState = state.storage.get("mydo.cloud.state");
  state.tasks = [{ ...state.tasks[0], image: PHOTO_B }];
  state.auth.rpc = async (name, body, owner) => {
    assert.equal(owner, "fixture-owner");
    const result = await original(name, body);
    if (name === "mydo_cloud_write") queueMicrotask(() => {
      state.auth.session = { user: { id: "new-owner" } };
      state.tasks = [task("new-owner-task", { image: PHOTO_C })];
    });
    return result;
  };
  await state.cloud.sync();
  assert.equal(state.cloud.message, "account");
  // This write was sent under the original owner before the account switched.
  assert.equal(state.remote[0].image, PHOTO_B);
  assert.equal(state.tasks[0].id, "new-owner-task");
  assert.deepEqual(state.cloud.base, acceptedBase);
  assert.equal(state.storage.get("mydo.cloud.state"), savedState);
});

test("signing out while a read finishes keeps the photo local and performs no write", async () => {
  const state = setup([task("a", { image: PHOTO_A })]);
  await state.cloud.enable();
  const original = state.auth.rpc, written = state.writes;
  state.tasks = [{ ...state.tasks[0], image: PHOTO_B }];
  state.auth.rpc = async (name, body) => {
    const result = await original(name, body);
    if (name === "mydo_cloud_read") queueMicrotask(() => { state.auth.session = null; });
    return result;
  };
  await state.cloud.sync();
  assert.equal(state.cloud.message, "login");
  assert.equal(state.writes, written);
  assert.equal(state.tasks[0].image, PHOTO_B);
  assert.equal(state.remote[0].image, PHOTO_A);
});

test("pausing an in-flight media read stops its subsequent cloud write", async () => {
  const state = setup([task("a", { image: PHOTO_A })]);
  await state.cloud.enable();
  const original = state.auth.rpc, written = state.writes;
  const started = deferred(), read = deferred();
  let unlinks = 0;
  state.tasks = [{ ...state.tasks[0], image: PHOTO_B }];
  state.auth.rpc = async (name, body, owner) => {
    assert.equal(owner, "fixture-owner");
    if (name === "mydo_cloud_read") { started.resolve(); return read.promise; }
    if (name === "mydo_cloud_unlink_device") { unlinks++; return {}; }
    return original(name, body);
  };
  const syncing = state.cloud.sync();
  await started.promise;
  const pausing = state.cloud.disable();
  read.resolve({ revision: state.cloud.revision, tasks: clone(state.remote) });
  await Promise.all([syncing, pausing]);
  assert.equal(state.cloud.message, "off");
  assert.equal(state.cloud.enabled, false);
  assert.equal(state.writes, written);
  assert.equal(unlinks, 1);
  assert.equal(state.tasks[0].image, PHOTO_B);
  assert.equal(state.remote[0].image, PHOTO_A);
});

test("disable and re-enable wait for an obsolete read and start a fresh media exchange", async () => {
  const state = setup([task("a", { image: PHOTO_A })]);
  await state.cloud.enable();
  const original = state.auth.rpc, written = state.writes;
  const started = deferred(), read = deferred();
  let firstRead = true, unlinks = 0;
  state.tasks = [{ ...state.tasks[0], image: PHOTO_B }];
  state.auth.rpc = async (name, body, owner) => {
    assert.equal(owner, "fixture-owner");
    if (name === "mydo_cloud_read" && firstRead) {
      firstRead = false;
      started.resolve();
      return read.promise;
    }
    if (name === "mydo_cloud_unlink_device") { unlinks++; return {}; }
    return original(name, body);
  };
  const syncing = state.cloud.sync();
  await started.promise;
  const pausing = state.cloud.disable();
  const enabling = state.cloud.enable();
  read.resolve({ revision: state.cloud.revision, tasks: clone(state.remote) });
  await Promise.all([syncing, pausing, enabling]);
  assert.equal(state.cloud.message, "synced");
  assert.equal(state.cloud.enabled, true);
  assert.equal(state.writes, written + 1);
  assert.equal(unlinks, 0, "the old pause must not unlink a newly enabled operation");
  assert.equal(state.remote[0].image, PHOTO_B);
  assert.equal(state.cloud.base[0].image, PHOTO_B);
});

test("reassigning a cloud owner during a read cannot publish the previous owner's media", async () => {
  const state = setup([task("a", { image: PHOTO_A })]);
  await state.cloud.enable();
  const original = state.auth.rpc, written = state.writes;
  const savedState = state.storage.get("mydo.cloud.state");
  state.tasks = [{ ...state.tasks[0], image: PHOTO_B }];
  state.auth.rpc = async (name, body) => {
    const result = await original(name, body);
    if (name === "mydo_cloud_read") queueMicrotask(() => {
      state.cloud.owner = "new-owner";
      state.auth.session = { user: { id: "new-owner" } };
      state.tasks = [task("new-owner-task")];
    });
    return result;
  };
  await state.cloud.sync();
  assert.equal(state.cloud.message, "account");
  assert.equal(state.writes, written);
  assert.equal(state.tasks[0].id, "new-owner-task");
  assert.equal(state.remote[0].image, PHOTO_A);
  assert.equal(state.storage.get("mydo.cloud.state"), savedState);
});
