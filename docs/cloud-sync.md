# Cloud tasks

Enable **Cloud tasks / 雲端任務 → Enable cloud task sync / 啟用雲端任務同步** after signing into the same account used for phone reminders. Task titles, notes, groups, deadlines, prerequisite links, completion and reminder settings are stored in the user's isolated Supabase list. GitHub contains application source only. Cloud sync does not require this browser to enable notifications.

The first enable stores the original device list under `mydo.cloud.backup.<owner>` before merging. Export it from the cloud panel. Existing task IDs are preserved. Independently created tasks from each device are combined. A three-way merge distinguishes deletion from absence on a new device. Independent field edits combine; contradictory edits pause with both copies preserved. Export before resolving conflicts. Graph validation prevents merged cycles, missing prerequisites or invalid completion.

`mydo_cloud_lists` uses a revision and compare-and-swap write. Remote changes are fetched before every write, with bounded retries if another device writes first. Offline edits remain local. The app checks on opening/visibility, reconnection, and every 30 seconds while visible with no modal. A local editor is never replaced while its draft is open. Sync is not a real-time/background UI guarantee: open the app or press Sync tasks now to refresh it.

Apply `supabase/migrations/202610010001_mydo_cloud.sql` once. Task APIs derive ownership from `auth.uid()` and expose no user-id selector. The table and admin task-create function are inaccessible to anonymous and ordinary authenticated clients. The normal RPCs require authentication. Server validation checks task shape, size, dates/time zones, dependencies and up to 100 active reminders. No service-role credential is stored in git, browser storage or the chat.

Linked cloud phones take reminder projections from the canonical cloud list. A cloud write refreshes all linked, enabled devices, so an added task can be reminded even before its phone next opens. Old phone snapshots cannot erase cloud reminders. Completing/deleting cloud tasks removes their reminder projections. Existing notification-only devices keep their prior flow until cloud sync is enabled there.

For future tasks requested in this chat: use the signed-in Supabase SQL editor and server-only `mydo_admin_add_task(p_user,p_task)`. Verify the intended user's Mydo device/list; never choose a different user's row or export subscription/signing credentials. Preserve the task UUID for idempotent retry. Validate the full task with `model.js`. Confirm the returned revision and then the phone's synced list. Task creation is possible without retaining an admin secret, but it depends on the available signed-in dashboard or user-authenticated Mydo browser session.

## Verification — 2026-10-01

- Node regression tests cover initial merge, deletion/completion, independent edits, conflicts, invalid dependencies, backups, offline retry, concurrent CAS and edits during in-flight requests, deterministic ordering and account mismatch.
- Live Supabase transaction tests cover stale revision rejection, account/anonymous isolation, permission boundaries, dependency rejection, cloud-to-phone projection, old-phone sync preserving that projection, and completion removing it. QA data/schema changes were rolled back before the separate production migration.
- Actual phone enable/merge still requires the user's unlocked iPhone Mirroring session or their activation in the app.

The service worker activates only after downloading the complete updated shell and revalidating the browser cache. Other open Mydo tabs no longer block installation. An already open page keeps its draft; reopening Mydo loads the new version. Local task storage is not cleared during updates.

## Reminder diagnosis — 2026-10-01

The live minutely scheduler was active, with recent HTTP 200 dispatch responses. The Apple device was enabled and recently synchronized. Two tasks had today's `last_sent_on`; this records provider acceptance, not proof of visible lock-screen receipt. Two other daily reminders were configured to start on October 2 and October 10, so no earlier dispatch was due. Existing user start dates are preserved. New daily settings now default to today even when an existing task has a future deadline, and cards display the saved start date/time/time zone.
