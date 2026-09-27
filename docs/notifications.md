# Mydo phone notifications

Production frontend: https://tommyyy-glitch.github.io/Mydo/

Uses the existing Myfin Supabase project, with isolated `mydo_*` objects. Myfin tables and Auth configuration are unchanged. The frontend public publishable key is safe to distribute. No service-role key, private VAPID key or scheduler secret belongs in git or the browser.

## Deployment

Apply `supabase/migrations/202609270001_mydo_reminders.sql` once, then deploy `supabase/functions/mydo-push/index.ts` and `core.js` as `mydo-push`. Configure `verify_jwt=false`: every user action is independently verified against Supabase Auth and scoped to the returned user ID; scheduler dispatch requires a separate random secret. GET exposes only readiness and the VAPID public key.

Apply `202609270002_mydo_schedule.sql` once to install the named minutely pg_cron + pg_net job. Do not recreate signing configuration after devices subscribe. `mydo_push_config` generates its cron secret in Postgres. The function generates VAPID keys server-side once, atomically persists them, and reuses the canonical pair. RLS and grants prevent anonymous/authenticated clients from reading all three tables. Service-role credentials remain inside the edge runtime.

The server-only configuration table contains private signing material. Treat database backups/admin exports as secret. Do not export that row to clients or logs. Signing-key rotation requires device resubscription.

The pinned MIT dependency `@block65/webcrypto-web-push@2.0.0` uses WebCrypto and aes128gcm encryption compatible with Apple Web Push. Source: https://github.com/block65/webcrypto-web-push . Browser frontend has no runtime library dependency.

Claims are leased for five minutes and skipped by concurrent dispatches. Unchanged syncs retain an active claim. Success is recorded by local calendar date, preventing ordinary duplicate due/daily sends. A network failure after provider acceptance but before acknowledgement can cause retries; this is not exactly-once delivery. Expired endpoints (404/410) disable the device. Each batch handles up to ten reminders. Per-device test notification cooldown: one minute.

## Verification — 2026-09-27

- Syntax checks and model/reminder/request-validation tests passed.
- Live GET configuration: HTTP 200, ready true, stable public key; invalid dispatch: 401; foreign Origin: 403.
- Deployed function source downloaded and compared with local source: formatting/comments and equivalent string concatenation only.
- Supabase SQL transactional tests: due reminder claim, unchanged sync keeps lease, no concurrent second claim, no same-day re-send, test cooldown, completed-reminder removal. Test records rolled back.
- Cron delivered successive requests with HTTP 200 and `{"sent":0,"failed":0}` before any phone subscription existed.
- Pinned Web Push package generated an encrypted payload and VAPID authorization against a synthetic Apple endpoint; no push was sent by that local encryption test.
- Browser QA: missing deadline rejected for due mode; due + daily saved; settings persisted after reload; task completed; layout inspected at 393×852. Existing top safe-area styling retained.
- Actual lock-screen delivery requires the user's iPhone subscription, notification permission and a received test notification. That hardware check remains pending.

## Operational limits

The app is local-first, with no complete task backup/sync. Only enabled reminder tasks are copied to the server. Offline completion cannot retract reminders until successful sync. A notification already in flight may still arrive. A due-day reminder is not replayed the following day; daily reminders continue until completion. Supabase project availability/quotas, browser subscription lifetime, network access and iOS Focus/notification settings affect delivery. The feature is a reminder, not a safety-critical alarm.

## Password recovery

`reset.html` provides the shared-account password recovery flow. It sends a Supabase recovery email to a fixed `https://tommyyy-glitch.github.io/Mydo/reset.html` callback. Add that exact URL to Auth redirect URLs while preserving the Myfin Site URL and existing entries. The callback removes the URL fragment immediately, verifies the recovery session, and keeps its access token only in page memory. New passwords are sent directly to Supabase over HTTPS and never written to localStorage or logs. This page intentionally is not in the offline cache and does not load analytics or third-party scripts.

The user must open their email and enter/submit the new password themselves. Resetting this shared login also changes the password used to sign into Myfin; it does not change the separate ledger encryption passphrase. Five additional unit tests cover recovery token gating, password validation, fixed callback routing, authenticated updates, and safe error messages. Browser QA verified the initial and expired-link flows. Actual password mutation is a user handoff.
