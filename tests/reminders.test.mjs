import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateReminder,
  reminderOccurrence,
  reminderTasks,
  zonedClock,
} from "../reminders.js";
const r = {
  onDue: true,
  daily: false,
  time: "09:00",
  timeZone: "Asia/Hong_Kong",
  start: "2026-09-27",
};
const t = {
  id: "a",
  title: "task",
  due: "2026-09-28",
  done: false,
  reminder: r,
};
test("deadline notifications use the selected timezone and time", () => {
  assert.equal(reminderOccurrence(t, new Date("2026-09-28T00:59:00Z")), null);
  assert.deepEqual(reminderOccurrence(t, new Date("2026-09-28T01:00:00Z")), {
    key: "2026-09-28",
    date: "2026-09-28",
    kind: "due",
  });
  assert.equal(reminderOccurrence(t, new Date("2026-09-29T01:00:00Z")), null);
});
test("daily continues past the deadline and stops on completion", () => {
  const task = { ...t, reminder: { ...r, daily: true } };
  assert.equal(
    reminderOccurrence(task, new Date("2026-09-26T01:00:00Z")),
    null,
  );
  assert.equal(
    reminderOccurrence(task, new Date("2026-09-27T01:00:00Z")).kind,
    "daily",
  );
  assert.equal(
    reminderOccurrence(task, new Date("2026-10-04T01:00:00Z")).kind,
    "daily",
  );
  assert.equal(
    reminderOccurrence(
      { ...task, done: true },
      new Date("2026-10-04T01:00:00Z"),
    ),
    null,
  );
});
test("deadline and daily on the same day have the same deduplication key", () => {
  const now = new Date("2026-09-28T03:00:00Z");
  assert.equal(
    reminderOccurrence({ ...t, reminder: { ...r, daily: true } }, now).key,
    reminderOccurrence(t, now).key,
  );
});
test("daily reminder does not require a deadline", () => {
  const task = { ...t, due: "", reminder: { ...r, onDue: false, daily: true } };
  assert.equal(
    reminderOccurrence(task, new Date("2026-09-28T01:00:00Z")).kind,
    "daily",
  );
});
test("invalid schedules rejected; old tasks without reminders stay valid", () => {
  validateReminder(undefined);
  validateReminder(null);
  for (const bad of [
    { ...r, time: "25:00" },
    { ...r, timeZone: "bad/zone" },
    { ...r, daily: true, start: "2026-02-30" },
  ])
    assert.throws(() => validateReminder(bad, t.due));
  assert.throws(() => validateReminder(r, ""), /reminderDue/);
  assert.throws(
    () => validateReminder({ ...r, onDue: false, daily: true, start: "" }, ""),
    /reminderStart/,
  );
});
test("time zones with daylight saving use wall clock time", () => {
  assert.equal(
    zonedClock(new Date("2026-03-08T13:00:00Z"), "America/New_York").time,
    "09:00",
  );
  assert.equal(
    zonedClock(new Date("2026-03-07T14:00:00Z"), "America/New_York").time,
    "09:00",
  );
});
test("sync payload excludes notes and completed tasks", () => {
  const result = reminderTasks([
    { ...t, notes: "Private notes", project: "private" },
    { ...t, id: "b", done: true },
  ]);
  assert.equal(result.length, 1);
  assert.equal("notes" in result[0], false);
  assert.equal("project" in result[0], false);
});
