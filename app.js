import { PhoneReminders } from "./push-client.js";
import { repeatFrequency } from "./reminders.js";
import { CloudTasks } from "./cloud-sync.js";
import { isRoutine } from "./routines.js";
import { createRoutineUI } from "./routine-ui.js";
import {
  today,
  dayDiff,
  blockers,
  descendants,
  effectiveDue,
  urgency,
  rank,
  validate,
  saveTask,
  toggleTask,
  setTaskStatus,
  taskStatus,
  TASK_STATUSES,
  deleteTask,
  parseBackup,
  demoTasks,
} from "./model.js";
let phone, cloud;
function syncAll() {
  return (cloud?.enabled ? cloud.sync() : Promise.resolve()).then(() => phone?.sync());
}
const KEY = "mydo.v1",
  LANG = "mydo.lang";
const MAIN_VIEWS = ['focus', 'matrix', 'paths', 'routines'];
const normalizeView = value => value === 'all' ? 'routines' : [...MAIN_VIEWS, 'tasks'].includes(value) ? value : 'focus';
let pendingOpenTask = '';
let tasks = [],
  lang = "en",
  view = normalizeView(location.hash.slice(1)),
  project = "",
  search = "",
  demo = false,
  recovery = false;
try {
  lang = localStorage.getItem(LANG) || "en";
  const raw = localStorage.getItem(KEY);
  if (raw) {
    tasks = parseBackup(raw);
  }
} catch {
  recovery = true;
}
const $ = (s) => document.querySelector(s),
  tr = (en, zh) => (lang === "zh" ? zh : en);
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const paths = {
  focus: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  matrix:
    '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  paths:
    '<rect x="2" y="9" width="6" height="6" rx="1"/><rect x="16" y="2" width="6" height="6" rx="1"/><rect x="16" y="16" width="6" height="6" rx="1"/><path d="M8 12h4V5h4M12 12v7h4"/>',
  all: '<path d="M8 5h13M8 12h13M8 19h13M3 5h.1M3 12h.1M3 19h.1"/>',
  routines: '<path d="M20 7a9 9 0 0 0-15-2L2 8m0-5v5h5M4 17a9 9 0 0 0 15 2l3-3m0 5v-5h-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/>',
  moon: '<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>',
  down: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
};
const icon = (n) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[n] || paths.all}</svg>`;
const statusLabel = (status) => ({
  preparing: tr("Preparing", "準備中"), ongoing: tr("Ongoing", "進行中"),
  almost: tr("Almost complete", "接近完成"), complete: tr("Complete", "已完成"),
})[status];
const names = () => ({
  focus: tr("Next up", "現在可做"),
  matrix: tr("Priority matrix", "優先矩陣"),
  paths: tr("Task paths", "任務路線"),
  routines: tr("Routines", "日常"),
  tasks: tr("Task history", "待辦記錄"),
});
const errors = () => ({
  cycle: tr(
    "These links create a loop. Choose a different prerequisite.",
    "這個連結會形成循環，請選擇其他前置任務。",
  ),
  blocked: tr("Finish the prerequisites first.", "請先完成前置任務。"),
  reopen: tr(
    "Reopen completed follow-up tasks first.",
    "請先重新開啟已完成的後續任務。",
  ),
  linked: tr(
    "Other tasks depend on this one. Remove those links before deleting.",
    "其他任務依賴此任務，請先移除那些連結。",
  ),
  completedBlocked: tr(
    "A completed task cannot have an unfinished prerequisite.",
    "已完成任務不可依賴未完成的前置任務。",
  ),
  missing: tr("A prerequisite no longer exists.", "前置任務已不存在。"),
  format: tr("This is not a valid Mydo backup.", "這不是有效的 Mydo 備份。"),
  date: tr("Enter a valid deadline.", "請輸入有效截止日期。"),
  reminder: tr(
    "Check the reminder time and timezone.",
    "請檢查提醒時間及時區。",
  ),
  reminderDue: tr(
    "Choose a real deadline to enable a due-date notification.",
    "請先選擇真實截止日期，再啟用截止日通知。",
  ),
  reminderStart: tr(
    "Choose when repeating reminders should start.",
    "請選擇重複提醒的開始日期。",
  ),
  version: tr("This backup version is not supported.", "不支援此備份版本。"),
  routine: tr("Check the schedule. Weekly routines need at least one weekday.", "請檢查日常排程，每週須選擇至少一個日子。"),
  routineDependency: tr("Routines cannot be prerequisites for tasks.", "日常事項不能用作待辦的前置任務。"),
});
function errorText(e) {
  return (
    errors()[e.message] ||
    tr(
      "Could not save. Export a backup and check browser storage.",
      "未能儲存。請匯出備份，並檢查瀏覽器儲存空間。",
    )
  );
}
let toastTimer;
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 5000);
}
function commit(next) {
  validate(next);
  if (recovery) throw Error("storage");
  if (!demo)
    localStorage.setItem(KEY, JSON.stringify({ version: 1, tasks: next }));
  tasks = next;
  render();
  if (!demo) syncAll();
}
function dateLabel(d) {
  const days = dayDiff(d);
  return days < 0
    ? tr(`${-days}d overdue`, `逾期 ${-days} 天`)
    : days === 0
      ? tr("Due today", "今日到期")
      : days === 1
        ? tr("Due tomorrow", "明日到期")
        : tr(
            `Due ${d.slice(5).replace("-", "/")}`,
            `期限 ${d.slice(5).replace("-", "/")}`,
          );
}
function dueBadge(t) {
  return t.due
    ? `<span class="badge ${dayDiff(t.due) <= 3 ? "amber" : ""}">${icon("clock")}${esc(dateLabel(t.due))}</span>`
    : "";
}
function filtered() {
  return tasks.filter(
    (t) =>
      isRoutine(t) === (view === 'routines') &&
      (!project || t.project === project) &&
      (!search ||
        `${t.title} ${t.notes} ${t.project}`
          .toLowerCase()
          .includes(search.toLowerCase())),
  );
}
const routineUI = createRoutineUI({ tr, esc, icon, getTasks: () => tasks, getProject: () => project, commit, errorText, toast,
  onSaved: () => { project = ''; search = ''; view = 'routines'; location.hash = 'routines'; render(); },
});
function reminderLabel(t) {
  const r = t.reminder;
  if (t.done || !r || (!r.onDue && repeatFrequency(r) === "none")) return "";
  const modes = [];
  const frequency = repeatFrequency(r);
  if (frequency !== "none") {
    const label = {daily: tr("Daily", "每日"), weekly: tr("Weekly", "每週"), monthly: tr("Monthly", "每月")}[frequency];
    modes.push(tr(`${label} from ${r.start}`, `${label}提醒由 ${r.start} 開始`));
  }
  if (r.onDue) modes.push(tr(`Due-date reminder ${t.due}`, `截止日提醒 ${t.due}`));
  return `<span class="reminder-caption">${icon("clock")}${esc(modes.join(" · "))} · ${esc(r.time)} (${esc(r.timeZone)})</span>`;
}
function card(t, compact = false) {
  const blocked = blockers(t, tasks),
    down = descendants(t.id, tasks).filter((t) => !t.done),
    due = effectiveDue(t, tasks);
  return `<article class="task ${t.done ? "done" : ""} ${blocked.length ? "blocked" : ""}"><button class="task-check ${t.done ? "checked" : ""}" data-toggle="${esc(t.id)}" aria-label="${esc(tr(t.done ? "Reopen: " : "Complete: ", t.done ? "重新開啟：" : "完成：") + t.title)}" ${blocked.length ? 'aria-disabled="true"' : ""}>${t.done ? icon("check") : blocked.length ? icon("lock") : ""}</button><button class="task-body" data-edit="${esc(t.id)}"><span class="task-title">${esc(t.title)}</span><span class="task-meta"><span class="badge progress-${taskStatus(t)}">${statusLabel(taskStatus(t))}</span><span class="project-label">${esc(t.project || tr("Unsorted", "未分類"))}</span><span class="badge ${t.intent === "must" ? "must" : ""}">${t.intent === "must" ? "Must" : "Want"}</span>${!compact ? dueBadge(t) : ""}${blocked.length ? `<span class="badge muted">${icon("lock")}${blocked.length} ${tr("prerequisite", "個前置")}</span>` : down.length ? `<span class="badge mint">${icon("paths")}${tr(`Unlocks ${down.length}`, `解鎖 ${down.length} 項`)}</span>` : ""}</span>${!compact && due && due !== t.due && !t.done ? `<span class="inherited">${tr("Needed for a task due", "後續任務期限為")} ${esc(due)} ${tr("· not your own deadline", "· 此項本身沒有這個期限")}</span>` : ""}${!compact ? reminderLabel(t) : ""}</button>${!compact ? `<span class="task-end">${icon("arrow")}</span>` : ""}</article>`;
}
function empty() {
  const ordinary = tasks.filter(t => !isRoutine(t));
  if (ordinary.length)
    return `<div class="empty"><div class="empty-icon">${icon("check")}</div><h2>${tr("A little breathing room.", "留一點呼吸空間。")}</h2><p>${search || project ? tr("No matching tasks. Try a different search or space.", "沒有符合的任務，試試其他搜尋或領域。") : tr("All caught up. Your completed tasks are in Task history.", "待辦已完成，可在待辦記錄查看已完成任務。")}</p><button class="primary" data-new>${icon("plus")}${tr("New task", "新增任務")}</button></div>`;
  return `<div class="empty"><div class="empty-icon">${icon("focus")}</div><h2>${tr("A little clarity starts here.", "從一件小事，開始理清思緒。")}</h2><p>${tr("Give a task a purpose. Connect the steps. Make space for what matters.", "寫下任務的必要性，連接步驟，留空間給重要的事。")}</p><button class="primary" data-new>${icon("plus")}${tr("Create your first task", "建立第一個任務")}</button>${ordinary.length === 0 && !demo ? `<button class="text-button" data-demo>${tr("Explore an example first", "先看看範例")} ${icon("arrow")}</button>` : ""}</div>`;
}
function focusView(list) {
  const active = rank(tasks).filter((t) => list.includes(t)),
    ready = active.filter((t) => !blockers(t, tasks).length),
    blocked = active.filter((t) => blockers(t, tasks).length),
    lead = ready[0];
  if (!active.length) return empty();
  return `<section class="focus-card"><div><div class="eyebrow"><span class="pulse-dot"></span>${tr("ONE STEP AT A TIME", "一步一步，慢慢來")}</div><h2>${esc(lead ? lead.title : tr("Clear the path ahead.", "先疏通前面的路。"))}</h2><p>${lead ? tr("A good place to start. Ready to do, with nothing in the way.", "可以從這裡開始。前置已完成，現在就能做。") : tr("Your filtered tasks are waiting on prerequisites. Open a task to find the first step.", "目前篩選的任務需要前置步驟。開啟任務，找出起點。")}</p>${lead ? `<button class="primary" data-edit="${esc(lead.id)}">${tr("See the next step", "查看下一步")}${icon("arrow")}</button>` : ""}</div><div class="orbit" aria-hidden="true"><div class="orbit-inner">${icon("check")}</div><span class="orbit-dot d1"></span><span class="orbit-dot d2"></span></div></section><div class="section-label"><h2>${tr("Ready when you are", "現在可以開始")} <span>${ready.length}</span></h2><span>${tr("Ordered by deadline & priority", "依期限及優先度排序")}</span></div><div class="task-list">${ready.map((t) => card(t)).join("") || `<p class="quiet-pad">${tr("No ready tasks in this view.", "此篩選沒有可開始的任務。")}</p>`}</div>${blocked.length ? `<div class="section-label"><h2>${tr("Waiting for a first step", "等待前置步驟")} <span>${blocked.length}</span></h2><button class="text-button" data-view="paths">${tr("See connections", "查看關係")}${icon("arrow")}</button></div><div class="task-list">${blocked.map((t) => card(t)).join("")}</div>` : ""}`;
}
function matrixView(list) {
  const configs = [
    [
      "must",
      true,
      tr("Do first", "先處理"),
      tr("Must · Urgent", "必須 · 緊急"),
      "coral",
    ],
    [
      "must",
      false,
      tr("Make a plan", "安排時間"),
      tr("Must · Not urgent", "必須 · 不緊急"),
      "mint",
    ],
    [
      "want",
      true,
      tr("Choose intentionally", "有意識地選擇"),
      tr("Want · Urgent", "想做 · 緊急"),
      "amber",
    ],
    [
      "want",
      false,
      tr("Make room", "留些空間"),
      tr("Want · Not urgent", "想做 · 不緊急"),
      "lilac",
    ],
  ];
  return `<p class="view-note">${tr("Urgency includes your choice and deadlines within 3 days, including linked follow-up tasks. Blocked tasks stay visible.", "緊急性包含你的設定，以及 3 天內到期的本項或後續任務。被阻擋的任務仍會顯示。")}</p><div class="matrix">${configs
    .map(([intent, u, title, sub, color]) => {
      const items = rank(tasks).filter(
        (t) =>
          list.includes(t) && t.intent === intent && urgency(t, tasks) === u,
      );
      return `<section class="quadrant ${color}"><header><div><h2><span class="dot"></span>${title}</h2><p>${sub}</p></div><span class="count">${items.length}</span></header>${items.map((t) => card(t, true)).join("") || `<p class="matrix-empty">${tr("A little breathing room.", "留一點呼吸空間。")}</p>`}<button class="quadrant-add" data-new data-intent="${intent}" data-urgent="${u}">+ ${tr("Add a task", "新增任務")}</button></section>`;
    })
    .join("")}</div>`;
}
function pathsView(list) {
  if (!list.length) return empty();
  const ids = new Set(list.map((t) => t.id));
  function include(id) {
    if (ids.has(id)) return;
    ids.add(id);
    tasks.find((t) => t.id === id)?.deps.forEach(include);
  }
  list.forEach((t) => t.deps.forEach(include));
  const linked = tasks.filter((t) => ids.has(t.id)),
    levels = new Map();
  function level(t) {
    if (!levels.has(t.id))
      levels.set(
        t.id,
        t.deps.length
          ? 1 +
              Math.max(
                ...t.deps.map((id) => level(tasks.find((t) => t.id === id))),
              )
          : 0,
      );
    return levels.get(t.id);
  }
  linked.forEach(level);
  const max = Math.max(...levels.values()),
    groups = Array.from({ length: max + 1 }, (_, i) =>
      linked.filter((t) => levels.get(t.id) === i),
    );
  const positions = new Map();
  groups.forEach((group, col) =>
    group.forEach((t, row) =>
      positions.set(t.id, { x: col * 288 + 24, y: row * 126 + 62 }),
    ),
  );
  const width = groups.length * 288 + 16,
    height = Math.max(...groups.map((x) => x.length)) * 126 + 90;
  return `<p class="view-note">${tr("Follow the lines from left to right. Complete a prerequisite to unlock the next step. Matching tasks include their prerequisite context.", "沿線由左至右，完成前置任務便能解鎖下一步。篩選結果會保留相關前置任務。")}</p><div class="graph-scroll" tabindex="0" aria-label="${tr("Task dependency diagram; scroll horizontally", "任務關係圖，可水平捲動")}"><div class="graph" style="width:${width}px;height:${height}px"><svg class="connections" width="${width}" height="${height}" aria-hidden="true"><defs><marker id="arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8" fill="#647968"/></marker></defs>${linked
    .flatMap((t) =>
      t.deps.map((id) => {
        const a = positions.get(id),
          b = positions.get(t.id);
        return `<path d="M${a.x + 242} ${a.y + 43} C${a.x + 267} ${a.y + 43},${b.x - 25} ${b.y + 43},${b.x - 5} ${b.y + 43}" fill="none" stroke="${tasks.find((x) => x.id === id).done ? "#9fc5a5" : "#455047"}" stroke-width="1.5" marker-end="url(#arrowhead)"/>`;
      }),
    )
    .join(
      "",
    )}</svg>${groups.map((group, col) => `<span class="graph-label" style="left:${col * 288 + 24}px">${col === 0 ? tr("START HERE", "從這裡開始") : tr(`STEP ${col + 1}`, `第 ${col + 1} 步`)}</span>`).join("")}${linked
    .map((t) => {
      const p = positions.get(t.id),
        blocked = blockers(t, tasks).length;
      return `<button class="graph-node ${t.done ? "completed" : blocked ? "" : "ready"}" style="left:${p.x}px;top:${p.y}px" data-edit="${esc(t.id)}"><span class="node-status">${icon(t.done ? "check" : blocked ? "lock" : "focus")}${`${statusLabel(taskStatus(t))}${blocked ? tr(" · Waiting", " · 等待前置") : ""}`} <span>${t.intent}</span></span><strong>${esc(t.title)}</strong><small>${esc(t.project || tr("Unsorted", "未分類"))}${t.due ? " · " + esc(dateLabel(t.due)) : ""}</small></button>`;
    })
    .join("")}</div></div>`;
}
function allView(list) {
  const active = rank(tasks).filter((t) => list.includes(t)),
    done = list.filter((t) => t.done);
  return list.length
    ? `<div class="section-label"><h2>${tr("Open tasks", "待處理")} <span>${active.length}</span></h2></div><div class="task-list">${active.map((t) => card(t)).join("")}</div>${done.length ? `<div class="section-label"><h2>${tr("Completed", "已完成")} <span>${done.length}</span></h2></div><div class="task-list">${done.map((t) => card(t)).join("")}</div>` : ""}`
    : empty();
}
function render() {
  document.documentElement.lang = lang === "zh" ? "zh-Hant" : "en";
  const list = filtered(),
    active = list.filter((t) => !t.done),
    ready = active.filter((t) => !blockers(t, tasks).length),
    blocked = active.length - ready.length,
    dues = active.filter((t) => t.due && dayDiff(t.due) <= 3).length,
    scope = tasks.filter(t => isRoutine(t) === (view === "routines")),
    projects = [...new Set(scope.map((t) => t.project).filter(Boolean))].sort();
  $("#app").innerHTML =
    `<aside class="sidebar"><a class="brand" href="#focus"><img src="icon.svg" alt=""><span>mydo<span class="brand-dot">.</span></span></a><div class="workspace-label">${tr("YOUR PERSONAL SPACE", "你的個人空間")}</div><nav aria-label="${tr("Main navigation", "主要導覽")}">${MAIN_VIEWS.map(key => [key, names()[key]])
      .map(
        ([key, title]) =>
          `<button data-view="${key}" class="nav-button ${(view === "tasks" ? "focus" : view) === key ? "active" : ""}" ${(view === "tasks" ? "focus" : view) === key ? 'aria-current="page"' : ""}>${icon(key)}<span>${title}</span>${key === "routines" ? `<span class="nav-count">${tasks.filter(isRoutine).length}</span>` : ""}</button>`,
      )
      .join(
        "",
      )}</nav><div class="sidebar-bottom"><div class="night-note">${icon("moon")}<span>${tr("Less noise.<br>More intention.", "少一點雜音。<br>多一點從容。")}</span></div><button class="small-button" id="export">${icon("down")}${tr("Export backup", "匯出備份")}</button><button class="small-button" id="import">${tr("Import backup", "匯入備份")}</button><button class="small-button" id="cloud-settings">${icon("all")}${tr("Cloud tasks", "雲端任務")}</button><button class="small-button" id="phone-settings">${icon("clock")}${tr("Phone reminders", "手機通知")}</button><button class="small-button" id="install-help">${icon("plus")}${tr("Add to iPhone", "加入 iPhone 主畫面")}</button><div class="storage-dot"><span></span>${demo ? tr("Example · changes not saved", "範例 · 更改不會儲存") : tr("Saved on this browser", "儲存於此瀏覽器")}</div></div></aside><div class="workspace"><header class="topbar"><div class="breadcrumb">${tr("My space", "我的空間")} <span>/</span> ${names()[view]}</div><div class="top-actions"><button id="language" class="language" aria-label="${tr("Switch to Chinese", "切換至英文")}">EN <span>/</span> 繁中</button><span class="avatar" aria-hidden="true">M</span></div></header><main id="main"><div class="page-heading"><div><div class="eyebrow">${esc(new Intl.DateTimeFormat(lang === "zh" ? "zh-HK" : "en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date()))}</div><h1>${names()[view]}<span class="heading-dot">.</span></h1><p>${view === "routines" ? tr("Small actions, kept going.", "把日常做好，持續下去。") : tr("A clear head. A meaningful next step.", "思緒清晰一點，下一步踏實一點。")}</p></div><div class="heading-actions">${view !== "routines" && view !== "tasks" ? `<button class="secondary history-link" data-view="tasks">${tr("Task history", "待辦記錄")}</button>` : ""}<button class="primary add-main" data-new>${icon("plus")}${view === "routines" ? tr("New routine", "新增日常") : tr("New task", "新增任務")}<kbd>N</kbd></button></div></div>${recovery ? `<div class="banner danger">${tr("Your stored data could not be read. It has been preserved. Export it before restoring a valid backup.", "無法讀取現有資料，原始資料已保留。請先匯出，再還原有效備份。")}</div>` : ""}${demo ? `<div class="banner">${tr("You’re exploring sample tasks. Nothing here is saved to your list.", "你正在瀏覽範例任務，更改不會存入你的清單。")}<button class="text-button" id="exit-demo">${tr("Back to my tasks", "返回我的任務")} ${icon("arrow")}</button></div>` : ""}${view === "routines" ? routineUI.stats(list) : `<div class="stats"><div><span>${tr("Open tasks", "待處理任務")}</span><strong>${active.length.toString().padStart(2, "0")}</strong></div><div><span><i class="stat-dot mint"></i>${tr("Ready to start", "可以開始")}</span><strong>${ready.length.toString().padStart(2, "0")}</strong></div><div><span><i class="stat-dot amber"></i>${tr("Due soon / overdue", "快到期／已逾期")}</span><strong>${dues.toString().padStart(2, "0")}</strong></div><div><span>${icon("lock")}${tr("Waiting on a step", "等待前置步驟")}</span><strong>${blocked.toString().padStart(2, "0")}</strong></div></div>`}<div class="toolbar"><div class="view-tabs">${MAIN_VIEWS.map(key => [key, names()[key]])
      .map(
        ([key, title]) =>
          `<button data-view="${key}" class="${(view === "tasks" ? "focus" : view) === key ? "selected" : ""}" aria-label="${title}" title="${title}">${icon(key)}<span>${title}</span></button>`,
      )
      .join(
        "",
      )}</div><label class="search">${icon("search")}<input id="search" type="search" aria-label="${view === "routines" ? tr("Search routines", "搜尋日常") : tr("Search tasks", "搜尋任務")}" placeholder="${view === "routines" ? tr("Find a routine…", "搜尋日常…") : tr("Find a task…", "搜尋任務…")}" value="${esc(search)}"></label></div><section class="group-filter" aria-label="${tr("Task groups", "任務分組")}"><div class="group-heading"><strong>${tr("Groups", "分組")}</strong><span>${view === "routines" ? tr("Tap a group to filter · paused routines included", "點選分組篩選 · 包含已暫停日常") : tr("Tap a group to filter · counts include completed tasks", "點選分組篩選 · 數量包含已完成任務")}</span></div><div class="group-chips"><button data-project="" class="group-chip ${!project ? "selected" : ""}" aria-pressed="${!project}">${tr("All groups", "所有分組")}<span>${scope.length}</span></button>${projects.map(p => `<button data-project="${esc(p)}" class="group-chip ${project === p ? "selected" : ""}" aria-pressed="${project === p}">${esc(p)}<span>${scope.filter(t => t.project === p).length}</span></button>`).join("")}</div><p>${project ? tr(`Showing group: ${esc(project)}`, `目前分組：${esc(project)}`) : tr("Add a group name when saving a task. Tasks with the same name are grouped together.", "儲存任務時填寫分組名稱，同名任務會歸入同一組。")}</p></section><div id="phone-sync-status" role="status">${phoneStatus()}</div><div id="content">${{ focus: focusView, matrix: matrixView, paths: pathsView, tasks: allView, routines: routineUI.view }[view](list)}</div><footer>${tr("You don’t have to do everything. Just the next right thing.", "不必一次做完所有事，先做好下一步。")}<span>MYDO / 01</span></footer></main></div>`;
}
function openEditor(id = "", defaults = {}) {
  if (isRoutine(tasks.find(t => t.id === id))) return routineUI.open(id);
  const t = tasks.find((t) => t.id === id) || {
      id: crypto.randomUUID(),
      title: "",
      notes: "",
      project: project || "",
      intent: defaults.intent || "must",
      urgent: defaults.urgent === "true",
      due: "",
      deps: [],
      done: false,
      created: new Date().toISOString(),
    },
    existing = tasks.some((x) => x.id === t.id),
    deps = tasks.filter((x) => x.id !== t.id && !isRoutine(x)),
    followers = tasks.filter((x) => x.deps.includes(t.id));
  const dialog = $("#editor");
  dialog.innerHTML = `<form id="task-form"><header class="dialog-header"><div><div class="eyebrow">${tr("MAKE THE NEXT STEP CLEAR", "把下一步想清楚")}</div><h2 id="editor-title">${existing ? tr("Task details", "任務詳情") : tr("Something on your mind?", "有什麼想做？")}</h2></div><button type="button" class="icon-button" data-close aria-label="${tr("Close", "關閉")}">${icon("close")}</button></header><label><span>${tr("Task name", "任務名稱")} *</span><input name="title" maxlength="200" required placeholder="${tr("What needs to happen?", "需要完成什麼？")}" value="${esc(t.title)}"></label><fieldset class="progress-fields"><legend>${tr("Task progress", "任務進度")}</legend><div class="progress-options">${TASK_STATUSES.map(status => `<label><input type="radio" name="status" value="${status}" ${taskStatus(t) === status ? "checked" : ""}><span>${statusLabel(status)}</span></label>`).join("")}</div><small>${tr("Reminders continue until Complete. Only Complete unlocks follow-up tasks.", "提醒會持續至已完成；只有已完成才會解鎖後續任務。")}</small></fieldset><div class="form-grid"><fieldset><legend>${tr("How important is it to you?", "對你有多必要？")}</legend><div class="segmented"><label><input type="radio" name="intent" value="must" ${t.intent === "must" ? "checked" : ""}><span>Must · ${tr("Need to", "必須做")}</span></label><label><input type="radio" name="intent" value="want" ${t.intent === "want" ? "checked" : ""}><span>Want · ${tr("Like to", "想做")}</span></label></div></fieldset><fieldset><legend>${tr("Does it feel urgent?", "現在需要急著做嗎？")}</legend><div class="segmented"><label><input type="radio" name="urgent" value="true" ${t.urgent ? "checked" : ""}><span>${tr("Urgent", "緊急")}</span></label><label><input type="radio" name="urgent" value="false" ${!t.urgent ? "checked" : ""}><span>${tr("Not urgent", "不緊急")}</span></label></div></fieldset></div><div class="form-grid"><label>${tr("Real deadline", "真實截止日期")}<input name="due" type="date" min="1900-01-01" max="9999-12-31" value="${esc(t.due)}"><small>${tr("Optional. End of this day, in your local time.", "可留空，以你所在地當日結束為準。")}</small></label><label>${tr("Group / project", "分組／專案")}<input name="project" maxlength="80" list="projects" value="${esc(t.project)}" placeholder="${tr("e.g. Work, Life, Personal", "例如：工作、生活、個人")}" ><datalist id="projects">${[...new Set(tasks.map((t) => t.project))].map((p) => `<option value="${esc(p)}"></option>`).join("")}</datalist><small>${tr("Choose an existing name or type a new one. The group appears after you save the task.", "選擇現有名稱或輸入新名稱；儲存任務後，分組便會出現。")}</small></label></div><fieldset><legend>${icon("paths")}${tr("What needs to happen first?", "需要先完成什麼？")}</legend><p class="field-help">${tr("Select all prerequisites. This task unlocks when all are complete.", "選取所有前置任務，全部完成後才會解鎖此任務。")}</p><div class="dep-picker">${deps.length ? deps.map((d) => `<label><input type="checkbox" name="deps" value="${esc(d.id)}" ${t.deps.includes(d.id) ? "checked" : ""}><span>${esc(d.title)}${d.done ? ` <small>✓ ${tr("Done", "已完成")}</small>` : ""}</span><button type="button" class="text-button dep-open" data-edit="${esc(d.id)}" aria-label="${esc(tr("Open ", "開啟 ") + d.title)}">↗</button></label>`).join("") : `<small>${tr("Create another task to connect it here.", "建立另一個任務後，就能在此連接。")}</small>`}</div></fieldset>${followers.length ? `<div class="followups"><strong>${tr("What this unlocks", "完成後可解鎖")}</strong>${followers.map((f) => `<button type="button" class="text-button" data-edit="${esc(f.id)}">${esc(f.title)} ${icon("arrow")}</button>`).join("")}</div>` : ""}<fieldset class="reminder-fields"><legend>${icon("clock")}${tr("Phone reminders", "手機通知")}</legend><p class="field-help">${tr("Lock-screen notifications. Enable this phone in Phone reminders first.", "鎖定畫面通知。請先在「手機通知」啟用這部手機。")}</p><label class="reminder-toggle"><input type="checkbox" name="remindDue" ${t.reminder?.onDue ? "checked" : ""}>${tr("Remind me on the due date", "截止日通知我")}</label><label>${tr("Repeat until completed", "重複提醒，直到完成")}<select name="remindRepeat">${[["none", tr("No repeat", "不重複")], ["daily", tr("Every day", "每日")], ["weekly", tr("Every week", "每週")], ["monthly", tr("Every month", "每月")]].map(([value, label]) => `<option value="${value}" ${repeatFrequency(t.reminder) === value ? "selected" : ""}>${label}</option>`).join("")}</select></label><div class="form-grid"><label>${tr("Notification time", "通知時間")}<input type="time" name="remindTime" required value="${esc(t.reminder?.time || "09:00")}"></label><label>${tr("Repeating reminders start", "重複提醒開始日期")}<input type="date" name="remindStart" value="${esc(t.reminder?.start || today())}"></label></div><label>${tr("Time zone", "時區")}<select name="remindZone">${[...new Set([t.reminder?.timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone, "Asia/Hong_Kong", "UTC"].filter(Boolean))].map((z) => `<option value="${esc(z)}" ${z === (t.reminder?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone) ? "selected" : ""}>${esc(z)}</option>`).join("")}</select></label><small>${tr("Weekly repeats on the start weekday; monthly on the start day (last day in shorter months). Due-date and repeat reminders combine into one notification. Offline completion stops pushes after syncing.", "每週按開始日期的星期重複；每月按同一日，較短月份用最後一天。截止日與重複提醒重疊時只通知一次。離線完成後，同步才會停止推播。")}</small></fieldset><label>${tr("Notes", "備註")}<textarea name="notes" maxlength="5000" rows="3" placeholder="${tr("A little context for your future self…", "留些提示給之後的自己…")}">${esc(t.notes)}</textarea></label><p class="form-error" id="form-error" role="alert"></p><div class="dialog-footer">${existing ? `<button type="button" class="text-button danger-text" data-delete="${esc(t.id)}">${tr("Delete task", "刪除任務")}</button>` : "<span></span>"}<div><button type="button" class="secondary" data-close>${tr("Cancel", "取消")}</button><button type="submit" class="primary">${tr("Save task", "儲存任務")}</button></div></div>${existing ? `<button type="submit" class="secondary" name="complete" value="true">${icon(t.done ? "all" : "check")}${t.done ? tr("Reopen task", "重新開啟任務") : tr("Mark complete", "標記完成")}</button>` : ""}</form>`;
  if (!dialog.open) dialog.showModal();
  dialog.querySelector("[name=title]").focus();
  $("#task-form").onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const selectedStatus = e.submitter?.name === "complete"
        ? (t.done ? "preparing" : "complete") : f.get("status");
      if (t.done && selectedStatus !== "complete") setTaskStatus(tasks, t.id, selectedStatus);
      let next = saveTask(tasks, {
        ...t,
        status: selectedStatus,
        done: selectedStatus === "complete",
        title: f.get("title").trim(),
        notes: f.get("notes"),
        project: f.get("project").trim(),
        intent: f.get("intent"),
        urgent: f.get("urgent") === "true",
        due: f.get("due"),
        deps: f.getAll("deps"),
        reminder: {
          onDue: f.has("remindDue"),
          daily: f.get("remindRepeat") === "daily",
          repeat: f.get("remindRepeat"),
          time: f.get("remindTime"),
          start: f.get("remindStart"),
          timeZone: f.get("remindZone"),
        },
      });
      commit(next);
      const saved = next.find(item => item.id === t.id);
      // Show the saved task even if the old group, search or view hid it.
      project = saved.project;
      search = "";
      view = "tasks";
      location.hash = "tasks";
      render();
      dialog.close();
      toast(saved.project
        ? tr(`Saved to group: ${saved.project}`, `已儲存至分組：${saved.project}`)
        : tr("Task saved without a group.", "已儲存任務，尚未分組。"));
    } catch (err) {
      $("#form-error").textContent = errorText(err);
    }
  };
}
function confirmAction(title, message, action) {
  const d = $("#confirm");
  d.innerHTML = `<div class="confirm-content"><h2 id="confirm-title">${esc(title)}</h2><p>${esc(message)}</p><div class="confirm-actions"><button class="secondary" id="confirm-no">${tr("Cancel", "取消")}</button><button class="primary" id="confirm-yes">${tr("Confirm", "確認")}</button></div></div>`;
  d.showModal();
  $("#confirm-no").onclick = () => d.close();
  $("#confirm-yes").onclick = () => {
    try {
      action();
      d.close();
    } catch (e) {
      toast(errorText(e));
    }
  };
  $("#confirm-no").focus();
}
function changeView(next) {
  next = normalizeView(next);
  if ((view === 'routines') !== (next === 'routines')) { project = ''; search = ''; }
  view = next;
  render();
}
function openPendingTask() {
  if (!pendingOpenTask || $('dialog[open]')) return;
  const task = tasks.find(t => t.id === pendingOpenTask);
  if (!task) return;
  pendingOpenTask = '';
  project = ''; search = '';
  changeView(isRoutine(task) ? 'routines' : 'tasks');
  location.hash = view;
  openEditor(task.id);
}
function download(content) {
  const url = URL.createObjectURL(
      new Blob([content], { type: "application/json" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = `mydo-${today()}.backup.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  try {
    if (b.hasAttribute("data-view")) {
      changeView(b.dataset.view);
      location.hash = view;
    } else if (b.hasAttribute("data-project")) {
      project = b.dataset.project;
      search = "";
      render();
    } else if (b.hasAttribute("data-new")) {
      if (view === 'routines') routineUI.open(); else openEditor("", b.dataset);
    }
    else if (b.hasAttribute("data-edit")) openEditor(b.dataset.edit);
    else if (b.hasAttribute('data-routine-check')) routineUI.check(b.dataset.routineCheck);
    else if (b.hasAttribute("data-toggle")) {
      commit(toggleTask(tasks, b.dataset.toggle));
      toast(tr("Task updated.", "任務已更新。"));
    } else if (b.hasAttribute("data-close")) $("#editor").close();
    else if (b.hasAttribute("data-delete")) {
      const next = deleteTask(tasks, b.dataset.delete);
      const routine = isRoutine(tasks.find(t => t.id === b.dataset.delete));
      confirmAction(
        routine ? tr('Delete this routine?', '刪除此日常？') : tr("Delete this task?", "刪除此任務？"),
        routine ? tr('This also deletes its records. Pause it instead to keep them.', '完成紀錄也會刪除。如需保留紀錄，可改為暫停。') : tr(
          "This removes the task. Export a backup if you want to keep it.",
          "任務將被刪除，如需保留請先匯出備份。",
        ),
        () => {
          commit(next);
          $("#editor").close();
          toast(routine ? tr("Routine deleted.", "已刪除日常。") : tr("Task deleted.", "已刪除任務。"));
        },
      );
    } else if (b.id === "phone-settings" || b.id === "cloud-settings") {
      openPhoneSettings();
    } else if (b.id === "install-help") {
      const d = $("#confirm");
      d.innerHTML = `<div class="confirm-content"><h2 id="confirm-title">${tr("Mydo, on your home screen.", "把 Mydo 放在主畫面。")}</h2><p>${tr("Open this website in Safari on your iPhone. Tap Share, choose Add to Home Screen, enable Open as Web App if shown, then tap Add. Open Mydo from its new icon.", "在 iPhone 的 Safari 開啟此網站。點分享，選擇「加入主畫面」，如有「作為 Web App 開啟」請開啟它，再點「新增」。之後從新圖示開啟 Mydo。")}</p><p>${tr("Load it online once to prepare offline access. Tasks stay on this device. Export a backup before moving from Safari into the installed app, then import it there if needed.", "首次請連線開啟，準備離線使用。任務保存在這部裝置。從 Safari 轉用主畫面 App 前請先匯出備份，如有需要可在 App 內匯入。")}</p><button class="primary" id="install-close">${tr("Got it", "明白")}</button></div>`;
      d.showModal();
      $("#install-close").onclick = () => d.close();
    } else if (b.id === "language") {
      lang = lang === "en" ? "zh" : "en";
      try {
        localStorage.setItem(LANG, lang);
      } catch {}
      render();
      if (!demo) syncAll();
    } else if (b.hasAttribute("data-demo")) {
      demo = true;
      tasks = demoTasks();
      render();
    } else if (b.id === "exit-demo") {
      demo = false;
      tasks = recovery
        ? []
        : parseBackup(localStorage.getItem(KEY) || '{"version":1,"tasks":[]}');
      render();
    } else if (b.id === "export")
      download(
        recovery
          ? localStorage.getItem(KEY) || ""
          : JSON.stringify(
              { version: 1, exportedAt: new Date().toISOString(), tasks },
              null,
              2,
            ),
      );
    else if (b.id === "import") {
      if (demo)
        toast(tr("Leave example mode before importing.", "請先退出範例模式。"));
      else $("#import-file").click();
    }
  } catch (err) {
    toast(errorText(err));
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "search") {
    search = e.target.value;
    const p = e.target.selectionStart;
    render();
    $("#search").focus();
    try {
      $("#search").setSelectionRange(p, p);
    } catch {}
  }
});
$("#import-file").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    if (file.size > 10000000) throw Error("format");
    const next = parseBackup(await file.text());
    confirmAction(
      tr("Restore this backup?", "還原此備份？"),
      tr(
        `Replace your current list with ${next.length} tasks? Export your current list first if you need to keep it.`,
        `以 ${next.length} 項任務取代目前清單？如需保留舊資料，請先取消並匯出備份。`,
      ),
      () => {
        localStorage.setItem(KEY, JSON.stringify({ version: 1, tasks: next }));
        recovery = false;
        tasks = next;
        project = "";
        search = "";
        render();
        syncAll();
        toast(tr("Backup restored.", "備份已還原。"));
      },
    );
  } catch (err) {
    toast(errorText(err));
  }
};
window.addEventListener("hashchange", () => {
  changeView(location.hash.slice(1));
});
window.addEventListener("storage", (e) => {
  if (e.key === KEY && !demo) {
    try {
      tasks = parseBackup(e.newValue || '{"version":1,"tasks":[]}');
      recovery = false;
      $("#editor").close();
      $("#confirm").close();
      render();
      syncAll();
      toast(tr("Updated from another tab.", "已同步另一分頁的更改。"));
    } catch {
      recovery = true;
      render();
    }
  }
});
document.addEventListener("keydown", (e) => {
  if (
    e.key.toLowerCase() === "n" &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName) &&
    !$("dialog[open]")
  ) {
    e.preventDefault();
    if (view === 'routines') routineUI.open(); else openEditor();
  }
});
// Recompute urgency when the local date changes or the tab becomes visible again.
let renderedDay = today() + routineUI.calendarKey();
setInterval(() => {
  const day = today() + routineUI.calendarKey();
  if (day !== renderedDay && !$("dialog[open]")) {
    renderedDay = day;
    render();
  }
}, 30000);
phone = new PhoneReminders({
  getTasks: () => {
    if (recovery) throw Error("storage");
    return demo
      ? parseBackup(localStorage.getItem(KEY) || '{"version":1,"tasks":[]}')
      : tasks;
  },
  getLanguage: () => lang,
  onChange: () => {
    const el = $("#phone-sync-status");
    if (el) el.innerHTML = phoneStatus();
  },
});
render();
cloud = new CloudTasks({
  auth: phone,
  getTasks: () => {
    if (recovery) throw Error("storage");
    return demo ? parseBackup(localStorage.getItem(KEY) || '{"version":1,"tasks":[]}') : tasks;
  },
  setTasks: (next) => {
    validate(next);
    if (recovery) throw Error("storage");
    // Do not replace task state under an open editor containing an older draft.
    if ($("#task-form, #routine-form") && $("#editor").open) throw Error("editing");
    localStorage.setItem(KEY, JSON.stringify({ version: 1, tasks: next }));
    if (!demo) { tasks = next; render(); openPendingTask(); }
  },
  onChange: () => { const el = $("#phone-sync-status"); if (el) el.innerHTML = phoneStatus(); },
});
if (!recovery) syncAll();
window.addEventListener("online", () => { if (!recovery) syncAll(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && !recovery) syncAll(); });
setInterval(() => { if (!document.hidden && cloud.enabled && !recovery && !$("dialog[open]")) syncAll(); }, 30000);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("./sw.js").catch(() => {}),
  );
}

