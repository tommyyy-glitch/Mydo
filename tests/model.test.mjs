import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validate,
  blockers,
  descendants,
  effectiveDue,
  urgency,
  rank,
  saveTask,
  toggleTask,
  deleteTask,
  parseBackup,
  dayDiff,
  demoTasks,
} from "../model.js";
const task = (id, other = {}) => ({
  id,
  title: id,
  project: "Test",
  notes: "",
  intent: "must",
  urgent: false,
  done: false,
  due: "",
  deps: [],
  created: "2026-09-27T00:00:00Z",
  ...other,
});
test("a chain unlocks only after every prerequisite is complete", () => {
  let tasks = [task("a"), task("b"), task("c", { deps: ["a", "b"] })];
  assert.throws(() => toggleTask(tasks, "c"), /blocked/);
  tasks = toggleTask(tasks, "a");
  assert.equal(blockers(tasks[2], tasks).length, 1);
  tasks = toggleTask(tasks, "b");
  tasks = toggleTask(tasks, "c");
  assert.ok(tasks.every((t) => t.done));
  assert.throws(() => toggleTask(tasks, "a"), /reopen/);
  tasks = toggleTask(tasks, "c");
  assert.equal(toggleTask(tasks, "a")[0].done, false);
});
test("self, indirect cycles and dangling prerequisites are rejected", () => {
  assert.throws(() => validate([task("a", { deps: ["a"] })]), /cycle/);
  const tasks = [
    task("a"),
    task("b", { deps: ["a"] }),
    task("c", { deps: ["b"] }),
  ];
  assert.throws(() => saveTask(tasks, task("a", { deps: ["c"] })), /cycle/);
  assert.throws(() => validate([task("a", { deps: ["missing"] })]), /missing/);
});
test("real deadlines propagate to ancestors without overwriting their own dates", () => {
  const tasks = [
    task("a", { intent: "want" }),
    task("b", { deps: ["a"] }),
    task("c", { deps: ["b"], due: "2026-09-29" }),
    task("d", { urgent: true }),
  ];
  assert.equal(effectiveDue(tasks[0], tasks), "2026-09-29");
  assert.equal(tasks[0].due, "");
  assert.equal(urgency(tasks[0], tasks, "2026-09-27"), true);
  assert.ok(
    rank(tasks, "2026-09-27").indexOf(tasks[0]) <
      rank(tasks, "2026-09-27").indexOf(tasks[3]),
  );
  assert.deepEqual(
    descendants("a", tasks).map((t) => t.id),
    ["b", "c"],
  );
});
test("completed descendants stop imposing deadline pressure", () => {
  const tasks = [
    task("a", { done: true }),
    task("b", { done: true, deps: ["a"], due: "2026-09-01" }),
  ];
  assert.equal(effectiveDue(tasks[0], tasks), "");
});
test("urgency is independent of must/want and uses a three day inclusive boundary", () => {
  const a = task("a", { intent: "want", due: "2026-09-30" });
  assert.equal(urgency(a, [a], "2026-09-27"), true);
  assert.equal(urgency(a, [a], "2026-09-26"), false);
  const b = task("b", { urgent: true });
  assert.equal(urgency(b, [b], "2026-09-27"), true);
  assert.equal(dayDiff("2026-03-09", "2026-03-08"), 1);
});
test("deleting a prerequisite is prevented until links are removed", () => {
  const tasks = [task("a"), task("b", { deps: ["a"] })];
  assert.throws(() => deleteTask(tasks, "a"), /linked/);
  assert.equal(deleteTask(tasks, "b").length, 1);
});
test("backup round trip preserves all task data and validates before replacing", () => {
  const tasks = [
    task("中英", { title: "中英 & <task>", notes: "line 1\nline 2" }),
  ];
  assert.deepEqual(parseBackup(JSON.stringify({ version: 1, tasks })), tasks);
  for (const bad of [
    { version: 2, tasks },
    { version: 1, tasks: [task("a"), task("a")] },
    { version: 1, tasks: [task("x", { due: "2026-02-30" })] },
    { version: 1, tasks: [task("x", { title: " " })] },
    { version: 1, tasks: [task("a"), task("b", { done: true, deps: ["a"] })] },
  ])
    assert.throws(() => parseBackup(JSON.stringify(bad)));
});
test("sample tasks are valid and provide all four matrix categories", () => {
  const tasks = demoTasks();
  assert.equal(validate(tasks), tasks);
  assert.equal(tasks.length, 8);
  assert.equal(
    tasks.filter((t) => !t.done && !blockers(t, tasks).length).length,
    5,
  );
});
