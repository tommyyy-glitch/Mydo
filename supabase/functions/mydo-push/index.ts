import { buildPushPayload } from "npm:@block65/webcrypto-web-push@2.0.0";
import { createHandler } from "./core.js";

const url = Deno.env.get("SUPABASE_URL")!;
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function rest(path: string, method = "GET", body?: unknown) {
  const res = await fetch(url + "/rest/v1/" + path, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw Error("database");
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
const eq = encodeURIComponent;
const filter = (user: string, device: string) =>
  `user_id=eq.${eq(user)}&${"id"}=eq.${eq(device)}`;
const claimFilter = (job: any) =>
  `user_id=eq.${eq(job.user_id)}&device_id=eq.${eq(job.device_id)}&task_id=eq.${eq(job.task_id)}&claim_id=eq.${eq(job.claim_id)}`;
const db = {
  sync: (
    user: string,
    device: string,
    subscription: unknown,
    language: string,
    tasks: unknown,
  ) =>
    rest("rpc/mydo_sync_reminders", "POST", {
      p_user: user,
      p_device: device,
      p_subscription: subscription,
      p_language: language,
      p_tasks: tasks,
    }),
  device: async (user: string, device: string) =>
    (
      await rest(
        "mydo_push_devices?" +
          filter(user, device) +
          "&select=subscription,language,enabled,synced_at",
      )
    )[0],
  disable: (user: string, device: string) =>
    rest("mydo_push_devices?" + filter(user, device), "PATCH", {
      enabled: false,
    }),
  testSlot: (user: string, device: string) =>
    rest("rpc/mydo_test_slot", "POST", { p_user: user, p_device: device }),
  claim: () => rest("rpc/mydo_claim_reminders", "POST", { p_limit: 10 }),
  current: async (job: any) => {
    const rows = await rest(
      "mydo_reminders?" + claimFilter(job) + "&select=task_id",
    );
    const devices = await rest(
      "mydo_push_devices?" +
        filter(job.user_id, job.device_id) +
        "&enabled=eq.true&select=id",
    );
    return rows.length > 0 && devices.length > 0;
  },
  markSent: (job: any) =>
    rest("mydo_reminders?" + claimFilter(job), "PATCH", {
      last_sent_on: job.local_date,
      claim_id: null,
      claim_until: null,
    }),
};
async function verifyUser(token: string) {
  if (!token) return null;
  const res = await fetch(url + "/auth/v1/user", {
    headers: { apikey: key, Authorization: `Bearer ${token}` },
  });
  return res.ok ? await res.json() : null;
}
async function send(subscription: any, data: unknown) {
  const { vapid } = await configuration();
  const init = await buildPushPayload(
    { data: JSON.stringify(data), options: { ttl: 300 } },
    subscription,
    vapid,
  );
  return fetch(subscription.endpoint, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
}
// Keys are generated server-side once, never entered into the browser or git.
let loaded: Promise<any> | undefined;
async function configuration() {
  if (!loaded)
    loaded = (async () => {
      let c = (await rest("mydo_push_config?select=*&id=eq.true"))[0];
      if (!c) throw Error("configuration");
      if (!c.vapid) {
        const keys = await crypto.subtle.generateKey(
          { name: "ECDSA", namedCurve: "P-256" },
          true,
          ["sign", "verify"],
        );
        const raw = new Uint8Array(
          await crypto.subtle.exportKey("raw", keys.publicKey),
        );
        const jwk = await crypto.subtle.exportKey("jwk", keys.privateKey);
        const publicKey = btoa(String.fromCharCode(...raw))
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");
        const vapid = {
          subject: "https://tommyyy-glitch.github.io/Mydo/",
          publicKey,
          privateKey: jwk.d,
        };
        await rest("mydo_push_config?id=eq.true&vapid=is.null", "PATCH", {
          vapid,
        });
        c = (await rest("mydo_push_config?select=*&id=eq.true"))[0];
      }
      return c;
    })().catch((e) => {
      loaded = undefined;
      throw e;
    });
  return loaded;
}
Deno.serve(async (request) => {
  try {
    const config = await configuration();
    return createHandler({
      db,
      verifyUser,
      send,
      publicKey: config.vapid.publicKey,
      cronSecret: config.cron_secret,
      origin: "https://tommyyy-glitch.github.io",
    })(request);
  } catch {
    return Response.json(
      { ready: false, error: "setup" },
      {
        status: 503,
        headers: {
          "Access-Control-Allow-Origin": "https://tommyyy-glitch.github.io",
          "Cache-Control": "no-store",
        },
      },
    );
  }
});