function phoneStatus() {
  if (demo) return "";
  const cloudText = cloud?.enabled
    ? `<p class="push-status ${cloud.message === "synced" ? "" : "push-pending"}">${cloud.message === "synced"
      ? tr("Tasks synced to cloud · all your devices share this list", "任務已同步雲端 · 裝置共用同一清單")
      : cloud.message === "conflict" ? tr("Conflicting changes. Open Cloud tasks to review; both copies are preserved.", "更改有衝突，請開啟「雲端任務」處理；兩份資料已保留。")
      : tr("Task sync pending. Local changes are saved; open Cloud tasks to reconnect.", "任務尚待同步，本機更改已儲存；可開啟「雲端任務」重新連線。")}</p>`
    : "";
  if (!phone?.enabled) return cloudText;
  if (phone.message === "synced")
    return cloudText + `<p class="push-status">${tr("Phone reminders synced", "手機提醒已同步")}</p>`;
  return cloudText + `<p class="push-status push-pending">${tr("Reminder changes are not synced yet. Existing phone reminders may continue. Open Phone reminders to reconnect.", "提醒更改尚未同步，手機可能仍收到原有提醒。請開啟「手機通知」重新連線。")}</p>`;
}
function phoneError(e) {
  return (
    {
      login: tr(
        "Sign in with your Myfin cloud account email and password.",
        "請用 Myfin 雲端帳戶的電郵及密碼登入。",
      ),
      service: tr(
        "The notification service is not ready or could not be reached. No reminder has been confirmed.",
        "通知服務尚未接通或暫時無法連線，提醒尚未確認啟用。",
      ),
      permission: tr(
        "Allow notifications in iPhone Settings, then try again.",
        "請在 iPhone 設定允許通知，再重試。",
      ),
      unsupported: tr(
        "On iPhone, open Mydo from its Home Screen icon first.",
        "在 iPhone 請先從主畫面的 Mydo 圖示開啟。",
      ),
      rate: tr(
        "Wait a minute before sending another test notification.",
        "請等一分鐘再發送測試通知。",
      ),
      conflict: tr("The same task was edited on two devices. Choose which conflicting values to keep. Other changes will be merged.", "同一任務在兩部裝置有不同更改。請選擇保留哪一邊的衝突內容，其餘更改會合併。"),
      account: tr("This device is linked to another account. Export its tasks before switching accounts.", "此裝置綁定另一帳戶，切換前請先匯出任務。"),
      pending: tr("Cloud sync could not finish. Your local list is preserved; try again online.", "雲端同步未完成，本機清單已保留，請連線後重試。"),
      storage: tr("Could not read or save local tasks. Export a backup first.", "未能讀取或儲存本機任務，請先匯出備份。"),
      stopFirst: tr(
        "Stop this phone's reminders before changing accounts.",
        "請先停止這部手機的提醒，才切換帳戶。",
      ),
    }[e.message] ||
    tr(
      "Could not finish setting up phone notifications. Please retry.",
      "未能完成手機通知設定，請再試。",
    )
  );
}
function openPhoneSettings() {
  if (demo) {
    toast(
      tr(
        "Leave example mode to set up real notifications.",
        "請先退出範例模式，再設定真正通知。",
      ),
    );
    return;
  }
  const dialog = $("#editor");
  dialog.innerHTML = `<section class="phone-panel"><header class="dialog-header"><div><div class="eyebrow">MYDO</div><h2 id="editor-title">${tr("Cloud tasks & phone reminders", "雲端任務與手機通知")}</h2></div><button class="icon-button" data-close aria-label="${tr("Close", "關閉")}">${icon("close")}</button></header><p>${tr("Get a lock-screen notification on the due date, or repeat daily, weekly or monthly until completed.", "截止日收到鎖定畫面通知，或每日、每週、每月重複提醒直到完成。")}</p><p class="field-help">${tr("On iPhone: add Mydo to the Home Screen, open its icon, then allow notifications. Cloud sync shares the full task list, including notes, through your own Supabase account. Phone reminders can also be used on their own.", "iPhone：先將 Mydo 加入主畫面，再從圖示開啟並允許通知。雲端同步會把完整任務清單（包括備註）存至你的 Supabase 帳戶。也可只使用手機通知。")}</p><div id="phone-service" role="status">${tr("Checking notification service…", "正在檢查通知服務…")}</div>${phone.session ? `<p class="signed-in">${tr("Signed in", "已登入")} · ${esc(phone.session.user?.email || "")}</p><section class="cloud-panel"><h3>${tr("Task sync", "任務同步")}</h3><p>${cloud.enabled ? tr("Cloud sync is on. This device merges its saved tasks with your other devices.", "雲端同步已開啟，本機任務會與其他裝置合併。") : tr("Keep your existing tasks and merge them with your cloud list. A local backup is saved before the first sync.", "保留現有任務並與雲端清單合併，首次同步前會保存一份本機備份。")}</p><div class="phone-actions"><button class="primary" id="enable-cloud">${cloud.enabled ? tr("Sync tasks now", "立即同步任務") : tr("Enable cloud task sync", "啟用雲端任務同步")}</button>${cloud.enabled ? `<button class="secondary" id="cloud-backup">${tr("Export original local backup", "匯出原本的本機備份")}</button><button class="text-button" id="stop-cloud">${tr("Pause cloud sync on this device", "暫停此裝置的雲端同步")}</button>` : ""}${cloud.message === "conflict" ? `<p class="form-error">${phoneError(Error("conflict"))}</p><button class="secondary" id="cloud-local">${tr("Keep this device's conflicting values", "保留本機的衝突內容")}</button><button class="secondary" id="cloud-remote">${tr("Keep cloud conflicting values", "保留雲端的衝突內容")}</button>` : ""}</div></section><div class="phone-actions"><button class="primary" id="enable-phone" disabled>${phone.enabled ? tr("Reconnect notifications", "重新連接通知") : tr("Enable this phone", "啟用這部手機")}</button>${phone.enabled ? `<button class="secondary" id="test-phone">${tr("Send test notification", "發送測試通知")}</button><button class="secondary" id="stop-phone">${tr("Stop this phone's reminders", "停止這部手機的提醒")}</button>` : ""}<button class="text-button" id="logout-phone">${tr("Stop reminders & sign out", "停止提醒並登出")}</button></div>` : `<form id="phone-login"><label>${tr("Myfin cloud account email", "Myfin 雲端帳戶電郵")}<input name="email" type="email" autocomplete="username" required></label><label>${tr("Password", "密碼")}<input name="password" type="password" autocomplete="current-password" required></label><button type="submit" class="primary">${tr("Sign in", "登入")}</button><a class="text-button" href="./reset.html" target="_blank" rel="noopener">${tr("Forgot password?", "忘記密碼？")}</a></form>`}<p class="form-error" id="phone-error" role="alert"></p><p class="field-help">${tr("Tasks stay available offline. With cloud sync enabled, this account shares them across devices. Notifications are best-effort, not an alarm clock. Offline completion needs a successful sync to stop further reminders.", "任務可離線使用。啟用雲端同步後，同一帳戶會在裝置間共用清單。通知可能因網絡或專注模式而延遲，不是鬧鐘。離線標記完成後，需要成功同步才會停止後續提醒。")}</p></section>`;
  if (!dialog.open) dialog.showModal();
  phone
    .config()
    .then((c) => {
      if (!$("#phone-service")) return;
      $("#phone-service").textContent = c.ready
        ? tr("Notification service connected", "通知服務已連線")
        : tr("Notification service is awaiting setup", "通知服務有待完成設定");
      if ($("#enable-phone")) $("#enable-phone").disabled = !c.ready;
    })
    .catch((e) => {
      if ($("#phone-service")) $("#phone-service").textContent = phoneError(e);
    });
  const run = async (button, fn, success) => {
    button.disabled = true;
    try {
      await fn();
      openPhoneSettings();
      if (success) toast(success);
    } catch (e) {
      if ($("#phone-error")) $("#phone-error").textContent = phoneError(e);
      button.disabled = false;
    }
  };
  if ($("#enable-cloud")) $("#enable-cloud").onclick = (e) => run(e.currentTarget, async () => {
    if (cloud.enabled) { await cloud.sync(); if (cloud.message !== "synced") throw Error(cloud.message); }
    else await cloud.enable();
    await phone.sync();
  }, tr("Cloud tasks synced.", "任務已同步雲端。"));
  if ($("#stop-cloud")) $("#stop-cloud").onclick = (e) => run(e.currentTarget, () => cloud.disable(), tr("Cloud sync paused on this device.", "已暫停此裝置的雲端同步。"));
  if ($("#cloud-backup")) $("#cloud-backup").onclick = () => {
    const raw = localStorage.getItem("mydo.cloud.backup." + cloud.owner);
    if (raw) download(raw);
    else toast(tr("No original local backup on this device.", "此裝置沒有原本的本機備份。"));
  };
  for (const [id, preference] of [["cloud-local", "local"], ["cloud-remote", "remote"]])
    if ($("#" + id)) $("#" + id).onclick = (e) => { const button = e.currentTarget; confirmAction(
      tr("Resolve conflicting edits?", "處理衝突更改？"),
      tr("Export a backup first if you need to keep both versions. Only conflicting values use your choice.", "如需保留兩個版本，請先匯出備份。你的選擇只套用到衝突內容。"),
      () => run(button, async () => { await cloud.sync(preference); if (cloud.message !== "synced") throw Error(cloud.message); }, tr("Conflicts resolved.", "已處理衝突。"))); };
  if ($("#phone-login"))
    $("#phone-login").onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      run(
        e.submitter,
        () => phone.login(f.get("email"), f.get("password")),
        tr(
          "Signed in. Now enable notifications on this phone.",
          "已登入，現在可以啟用這部手機的通知。",
        ),
      );
      e.target.password.value = "";
    };
  if ($("#enable-phone"))
    $("#enable-phone").onclick = (e) =>
      run(
        e.currentTarget,
        async () => { await phone.enable(); if (cloud.enabled) await cloud.sync(); },
        tr(
          "Phone reminders enabled. Send a test to check delivery.",
          "手機提醒已啟用，請發送測試通知確認接收。",
        ),
      );
  if ($("#test-phone"))
    $("#test-phone").onclick = (e) =>
      run(
        e.currentTarget,
        () => phone.test(),
        tr(
          "Test accepted by the push service. Check your phone.",
          "推播服務已接受測試通知，請查看手機。",
        ),
      );
  if ($("#stop-phone"))
    $("#stop-phone").onclick = (e) =>
      run(
        e.currentTarget,
        () => phone.disable(),
        tr("This phone's reminders stopped.", "已停止這部手機的提醒。"),
      );
  if ($("#logout-phone"))
    $("#logout-phone").onclick = (e) =>
      run(e.currentTarget, async () => { if (cloud.enabled) await cloud.disable(); await phone.logout(); }, tr("Signed out.", "已登出。"));
}

if ("serviceWorker" in navigator)
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.type === "mydo-open-task") {
      pendingOpenTask = e.data.taskId;
      openPendingTask();
    }
  });
const notificationTask = new URL(location.href).searchParams.get("task");
if (notificationTask) {
  const clean = new URL(location.href);
  clean.searchParams.delete("task");
  history.replaceState(null, "", clean);
  pendingOpenTask = notificationTask;
  openPendingTask();
}
