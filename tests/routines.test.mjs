import { test } from "node:test";
import assert from "node:assert/strict";
import { isRoutine, validateRoutine, routineDate, routineScheduled, routineDone,
  routineNextDate, setRoutineCheck } from "../routines.js";
import { validate, parseBackup, rank, toggleTask, setTaskStatus, taskStatus } from "../model.js";
import { reminderOccurrence, reminderTasks } from "../reminders.js";

const task = (id, other = {}) => ({ id, title: id, project: "Health", notes: "private notes",
  intent: "must", urgent: false, done: false, due: "", deps: [], created: "2026-10-03T00:00:00Z", ...other });
const routine = (frequency = "daily", other = {}, envelope = {}) => task("routine", {
  kind: "routine", status: "preparing", routine: {
    frequency, weekdays: frequency === "weekly" ? [1, 3, 5] : [],
    start: "2026-10-03", timeZone: "Asia/Hong_Kong", paused: false, checks: {}, ...other,
  }, reminder: { onDue: false, daily: frequency === "daily", repeat: frequency,
    start: other.start ?? "2026-10-03", timeZone: other.timeZone ?? "Asia/Hong_Kong", time: "09:00" }, ...envelope,
});

test("routine backup round-trip is validated and legacy to-dos remain unchanged", () => {
  const list = [task("legacy"), task("explicit", { kind: "task" }), routine()];
  assert.equal(validate(list), list);
  assert.deepEqual(parseBackup(JSON.stringify({ version: 1, tasks: list })), list);
  assert.equal(isRoutine(list[0]), false);
  assert.equal(isRoutine(list[2]), true);
  for (const bad of [
    task("bad", { kind: "unsupported" }), task("bad", { kind: null }),
    task("bad", { routine: {} }), task("bad", { routine: null }),
    routine("yearly"), routine("daily", { weekdays: [1] }),
    routine("weekly", { weekdays: [] }), routine("weekly", { weekdays: [1, 1] }),
    routine("weekly", { weekdays: [7] }), routine("weekly", { weekdays: [1.5] }),
    routine("weekly", { weekdays: ["1"] }), routine("daily", { start: "2026-02-30" }),
    routine("daily", { timeZone: "bad/zone" }), routine("daily", { paused: null }),
    routine("daily", { checks: [] }), routine("daily", { checks: null }),
    routine("daily", { checks: { "2026-02-30": true } }), routine("daily", { checks: { "2026-10-03": 1 } }),
    routine("daily", {}, { done: true }), routine("daily", {}, { status: "ongoing" }),
    routine("daily", {}, { due: "2026-10-04" }), routine("daily", {}, { deps: ["legacy"] }),
  ]) assert.throws(() => parseBackup(JSON.stringify({ version: 1, tasks: [task("legacy"), bad] })), /routine/);
});

test("routine checks reject unbounded history and preserve explicit undo tombstones", () => {
  const checks = {};
  const date = new Date("2020-01-01T00:00:00Z");
  for (let i = 0; i < 3660; i++) {
    checks[date.toISOString().slice(0, 10)] = false;
    date.setUTCDate(date.getUTCDate() + 1);
  }
  validateRoutine(routine("daily", { checks }));
  checks[date.toISOString().slice(0, 10)] = true;
  assert.throws(() => validateRoutine(routine("daily", { checks })), /routine/);
  let list = [task("ordinary"), routine()];
  const original = list;
  list = setRoutineCheck(list, "routine", "2026-10-03", true);
  assert.equal(list[0], original[0]);
  assert.equal(routineDone(original[1], "2026-10-03"), false);
  assert.equal(routineDone(list[1], "2026-10-03"), true);
  list = setRoutineCheck(list, "routine", "2026-10-03", false);
  assert.equal(list[1].routine.checks["2026-10-03"], false);
  assert.equal(routineDone(list[1], "2026-10-03"), false);
  assert.throws(() => setRoutineCheck(list, "routine", "2026-10-02", true), /routine/);
  assert.throws(() => setRoutineCheck(list, "ordinary", "2026-10-03", true), /routine/);
  assert.throws(() => setRoutineCheck(list, "missing", "2026-10-03", true), /missing/);
  assert.throws(() => setRoutineCheck(list, "routine", "2026-10-03", "yes"), /routine/);
});

test("daily completion only checks today's occurrence and the next day remains open", () => {
  const list = setRoutineCheck([routine()], "routine", "2026-10-03", true);
  assert.equal(routineDone(list[0], "2026-10-03"), true);
  assert.equal(routineDone(list[0], "2026-10-04"), false);
  assert.equal(list[0].done, false);
  assert.equal(list[0].id, "routine");
  assert.equal(reminderOccurrence(list[0], new Date("2026-10-03T01:00Z")), null);
  assert.equal(reminderOccurrence(list[0], new Date("2026-10-04T01:00Z")).kind, "daily");
  assert.equal(routineNextDate(list[0], "2026-10-04"), "2026-10-04");
});

