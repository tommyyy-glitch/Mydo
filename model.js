import { validateReminder } from "./reminders.js";
import { isRoutine, validateRoutine } from "./routines.js";
import { validateTaskMedia, validateTaskMediaList } from "./task-media.js";
export const TASK_STATUSES = ["preparing", "ongoing", "almost", "complete"];
// done remains the compatibility flag for backups and devices on the old app.
export const taskStatus = (task) => isRoutine(task) ? "preparing" : task.done ? "complete"
  : task.status && task.status !== "complete" ? task.status : "preparing";
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export function dayDiff(date, now = today()) {
  return Math.round(
    (Date.parse(date + "T00:00:00Z") - Date.parse(now + "T00:00:00Z")) /
      86400000,
  );
}
export function blockers(task, tasks) {
  return task.deps
    .map((id) => tasks.find((t) => t.id === id))
    .filter((t) => t && !t.done);
}
export function descendants(id, tasks) {
  const seen = new Set();
  function walk(x) {
    for (const t of tasks.filter((t) => t.deps.includes(x))) {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        walk(t.id);
      }
    }
  }
  walk(id);
  return tasks.filter((t) => seen.has(t.id));
}
export function effectiveDue(task, tasks) {
  return (
    [task, ...descendants(task.id, tasks)]
      .filter((t) => !t.done && t.due)
      .map((t) => t.due)
      .sort()[0] || ""
  );
}
export function urgency(task, tasks, now = today()) {
  const due = effectiveDue(task, tasks);
  return task.urgent || !!(due && dayDiff(due, now) <= 3);
}
export function rank(tasks, now = today()) {
  return tasks
    .filter((t) => !t.done && !isRoutine(t))
    .sort((a, b) => {
      const score = (t) => {
        const due = effectiveDue(t, tasks);
        const days = due ? dayDiff(due, now) : Infinity;
        return (
          (days < 0 ? 10000 : days <= 3 ? 5000 : 0) +
          (urgency(t, tasks, now) ? 1000 : 0) +
          (t.intent === "must" ? 500 : 0) +
          (descendants(t.id, tasks).some((x) => !x.done && x.intent === "must")
            ? 400
            : 0) +
          (due ? Math.max(0, 300 - days) : 0)
        );
      };
      return score(b) - score(a) || a.created.localeCompare(b.created);
    });
}
export function validate(tasks) {
  if (!Array.isArray(tasks) || tasks.length > 2000) throw Error("format");
  const ids = new Set();
  for (const t of tasks) {
    if (
      !t ||
      typeof t.id !== "string" ||
      !t.id ||
      t.id.length > 100 ||
      ids.has(t.id) ||
      typeof t.title !== "string" ||
      !t.title.trim() ||
      t.title.length > 200 ||
      !["must", "want"].includes(t.intent) ||
      typeof t.urgent !== "boolean" ||
      typeof t.done !== "boolean" ||
      (t.status !== undefined && !TASK_STATUSES.includes(t.status)) ||
      typeof t.project !== "string" ||
      t.project.length > 80 ||
      typeof t.notes !== "string" ||
      t.notes.length > 5000 ||
      typeof t.created !== "string" ||
      !Number.isFinite(Date.parse(t.created)) ||
      !Array.isArray(t.deps) ||
      new Set(t.deps).size !== t.deps.length ||
      typeof t.due !== "string"
    )
      throw Error("format");
    if (
      t.due &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(t.due) ||
        !Number.isFinite(Date.parse(t.due)) ||
        new Date(t.due).toISOString().slice(0, 10) !== t.due)
    )
      throw Error("date");
    validateRoutine(t);
    validateTaskMedia(t);
    validateReminder(t.reminder, t.due);
    ids.add(t.id);
  }
  for (const t of tasks)
    if (t.deps.some((id) => typeof id !== "string" || !ids.has(id)))
      throw Error("missing");
  const visiting = new Set(),
    visited = new Set();
  const map = new Map(tasks.map((t) => [t.id, t]));
  for (const t of tasks)
    if (t.deps.some((id) => isRoutine(map.get(id)))) throw Error("routineDependency");
  function visit(id) {
    if (visiting.has(id)) throw Error("cycle");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of map.get(id).deps) visit(dep);
    visiting.delete(id);
    visited.add(id);
  }
  for (const t of tasks) visit(t.id);
  for (const t of tasks)
    if (t.done && blockers(t, tasks).length) throw Error("completedBlocked");
  validateTaskMediaList(tasks);
  return tasks;
}
export function saveTask(tasks, task) {
  return validate(
    tasks.some((t) => t.id === task.id)
      ? tasks.map((t) => (t.id === task.id ? task : t))
      : [...tasks, task],
  );
}
export function toggleTask(tasks, id) {
  const task = tasks.find((t) => t.id === id);
  if (!task) throw Error("missing");
  if (isRoutine(task)) throw Error("routine");
  return setTaskStatus(tasks, id, task.done ? "preparing" : "complete");
}
export function setTaskStatus(tasks, id, status) {
  if (!TASK_STATUSES.includes(status)) throw Error("status");
  const task = tasks.find((t) => t.id === id);
  if (!task) throw Error("missing");
  if (isRoutine(task)) throw Error("routine");
  if (status === "complete" && blockers(task, tasks).length) throw Error("blocked");
  if (task.done && status !== "complete" && descendants(id, tasks).some((t) => t.done))
    throw Error("reopen");
  return validate(
    tasks.map((t) => (t.id === id ? { ...t, status, done: status === "complete" } : t)),
  );
}
export function deleteTask(tasks, id) {
  if (tasks.some((t) => t.deps.includes(id))) throw Error("linked");
  return tasks.filter((t) => t.id !== id);
}
export function parseBackup(raw) {
  const data = JSON.parse(raw);
  if (data.version !== 1) throw Error("version");
  return validate(data.tasks);
}
export function demoTasks() {
  const date = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const specs = [
    [
      "brief",
      "Clarify the brief · 釐清需求",
      "Mydo",
      "must",
      false,
      "",
      [],
      true,
    ],
    [
      "flow",
      "Map the task logic · 整理任務邏輯",
      "Mydo",
      "must",
      false,
      "",
      ["brief"],
      false,
    ],
    [
      "build",
      "Build a first version · 製作第一版",
      "Mydo",
      "must",
      false,
      date(2),
      ["flow"],
      false,
    ],
    [
      "review",
      "Review & ship · 檢查及發佈",
      "Mydo",
      "must",
      false,
      date(4),
      ["build"],
      false,
    ],
    [
      "admin",
      "Finish a time-sensitive errand · 處理限時事項",
      "Life",
      "must",
      true,
      date(1),
      [],
      false,
    ],
    [
      "read",
      "Read something inspiring · 看一本想看的書",
      "Personal",
      "want",
      false,
      "",
      [],
      false,
    ],
    [
      "walk",
      "Take a slow walk · 散步放空",
      "Life",
      "want",
      false,
      "",
      [],
      false,
    ],
    [
      "book",
      "Book a weekend workshop · 預約週末工作坊",
      "Personal",
      "want",
      true,
      date(3),
      [],
      false,
    ],
  ];
  return specs.map(
    ([id, title, project, intent, urgent, due, deps, done], i) => ({
      id,
      title,
      project,
      intent,
      urgent,
      due,
      deps,
      done,
      notes: "",
      created: new Date(Date.now() + i).toISOString(),
    }),
  );
}
