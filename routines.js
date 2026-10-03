// Routines remain open. Completion belongs to a scheduled local date, rather
// than the task itself, so the next occurrence uses the same task and history.
export const isRoutine = (task) => task?.kind === "routine";

const validDate = (value) => typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
const validZone = (value) => {
  if (typeof value !== "string" || !value || value.length > 80) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch { return false; }
};

export function validateRoutine(task) {
  if (!task || (task.kind !== undefined && !["task", "routine"].includes(task.kind)))
    throw Error("routine");
  if (!isRoutine(task)) {
    if (task.routine !== undefined) throw Error("routine");
    return;
  }
  const r = task.routine;
  if (!r || typeof r !== "object" || Array.isArray(r) ||
      !["daily", "weekly", "monthly"].includes(r.frequency) ||
      !Array.isArray(r.weekdays) || new Set(r.weekdays).size !== r.weekdays.length ||
      r.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6) ||
      (r.frequency === "weekly" ? !r.weekdays.length : r.weekdays.length !== 0) ||
      !validDate(r.start) || !validZone(r.timeZone) || typeof r.paused !== "boolean" ||
      !r.checks || typeof r.checks !== "object" || Array.isArray(r.checks) ||
      Object.keys(r.checks).length > 3660 ||
      Object.entries(r.checks).some(([date, checked]) => !validDate(date) || typeof checked !== "boolean") ||
      task.done !== false || task.status !== "preparing" || task.due !== "" ||
      !Array.isArray(task.deps) || task.deps.length !== 0)
    throw Error("routine");
  // The schedule defines what is due today; the reminder only defines its time.
  const reminder = task.reminder;
  if (reminder != null && (typeof reminder !== "object" || Array.isArray(reminder) ||
      reminder.onDue !== false || !["none", r.frequency].includes(reminder.repeat) ||
      reminder.daily !== (reminder.repeat === "daily") ||
      reminder.start !== r.start || reminder.timeZone !== r.timeZone))
    throw Error("routine");
}

export function routineDate(task, now = new Date()) {
  if (!isRoutine(task)) throw Error("routine");
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: task.routine.timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}`;
}

// Pausing stops notifications; it does not erase the schedule or past checks.
export function routineScheduled(task, date) {
  if (!isRoutine(task) || !validDate(date) || date < task.routine.start) return false;
  const r = task.routine;
  if (r.frequency === "daily") return true;
  if (r.frequency === "weekly") return r.weekdays.includes(new Date(date + "T00:00:00Z").getUTCDay());
  if (r.frequency === "monthly") {
    const monthEnd = new Date(date.slice(0, 7) + "-01T00:00:00Z");
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
    return Number(date.slice(8)) === Math.min(Number(r.start.slice(8)), monthEnd.getUTCDate());
  }
  return false;
}

export function routineDone(task, date) {
  return isRoutine(task) && task.routine.checks[date] === true;
}

// Inclusive: the next scheduled date on or after fromDate, independent of checks.
export function routineNextDate(task, fromDate) {
  if (!isRoutine(task) || !validDate(fromDate)) return null;
  let date = fromDate < task.routine.start ? task.routine.start : fromDate;
  // Every supported frequency has an occurrence within 31 days.
  for (let offset = 0; offset <= 31; offset++) {
    if (routineScheduled(task, date)) return date;
    const next = new Date(date + "T00:00:00Z");
    next.setUTCDate(next.getUTCDate() + 1);
    date = next.toISOString().slice(0, 10);
    if (!validDate(date)) return null;
  }
  return null;
}

export function setRoutineCheck(tasks, id, date, checked) {
  const task = tasks.find((item) => item.id === id);
  if (!task) throw Error("missing");
  validateRoutine(task);
  if (!isRoutine(task) || !routineScheduled(task, date) || typeof checked !== "boolean")
    throw Error("routine");
  const updated = { ...task, routine: { ...task.routine,
    // Keep false as an explicit undo so sync cannot resurrect another copy's check.
    checks: { ...task.routine.checks, [date]: checked } } };
  validateRoutine(updated);
  return tasks.map((item) => item.id === id ? updated : item);
}
