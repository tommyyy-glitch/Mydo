import { reminderTasks } from "./reminders.js";
const URL = "https://wmjbbuplqvxjcqevggux.supabase.co";
const PUBLIC_KEY = "sb_publishable__1vlXA5hx8JwQqBH__sOEg_OGzDLFlH";
const AUTH = "mydo.push.auth",
  DEVICE = "mydo.push.device",
  STATE = "mydo.push.state";
export class PhoneReminders {
  constructor({ getTasks, getLanguage, onChange }) {
    this.getTasks = getTasks;
    this.getLanguage = getLanguage;
    this.onChange = onChange;
    this.session = null;
    this.enabled = false;
    this.dirty = false;
    this.message = "off";
    this.ready = false;
    this.queue = Promise.resolve();
    try {
      this.session = JSON.parse(localStorage.getItem(AUTH) || "null");
      this.deviceId = localStorage.getItem(DEVICE) || crypto.randomUUID();
      localStorage.setItem(DEVICE, this.deviceId);
      const state = JSON.parse(localStorage.getItem(STATE) || "{}");
      this.enabled = !!state.enabled;
      this.dirty = !!state.dirty;
      this.syncedAt = state.syncedAt || null;
      this.message = this.enabled
        ? this.dirty
          ? "pending"
          : "checking"
        : "off";
    } catch {
      this.message = "storage";
    }
    window.addEventListener("online", () => this.sync());
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && this.enabled) this.sync();
    });
  }
  change(message) {
    this.message = message;
    try {
      localStorage.setItem(
        STATE,
        JSON.stringify({
          enabled: this.enabled,
          dirty: this.dirty,
          syncedAt: this.syncedAt,
        }),
      );
    } catch {
      this.message = "storage";
    }
    this.onChange?.();
  }
  async config() {
    const res = await fetch(URL + "/functions/v1/mydo-push", {
      headers: { apikey: PUBLIC_KEY },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw Error("service");
    const data = await res.json();
    this.ready = !!data.ready;
    this.publicKey = data.publicKey;
    return data;
  }
  async auth(path, body) {
    const res = await fetch(URL + "/auth/v1/" + path, {
      method: "POST",
      headers: { apikey: PUBLIC_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw Error("login");
    const session = await res.json();
    localStorage.setItem(AUTH, JSON.stringify(session));
    this.session = session;
    return session;
  }
  async login(email, password) {
    if (this.enabled) throw Error("stopFirst");
    await this.auth("token?grant_type=password", { email, password });
    this.change("off");
  }
  async token() {
    if (!this.session) throw Error("login");
    if (
      !this.session.expires_at ||
      this.session.expires_at * 1000 < Date.now() + 60000
    )
      {
        // Cloud and notification sync can request a token at the same time.
        if (!this.refreshing)
          this.refreshing = this.auth("token?grant_type=refresh_token", {
            refresh_token: this.session.refresh_token,
          }).finally(() => { this.refreshing = null; });
        await this.refreshing;
      }
    return this.session.access_token;
  }
  async rpc(name, body) {
    const token = await this.token();
    const res = await fetch(URL + "/rest/v1/rpc/" + name, {
      method: "POST",
      headers: { apikey: PUBLIC_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
    });
    if (res.status === 401) throw Error("login");
    if (!res.ok) throw Error("service");
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  async call(action, extra = {}) {
    const token = await this.token();
    const res = await fetch(URL + "/functions/v1/mydo-push", {
      method: "POST",
      headers: {
        apikey: PUBLIC_KEY,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action, deviceId: this.deviceId, ...extra }),
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 401) throw Error("login");
    if (res.status === 429) throw Error("rate");
    if (!res.ok) throw Error("service");
    return res.json();
  }
  async enable() {
    if (!this.session) throw Error("login");
    if (
      !("Notification" in window) ||
      !("PushManager" in window) ||
      !("serviceWorker" in navigator)
    )
      throw Error("unsupported");
    if (!this.ready) throw Error("service");
    // Invoked from the user's own tap; iOS requires user activation here.
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw Error("permission");
    const registration = await navigator.serviceWorker.ready;
    const key = Uint8Array.from(
      atob(this.publicKey.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0),
    );
    const sub =
      (await registration.pushManager.getSubscription()) ||
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      }));
    await this.call("sync", {
      subscription: sub.toJSON(),
      language: this.getLanguage(),
      tasks: reminderTasks(this.getTasks()),
    });
    this.enabled = true;
    this.dirty = false;
    this.syncedAt = new Date().toISOString();
    this.change("synced");
  }
  sync() {
    if (!this.enabled) return Promise.resolve();
    this.dirty = true;
    this.change("pending");
    this.queue = this.queue
      .catch(() => {})
      .then(async () => {
        if (!this.enabled) return;
        try {
          const snapshot = JSON.stringify(reminderTasks(this.getTasks()));
          if (!navigator.onLine) throw Error("offline");
          const registration = await navigator.serviceWorker.ready;
          const sub = await registration.pushManager.getSubscription();
          if (!sub || Notification.permission !== "granted")
            throw Error("permission");
          await this.call("sync", {
            subscription: sub.toJSON(),
            language: this.getLanguage(),
            tasks: JSON.parse(snapshot),
          });
          this.dirty =
            snapshot !== JSON.stringify(reminderTasks(this.getTasks()));
          this.syncedAt = new Date().toISOString();
          this.change(this.dirty ? "pending" : "synced");
        } catch (e) {
          this.change(
            e.message === "login"
              ? "login"
              : e.message === "permission"
                ? "permission"
                : "pending",
          );
        }
      });
    return this.queue;
  }
  async disable() {
    // Wait for earlier syncs so they cannot re-enable the server after stopping.
    await this.queue;
    await this.call("disable");
    this.enabled = false;
    this.dirty = false;
    this.change("off");
    const registration = await navigator.serviceWorker.ready;
    const sub = await registration.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  }
  async logout() {
    if (this.enabled) await this.disable();
    localStorage.removeItem(AUTH);
    this.session = null;
    this.change("off");
  }
  async test() {
    await this.queue;
    return this.call("test");
  }
}
