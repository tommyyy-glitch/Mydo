const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const date = (d) =>
  typeof d === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(d) &&
  Number.isFinite(Date.parse(d)) &&
  new Date(d).toISOString().slice(0, 10) === d;
function validateRoutine(t, frequency) {
  const r = t.routine;
  if (
    !r || typeof r !== "object" || Array.isArray(r) ||
    !["daily", "weekly", "monthly"].includes(r.frequency) ||
    !Array.isArray(r.weekdays) ||
    r.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6) ||
    new Set(r.weekdays).size !== r.weekdays.length ||
    (r.frequency === "weekly" ? !r.weekdays.length : r.weekdays.length !== 0) ||
    !date(r.start) || typeof r.timeZone !== "string" ||
    r.timeZone.length > 80 || typeof r.paused !== "boolean" ||
    !r.checks || typeof r.checks !== "object" || Array.isArray(r.checks) ||
    Object.keys(r.checks).length > 3660 ||
    Object.entries(r.checks).some(([d, done]) => !date(d) || typeof done !== "boolean") ||
    t.due !== "" || t.reminder.onDue || frequency !== r.frequency ||
    t.reminder.start !== r.start || t.reminder.timeZone !== r.timeZone
  ) throw Error("tasks");
}
export function validateSubscription(s) {
  if (!s || typeof s.endpoint !== "string" || s.endpoint.length > 4096)
    throw Error("subscription");
  const u = new URL(s.endpoint),
    h = u.hostname;
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    u.hash ||
    !(
      h === "web.push.apple.com" ||
      h.endsWith(".push.apple.com") ||
      h === "fcm.googleapis.com" ||
      h === "updates.push.services.mozilla.com" ||
      h.endsWith(".push.services.mozilla.com")
    )
  )
    throw Error("subscription");
  if (
    !/^[A-Za-z0-9_-]{87}=?$/.test(s.keys?.p256dh || "") ||
    !/^[A-Za-z0-9_-]{22}={0,2}$/.test(s.keys?.auth || "")
  )
    throw Error("subscription");
  return {
    endpoint: s.endpoint,
    keys: { p256dh: s.keys.p256dh, auth: s.keys.auth },
    expirationTime: null,
  };
}
export function validateTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length > 100) throw Error("tasks");
  const ids = new Set();
  for (const t of tasks) {
    const r = t?.reminder;
    const frequency = r?.repeat ?? (r?.daily ? "daily" : "none");
    if (
      !t ||
      typeof t.id !== "string" ||
      !t.id ||
      t.id.length > 100 ||
      ids.has(t.id) ||
      typeof t.title !== "string" ||
      !t.title.trim() ||
      t.title.length > 200 ||
      t.done !== false ||
      (t.kind !== undefined && !["task", "routine"].includes(t.kind)) ||
      (t.kind !== "routine" && t.routine !== undefined) ||
      typeof t.due !== "string" ||
      (t.due && !date(t.due)) ||
      !r ||
      typeof r.onDue !== "boolean" ||
      typeof r.daily !== "boolean" ||
      !["none", "daily", "weekly", "monthly"].includes(frequency) ||
      (r.repeat !== undefined && !["none", "daily", "weekly", "monthly"].includes(r.repeat)) ||
      (r.repeat !== undefined && r.daily !== (frequency === "daily")) ||
      (!r.onDue && frequency === "none") ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time) ||
      typeof r.timeZone !== "string" ||
      r.timeZone.length > 80 ||
      typeof r.start !== "string" ||
      (r.start && !date(r.start)) ||
      (r.onDue && !date(t.due)) ||
      (frequency !== "none" && !date(r.start))
    )
      throw Error("tasks");
    if (t.kind === "routine") validateRoutine(t, frequency);
    try {
      new Intl.DateTimeFormat("en", { timeZone: r.timeZone }).format();
    } catch {
      throw Error("tasks");
    }
    ids.add(t.id);
  }
  return tasks.map((t) => ({
    id: t.id,
    title: t.title,
    due: t.due,
    done: false,
    ...(t.kind === "routine" ? { kind: "routine", routine: {
      frequency: t.routine.frequency, weekdays: [...t.routine.weekdays],
      start: t.routine.start, timeZone: t.routine.timeZone,
      paused: t.routine.paused, checks: { ...t.routine.checks },
    } } : {}),
    reminder: {
      onDue: t.reminder.onDue,
      daily: t.reminder.daily,
      ...(t.reminder.repeat !== undefined ? { repeat: t.reminder.repeat } : {}),
      time: t.reminder.time,
      timeZone: t.reminder.timeZone,
      start: t.reminder.start,
    },
  }));
}
export async function deliverDue(db, send) {
  const jobs = await db.claim();
  let sent = 0,
    failed = 0;
  for (const job of jobs) {
    try {
      // Completion/deletion or a newer sync invalidates a claimed job.
      if (!(await db.current(job))) continue;
      const zh = job.language === "zh";
      const payload = {
        title: job.is_routine
          ? zh ? "Mydo · 日常提醒" : "Mydo · Routine reminder"
          : zh
          ? job.is_due
            ? "Mydo · 今日到期"
            : ({ weekly: "Mydo · 每週提醒", monthly: "Mydo · 每月提醒" }[job.frequency] || "Mydo · 每日提醒")
          : job.is_due
            ? "Mydo · Due today"
            : ({ weekly: "Mydo · Weekly reminder", monthly: "Mydo · Monthly reminder" }[job.frequency] || "Mydo · Daily reminder"),
        body: job.title,
        taskId: job.task_id,
        ...(job.is_routine ? { kind: "routine" } : {}),
        tag: `mydo-${job.device_id}-${job.task_id}`,
      };
      const response = await send(
        validateSubscription(job.subscription),
        payload,
      );
      if (response.ok) {
        await db.markSent(job);
        sent++;
      } else if (response.status === 404 || response.status === 410) {
        await db.disable(job.user_id, job.device_id);
        failed++;
      } else {
        failed++;
      } // claim lease delays retries, without marking delivery successful
    } catch {
      failed++;
    }
  }
  return { sent, failed };
}
export function createHandler({
  db,
  verifyUser,
  send,
  publicKey,
  cronSecret,
  origin,
}) {
  return async (request) => {
    const requestOrigin = request.headers.get("origin");
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Vary: "Origin",
    };
    if (requestOrigin === origin) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Access-Control-Allow-Headers"] =
        "authorization,apikey,content-type";
      headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS";
    }
    const reply = (body, status = 200) =>
      new Response(JSON.stringify(body), { status, headers });
    if (requestOrigin && requestOrigin !== origin)
      return reply({ error: "origin" }, 403);
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    if (request.method === "GET")
      return reply({ ready: !!publicKey, publicKey: publicKey || "" });
    if (request.method !== "POST") return reply({ error: "method" }, 405);
    try {
      // Limit untrusted bodies before parsing; Content-Length alone is untrusted.
      const reader = request.body?.getReader();
      let raw = "",
        size = 0;
      if (reader) {
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 1000000) {
            await reader.cancel();
            return reply({ error: "size" }, 413);
          }
          raw += decoder.decode(value, { stream: true });
        }
        raw += decoder.decode();
      }
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return reply({ error: "body" }, 400);
      }
      const token = (request.headers.get("authorization") || "").replace(
        /^Bearer /,
        "",
      );
      if (body.action === "dispatch") {
        if (!cronSecret || token !== cronSecret)
          return reply({ error: "auth" }, 401);
        return reply(await deliverDue(db, send));
      }
      const user = await verifyUser(token);
      if (!user?.id || !UUID.test(user.id))
        return reply({ error: "auth" }, 401);
      if (!UUID.test(body.deviceId || ""))
        return reply({ error: "device" }, 400);
      if (body.action === "sync") {
        let tasks, sub;
        try {
          tasks = validateTasks(body.tasks);
          sub = validateSubscription(body.subscription);
        } catch {
          return reply({ error: "validation" }, 400);
        }
        if (!["en", "zh"].includes(body.language))
          return reply({ error: "language" }, 400);
        await db.sync(user.id, body.deviceId, sub, body.language, tasks);
        return reply({ ok: true, count: tasks.length });
      }
      if (body.action === "disable") {
        await db.disable(user.id, body.deviceId);
        return reply({ ok: true });
      }
      if (body.action === "status") {
        const d = await db.device(user.id, body.deviceId);
        return reply({ enabled: !!d?.enabled, syncedAt: d?.synced_at || null });
      }
      if (body.action === "test") {
        const d = await db.device(user.id, body.deviceId);
        if (!d?.enabled) return reply({ error: "device" }, 404);
        if (!(await db.testSlot(user.id, body.deviceId)))
          return reply({ error: "rate" }, 429);
        const response = await send(validateSubscription(d.subscription), {
          title: "Mydo",
          body:
            d.language === "zh"
              ? "測試通知：手機提醒已接通。"
              : "Test notification: phone reminders are connected.",
          tag: "mydo-test",
        });
        if (!response.ok) {
          if ([404, 410].includes(response.status))
            await db.disable(user.id, body.deviceId);
          return reply({ error: "push", status: response.status }, 502);
        }
        return reply({ ok: true });
      }
      return reply({ error: "action" }, 400);
    } catch {
      return reply({ error: "service" }, 503);
    }
  };
}
