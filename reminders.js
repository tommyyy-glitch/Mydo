// Shared by the browser and the scheduler. A reminder's zone is explicit so
// travelling or a server running in UTC cannot silently move the chosen time.
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
  if (reminder.daily && !validDate(reminder.start))
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
  if (task.done || !r || (!r.daily && !r.onDue)) return null;
  validateReminder(r, task.due);
  const clock = zonedClock(now, r.timeZone);
  if (clock.time < r.time) return null;
  const onDue = r.onDue && clock.date === task.due;
  const daily = r.daily && clock.date >= r.start;
  if (!onDue && !daily) return null;
  // On a day where both conditions match, there is only one notification.
  return { key: clock.date, date: clock.date, kind: onDue ? "due" : "daily" };
}

export function reminderTasks(tasks) {
  return tasks
    .filter((t) => !t.done && (t.reminder?.onDue || t.reminder?.daily))
    .map((t) => ({
      id: t.id,
      title: t.title,
      due: t.due,
      done: false,
      reminder: { ...t.reminder },
    }));
}