test("weekly routines support selected weekdays across month and year boundaries", () => {
  const t = routine("weekly", { start: "2026-12-28", weekdays: [1, 3, 5] });
  for (const [date, scheduled] of [["2026-12-25", false], ["2026-12-28", true],
    ["2026-12-29", false], ["2026-12-30", true], ["2027-01-01", true], ["2027-01-04", true]])
    assert.equal(routineScheduled(t, date), scheduled, date);
  assert.equal(routineNextDate(t, "2026-12-01"), "2026-12-28");
  assert.equal(routineNextDate(t, "2026-12-31"), "2027-01-01");
  assert.throws(() => setRoutineCheck([t], t.id, "2026-12-29", true), /routine/);
  const sunday = routine("weekly", { weekdays: [0] });
  assert.equal(routineNextDate(sunday, "2026-10-03"), "2026-10-04");
});

test("monthly routines retain their original anchor after short and leap months", () => {
  const t = routine("monthly", { start: "2026-01-31" });
  for (const [date, scheduled] of [["2026-02-28", true], ["2026-03-28", false],
    ["2026-03-31", true], ["2026-04-30", true], ["2028-02-28", false], ["2028-02-29", true]])
    assert.equal(routineScheduled(t, date), scheduled, date);
  assert.equal(routineNextDate(t, "2026-02-01"), "2026-02-28");
  assert.equal(routineNextDate(t, "2026-03-01"), "2026-03-31");
  assert.equal(routineScheduled(t, "2026-02-30"), false);
  assert.equal(routineNextDate(t, "bad"), null);
});

test("routine day and reminders use the schedule's timezone including DST", () => {
  const hk = routine();
  assert.equal(routineDate(hk, new Date("2026-10-02T16:01Z")), "2026-10-03");
  assert.equal(reminderOccurrence(hk, new Date("2026-10-03T00:59Z")), null);
  const ny = routine("daily", { start: "2026-03-01", timeZone: "America/New_York" });
  assert.equal(routineDate(ny, new Date("2026-03-08T04:59Z")), "2026-03-07");
  assert.equal(reminderOccurrence(ny, new Date("2026-03-08T12:59Z")), null);
  assert.equal(reminderOccurrence(ny, new Date("2026-03-08T13:00Z")).date, "2026-03-08");
  assert.equal(reminderOccurrence(ny, new Date("2026-03-07T14:00Z")).date, "2026-03-07");
});

test("paused and disabled routines stop reminders without losing schedule or history", () => {
  const t = routine("weekly", { weekdays: [6], checks: { "2026-09-26": true }, paused: true });
  assert.equal(routineScheduled(t, "2026-10-03"), true);
  assert.equal(routineNextDate(t, "2026-10-03"), "2026-10-03");
  assert.equal(routineDone(t, "2026-09-26"), true);
  assert.equal(reminderOccurrence(t, new Date("2026-10-03T01:00Z")), null);
  assert.equal(reminderTasks([t])[0].routine.paused, true);
  const disabled = routine();
  disabled.reminder = { ...disabled.reminder, repeat: "none", daily: false };
  validate([disabled]);
  assert.equal(reminderOccurrence(disabled, new Date("2026-10-03T01:00Z")), null);
  assert.deepEqual(reminderTasks([disabled]), []);
});

test("routine reminder payload includes checks and strips unrelated private fields", () => {
  const t = routine("weekly", { weekdays: [6], checks: { "2026-10-03": true, "2026-10-10": false } });
  const [payload] = reminderTasks([t]);
  assert.equal(payload.kind, "routine");
  assert.deepEqual(payload.routine, t.routine);
  assert.notEqual(payload.routine.checks, t.routine.checks);
  assert.notEqual(payload.routine.weekdays, t.routine.weekdays);
  for (const key of ["notes", "project", "created", "deps", "status"]) assert.equal(key in payload, false);
  assert.equal(reminderOccurrence(t, new Date("2026-10-10T01:00Z")).kind, "weekly");
  assert.equal(reminderOccurrence(t, new Date("2026-10-11T01:00Z")), null);
});

test("routine reminder schedule cannot conflict with its occurrence schedule", () => {
  for (const patch of [{ onDue: true }, { repeat: "monthly", daily: false },
    { start: "2026-10-04" }, { timeZone: "UTC" }, { repeat: "daily", daily: false },
    { repeat: undefined }, { time: "25:00" }]) {
    const t = routine(); t.reminder = { ...t.reminder, ...patch };
    assert.throws(() => validate([t]));
  }
});

test("routines cannot enter ordinary task ranking, prerequisites, or completion flow", () => {
  const t = routine();
  const ordinary = task("ordinary");
  assert.deepEqual(rank([t, ordinary], "2026-10-03"), [ordinary]);
  assert.equal(taskStatus(t), "preparing");
  assert.throws(() => toggleTask([t], t.id), /routine/);
  for (const status of ["preparing", "ongoing", "almost", "complete"])
    assert.throws(() => setTaskStatus([t], t.id, status), /routine/);
  assert.throws(() => validate([t, task("linked", { deps: [t.id] })]), /routineDependency/);
  const completed = toggleTask([ordinary], ordinary.id);
  assert.equal(completed[0].done, true);
});
