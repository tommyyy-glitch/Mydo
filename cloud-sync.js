import { validate, taskStatus } from "./model.js";
import { validateRoutine } from "./routines.js";

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
  const mergeFields = (before, here, there, mergeField) => {
    const merged = {};
    for (const field of new Set([...Object.keys(before), ...Object.keys(here), ...Object.keys(there)])) {
      const value = mergeField?.(field, before[field], here[field], there[field])
        ?? choose(before[field], here[field], there[field]);
      if (value !== undefined) merged[field] = value;
    }
    return merged;
  };
  const mergeRoutine = (before, here, there) => mergeFields(before, here, there,
    (setting, previous, localValue, remoteValue) => setting === "checks"
      ? mergeFields(previous, localValue, remoteValue) : undefined);
  const mergeRoutineReminder = (before, here, there, routine) => {
    if (![before, here, there].some(value => value != null)) return choose(before, here, there);
    // Off/null removes delivery, not the remembered time. Schedule fields are
    // projections of the routine, so an independent time edit can coexist with
    // a schedule edit or switching reminders off on another device.
    const values = [before, here, there].map(value => value ?? {});
    const merged = {};
    for (const field of new Set(values.flatMap(Object.keys))) {
      if (["repeat", "daily", "start", "timeZone", "onDue"].includes(field)) continue;
      const value = choose(values[0][field], here == null ? values[0][field] : values[1][field],
        there == null ? values[0][field] : values[2][field]);
      if (value !== undefined) merged[field] = value;
    }
    const enabled = choose(before != null && before.repeat !== "none",
      here != null && here.repeat !== "none", there != null && there.repeat !== "none");
    return { ...merged, onDue: false, repeat: enabled ? routine.frequency : "none",
      daily: enabled && routine.frequency === "daily", start: routine.start, timeZone: routine.timeZone };
  };
  for (const id of new Set([...maps[1].keys(), ...maps[2].keys(), ...maps[0].keys()])) {
    const [before, here, there] = maps.map((m) => m.get(id));
    let merged;
    if (!before || !here || !there) merged = choose(before, here, there);
    else {
      merged = {};
      const allRoutines = [before, here, there].every(t => t.kind === "routine");
      const routine = allRoutines ? mergeRoutine(before.routine, here.routine, there.routine) : null;
      for (const field of new Set([...Object.keys(before), ...Object.keys(here), ...Object.keys(there)])) {
        if (field === "status" || field === "done") continue;
        // A check marks one occurrence, not the routine itself. Merge dates
        // independently, retaining explicit false values when a check is undone.
        // Only decompose an existing routine; conversions/additions/deletions
        // still use the ordinary conflict rules and full-envelope validation.
        const value = field === "routine" && allRoutines ? routine
          : field === "reminder" && allRoutines
            ? mergeRoutineReminder(before.reminder, here.reminder, there.reminder, routine)
          : choose(before[field], here[field], there[field]);
        if (value !== undefined) merged[field] = value;
      }
      // Progress is one value: concurrent completion/progress edits must conflict,
      // never combine into a status that one of the devices did not choose.
      const status = choose(taskStatus(before), taskStatus(here), taskStatus(there));
      merged.done = status === "complete";
      if ([before, here, there].some(t => t.status !== undefined)) merged.status = status;
      if (allRoutines && ["local", "remote"].includes(preference)) {
        try { validateRoutine(merged); }
        catch (error) {
          if (error.message !== "routine") throw error;
          // Frequency and selected weekdays are a schedule pair. Choosing a
          // device resolves that pair together while retaining independent
          // checks, pause, notes and reminder-time changes.
          const selected = preference === "local" ? here.routine : there.routine;
          merged.routine = { ...routine, frequency: selected.frequency, weekdays: selected.weekdays };
          if ([before, here, there].some(t => t.reminder !== undefined))
            merged.reminder = mergeRoutineReminder(before.reminder, here.reminder, there.reminder, merged.routine);
        }
      }
    }
    if (merged) result.push(copy(merged));
  }
  try {
    return validate(result.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  } catch (error) {
    // Every input was valid. If independent routine settings form an invalid
    // combination, ask for conflict resolution instead of retrying forever.
    if (error.message === "routine") throw Error("conflict");
    throw error;
  }
}

