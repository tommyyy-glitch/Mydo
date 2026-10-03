// Shared by the browser and the scheduler. A reminder's zone is explicit so
// travelling or a server running in UTC cannot silently move the chosen time.
import { isRoutine, validateRoutine, routineScheduled, routineDone } from "./routines.js";
export const repeatFrequency = (r) => r?.repeat ?? (r?.daily ? "daily" : "none");

// Calendar arithmetic keeps the original monthly anchor, even after February.
export function repeatOnDate(frequency, start, date) {
  if (!start || date < start || frequency === "none") return false;
  if (frequency === "daily") return true;
  if (frequency === "weekly")
    return (Date.parse(date) - Date.parse(start)) / 86400000 % 7 === 0;
  if (frequency === "monthly") {
    const day = Number(date.slice(8));
    const end = new Date(date.slice(0, 7) + "-01T00:00:00Z");
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
    const last = end.getUTCDate();
    return day === Math.min(Number(start.slice(8)), last);
  }
  return false;
}
export function validDate(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

export function validateReminder(reminder, due = "") {
  if (reminder === undefined || reminder === null) return;
  if (
    typeof reminder !== "object" ||
    Array.isArray(reminder) ||
    typeof reminder.onDue !== "boolean" ||
    typeof reminder.daily !== "boolean" ||
    !["none", "daily", "weekly", "monthly"].includes(repeatFrequency(reminder)) ||
    (reminder.repeat !== undefined && !["none", "daily", "weekly", "monthly"].includes(reminder.repeat)) ||
    (reminder.repeat !== undefined && reminder.daily !== (reminder.repeat === "daily")) ||
    typeof reminder.time !== "string" ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(reminder.time) ||
    typeof reminder.timeZone !== "string" ||
    reminder.timeZone.length > 80 ||
    typeof reminder.start !== "string" ||
    (reminder.start && !validDate(reminder.start))
  )
    throw Error("reminder");
  try {
    new Intl.DateTimeFormat("en", { timeZone: reminder.timeZone }).format();
  } catch {
    throw Error("reminder");
  }
  if (reminder.onDue && !validDate(due)) throw Error("reminderDue");
  if (repeatFrequency(reminder) !== "none" && !validDate(reminder.start))
    throw Error("reminderStart");
}

export function zonedClock(now, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

// A delayed scheduler catches up within the same local day. We deliberately do
// not send a backlog of one-off reminders for earlier days.
export function reminderOccurrence(task, now = new Date()) {
  const r = task.reminder;
  if (task.done || !r || (repeatFrequency(r) === "none" && !r.onDue)) return null;
  validateReminder(r, task.due);
  if (isRoutine(task)) {
    validateRoutine(task);
    if (task.routine.paused) return null;
  }
  const clock = zonedClock(now, r.timeZone);
  if (clock.time < r.time) return null;
  const onDue = r.onDue && clock.date === task.due;
  const frequency = repeatFrequency(r);
  const repeating = isRoutine(task)
    ? routineScheduled(task, clock.date) && !routineDone(task, clock.date)
    : repeatOnDate(frequency, r.start, clock.date);
  if (!onDue && !repeating) return null;
  // On a day where both conditions match, there is only one notification.
  return { key: clock.date, date: clock.date, kind: onDue ? "due" : frequency };
}

export function reminderTasks(tasks) {
  return tasks
    // Paused and checked-today routines stay projected so their existing
    // scheduler deduplication state survives pause/resume and undo.
    .filter((t) => !t.done && (t.reminder?.onDue || repeatFrequency(t.reminder) !== "none"))
    .map((t) => ({
      id: t.id,
      title: t.title,
      due: t.due,
      done: false,
      reminder: { ...t.reminder },
      ...(isRoutine(t) ? { kind: "routine", routine: {
        frequency: t.routine.frequency, weekdays: [...t.routine.weekdays],
        start: t.routine.start, timeZone: t.routine.timeZone,
        paused: t.routine.paused, checks: { ...t.routine.checks },
      } } : {}),
    }));
}
