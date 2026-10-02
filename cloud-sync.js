import { validate, taskStatus } from "./model.js";

const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const copy = (value) => JSON.parse(JSON.stringify(value));

// Three-way merge: a missing task is a deletion only if it existed in base.
// Concurrent edits to different fields combine. Conflicting edits never silently win.
export function mergeTasks(base, local, remote, preference = "") {
  [base, local, remote].forEach(validate);
  const maps = [base, local, remote].map((list) => new Map(list.map((t) => [t.id, t])));
  const result = [];
  const choose = (before, here, there) => {
    if (same(here, there) || same(there, before)) return here;
    if (same(here, before)) return there;
    if (preference === "local") return here;
    if (preference === "remote") return there;
    throw Error("conflict");
  };
  for (const id of new Set([...maps[1].keys(), ...maps[2].keys(), ...maps[0].keys()])) {
    const [before, here, there] = maps.map((m) => m.get(id));
    let merged;
    if (!before || !here || !there) merged = choose(before, here, there);
    else {
      merged = {};
      for (const field of new Set([...Object.keys(before), ...Object.keys(here), ...Object.keys(there)])) {
        if (field === "status" || field === "done") continue;
        const value = choose(before[field], here[field], there[field]);
        if (value !== undefined) merged[field] = value;
      }
      // Progress is one value: concurrent completion/progress edits must conflict,
      // never combine into a status that one of the devices did not choose.
      const status = choose(taskStatus(before), taskStatus(here), taskStatus(there));
      merged.done = status === "complete";
      if ([before, here, there].some(t => t.status !== undefined)) merged.status = status;
    }
    if (merged) result.push(copy(merged));
  }
  return validate(result.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export class CloudTasks {
  constructor({ auth, getTasks, setTasks, onChange }) {
    Object.assign(this, { auth, getTasks, setTasks, onChange });
    this.enabled = false;
    this.message = "off";
    this.base = [];
    this.revision = 0;
    try {
      const saved = JSON.parse(localStorage.getItem("mydo.cloud.state") || "null");
      if (saved) {
        validate(saved.base);
        this.owner = saved.owner;
        this.enabled = !!saved.enabled;
        this.base = saved.base;
        this.revision = saved.revision;
        this.syncedAt = saved.syncedAt;
        this.message = this.enabled ? "pending" : "off";
      }
    } catch { this.message = "storage"; }
  }
  changed(message) {
    this.message = message;
    this.onChange?.();
  }
  persist() {
    localStorage.setItem("mydo.cloud.state", JSON.stringify({
      owner: this.owner, enabled: this.enabled, base: this.base,
      revision: this.revision, syncedAt: this.syncedAt,
    }));
  }
  async enable() {
    const owner = this.auth.session?.user?.id;
    if (!owner) throw Error("login");
    if (this.owner && this.owner !== owner) throw Error("account");
    validate(this.getTasks());
    // Keep the original local list before the first cloud write or merge.
    const key = "mydo.cloud.backup." + owner;
    if (!localStorage.getItem(key))
      localStorage.setItem(key, JSON.stringify({ version: 1, tasks: this.getTasks() }));
    this.owner = owner;
    this.enabled = true;
    this.persist();
    await this.sync();
    if (this.message !== "synced") throw Error(this.message);
  }
  async disable() {
    this.enabled = false;
    // Keep the user's choice even if unlinking the server device fails offline.
    this.persist();
    this.changed("off");
    if (this.running) await this.running;
    if (this.auth.session && this.owner === this.auth.session.user?.id)
      await this.auth.rpc("mydo_cloud_unlink_device", { p_device: this.auth.deviceId });
  }
  sync(preference = "") {
    if (!this.enabled) return Promise.resolve();
    if (this.running) return this.running;
    this.changed("pending");
    this.running = this.exchange(preference)
      .catch((e) => this.changed(["conflict", "account", "login", "storage"].includes(e.message) ? e.message : "pending"))
      .finally(() => { this.running = null; });
    return this.running;
  }
  async exchange(preference) {
    if (this.owner !== this.auth.session?.user?.id) throw Error("account");
    if (!navigator.onLine) throw Error("offline");
    // Bounded CAS retries; another device can never overwrite unseen changes.
    for (let attempt = 0; attempt < 5 && this.enabled; attempt++) {
      const remote = await this.auth.rpc("mydo_cloud_read", {});
      validate(remote.tasks);
      const snapshot = copy(this.getTasks());
      const merged = mergeTasks(this.base, snapshot, remote.tasks, preference);
      let accepted = remote;
      if (!same(merged, remote.tasks)) {
        accepted = await this.auth.rpc("mydo_cloud_write", {
          p_revision: remote.revision, p_tasks: merged,
        });
        if (!accepted.ok) continue;
      }
      if (!this.enabled) return;
      // A local edit may happen while a network request is in flight.
      const current = this.getTasks();
      const updated = mergeTasks(snapshot, current, accepted.tasks);
      this.setTasks(updated);
      this.base = copy(accepted.tasks);
      this.revision = accepted.revision;
      this.syncedAt = new Date().toISOString();
      this.persist();
      if (!same(updated, accepted.tasks)) continue;
      if (this.auth.enabled)
        await this.auth.rpc("mydo_cloud_link_device", { p_device: this.auth.deviceId });
      this.changed("synced");
      return;
    }
    if (this.enabled) throw Error("busy");
  }
}