export class CloudTasks {
  constructor({ auth, getTasks, setTasks, onChange }) {
    Object.assign(this, { auth, getTasks, setTasks, onChange });
    this.enabled = false;
    this.message = "off";
    this.base = [];
    this.revision = 0;
    this.operationGeneration = 0;
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
    const operation = { owner, generation: ++this.operationGeneration };
    this.enabled = true;
    this.persist();
    // A paused operation must finish without publishing its older accepted
    // state before a newly enabled operation reads the cloud again.
    if (this.running) await this.running;
    this.assertOperation(operation);
    await this.sync();
    this.assertOperation(operation);
    if (this.message !== "synced") throw Error(this.message);
  }
  async disable() {
    const operation = { owner: this.owner, generation: ++this.operationGeneration };
    this.enabled = false;
    // Keep the user's choice even if unlinking the server device fails offline.
    this.persist();
    this.changed("off");
    if (this.running) await this.running;
    if (operation.generation !== this.operationGeneration || this.enabled || this.owner !== operation.owner) return;
    if (this.auth.session?.user?.id === operation.owner)
      await this.auth.rpc("mydo_cloud_unlink_device", { p_device: this.auth.deviceId }, operation.owner);
  }
  assertOperation(operation) {
    if (!this.enabled || operation.generation !== this.operationGeneration) throw Error("off");
    this.auth.readStoredAuth?.();
    if (!this.auth.session?.user?.id) throw Error("login");
    if (this.owner !== operation.owner || this.auth.session.user.id !== operation.owner) throw Error("account");
  }
  sync(preference = "") {
    if (!this.enabled) return Promise.resolve();
    if (this.running) return this.running;
    const operation = { owner: this.owner, generation: this.operationGeneration };
    this.changed("pending");
    this.running = this.exchange(preference, operation)
      .catch((e) => {
        // Disabling/re-enabling owns the new status; an obsolete network
        // operation must not replace it or update the new operation's data.
        if (operation.generation !== this.operationGeneration) return;
        this.changed(["conflict", "account", "login", "storage", "mediaBudget", "off"].includes(e.message) ? e.message : "pending");
      })
      .finally(() => { this.running = null; });
    return this.running;
  }
  async exchange(preference, operation = { owner: this.owner, generation: this.operationGeneration }) {
    this.assertOperation(operation);
    if (!navigator.onLine) throw Error("offline");
    // Bounded CAS retries; another device can never overwrite unseen changes.
    for (let attempt = 0; attempt < 5 && this.enabled; attempt++) {
      this.assertOperation(operation);
      const remote = await this.auth.rpc("mydo_cloud_read", {}, operation.owner);
      this.assertOperation(operation);
      validate(remote.tasks);
      const snapshot = copy(this.getTasks());
      const merged = mergeTasks(this.base, snapshot, remote.tasks, preference);
      let accepted = remote;
      if (!same(merged, remote.tasks)) {
        this.assertOperation(operation);
        accepted = await this.auth.rpc("mydo_cloud_write", {
          p_revision: remote.revision, p_tasks: merged,
        }, operation.owner);
        this.assertOperation(operation);
        if (!accepted.ok) continue;
      }
      this.assertOperation(operation);
      // A local edit may happen while a network request is in flight.
      const current = this.getTasks();
      const updated = mergeTasks(snapshot, current, accepted.tasks);
      this.assertOperation(operation);
      this.setTasks(updated);
      this.assertOperation(operation);
      this.base = copy(accepted.tasks);
      this.revision = accepted.revision;
      this.syncedAt = new Date().toISOString();
      this.assertOperation(operation);
      this.persist();
      if (!same(updated, accepted.tasks)) continue;
      if (this.auth.enabled) {
        this.assertOperation(operation);
        await this.auth.rpc("mydo_cloud_link_device", { p_device: this.auth.deviceId }, operation.owner);
        this.assertOperation(operation);
      }
      this.assertOperation(operation);
      this.changed("synced");
      return;
    }
    if (this.enabled) throw Error("busy");
  }
}
