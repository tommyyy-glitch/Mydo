# Verification — 2026-09-27

## Passed locally

- Eight Node tests cover dependency ordering, all-prerequisite completion, direct/indirect cycle prevention, missing links, propagation of real deadline pressure, the three-day urgency boundary, protected deletion, backup validation and sample data.
- JavaScript syntax checks for the UI, model, service worker and local server.
- Isolated Chrome end-to-end flow: add/edit tasks, reject a dependency loop, block premature completion, unlock a dependent task, guard reopening, reload persisted data, export/import JSON, reject malformed backup without replacing tasks, escape HTML task names, switch/persist Traditional Chinese, and preserve corrupt stored data.
- Responsive overflow checks at 375, 390, 768 and 1024 CSS pixels; desktop visual review at 1440 pixels. English desktop focus, matrix and relationship views and Chinese mobile form/list screenshots inspected.
- Service worker activation, offline reload and task creation with networking disabled.

## Boundaries

- Tests run in desktop Chromium, including small viewport sizes. No physical iPhone 17, iOS standalone installation, Safari/WebKit runtime, VoiceOver or on-screen keyboard test has been performed. iPhone support is implemented, not device-certified.
- Local storage only. No cloud sync, push reminder service, shared project permissions or calendar integration.
- The task diagram supports horizontal scrolling. It is intended for personal project graphs, not large interactive canvases.
- No runtime package dependencies. That is a small dependency surface, not a claim that the application is vulnerability-free.

The reproducible model and browser tests are in `tests/`. Browser artifacts belong in ignored local QA folders, not the public repository.

## Progress and reminder frequency — 2026-10-02

- Added four progress stages in English and Traditional Chinese, visible on task cards, editable in task details, and shown in dependency paths. `done` remains the legacy compatibility flag. Completion keeps prerequisite/reopen guards and cancels reminders only after successful sync.
- Added No repeat / Daily / Weekly / Monthly independently from due-date reminders. Weekly anchors to the start weekday; monthly clamps short months without losing the original anchor. Calendar eligibility uses the saved local time zone.
- Fresh JavaScript checks and all 52 Node tests passed, including calendar boundaries, leap years, DST, weekly/monthly payload validation, completion, and atomic progress cloud merges.
- The Supabase migration plus rollback-only database fixture passed through the signed-in SQL Editor: calendar recurrence, cloud projection, claimed jobs, legacy field preservation, local-date deduplication, completion cancellation, and private helper access. The test transaction rolled back; no QA tasks or pushes were committed.
- Before migration, the live account had 8 tasks, 1 linked enabled phone, and 7 reminder records. This release preserves user task lists, reminder dates/times, existing subscriptions and last-sent dates.
- Production migration applied through Supabase SQL Editor on 2026-10-02; the result still has 8 tasks, 1 linked enabled phone, and 7 reminders, with the new frequency column present. The existing `mydo-push` function was updated in place (`core.js` only); the dashboard confirmed deployment and its public readiness endpoint returned `ready: true`.
- Fresh browser UI checks saved Ongoing with Weekly, changed to Almost complete with Monthly, reloaded to confirm persistence, completed to remove the reminder caption, and reopened to Preparing with the saved schedule restored. English and Traditional Chinese were checked. The 393 × 852 mobile form was visually inspected, with no browser warnings/errors. The isolated local test task was deleted; no production QA tasks were created.
- Fresh JavaScript checks and all 52 tests passed again before publication. GitHub Check Mydo and Pages deployment succeeded for `9a106e8`; the live app, model, reminders, cloud sync, stylesheet and service worker matched the tested local files byte for byte.
- The minute reminder cron remained active, with a successful recent run and HTTP 200 / zero failed deliveries in the latest stored response after the Edge Function update.
- After the user unlocked iPhone Mirroring, the installed Mydo app was cold relaunched. The physical iPhone displayed all four progress stages; tapping Ongoing selected it. The frequency menu displayed No repeat / Daily / Weekly / Monthly, and Monthly could be selected. This used an empty unsaved draft, which was closed without creating a test mission. The app was left on its task list, showing 8 total tasks, 7 open tasks, cloud sync complete and phone reminders synced.
- New weekly/monthly lock-screen delivery has not been observed. Do not treat the database fixture, readiness endpoint or phone UI acceptance as physical lock-screen delivery proof.

## Continuous routines — 2026-10-03

- Fresh syntax checks and all 80 Node tests passed. Routine coverage includes per-date completion/undo, next-day reopening, selected weekdays, original monthly anchors, DST/time zones, pause, validated backup import, exclusion from ordinary task ranking/prerequisites, per-date cloud merges and concurrent edits, push payloads, and notification routing.
- Browser UI at 393 × 852 saved a daily routine, recorded today, reloaded to verify persistence, selected three weekly days, rejected an empty weekly selection, paused/resumed without losing the record, undid today's check, and saved a monthly 31st anchor. The normal task editor excluded the routine from prerequisites. English/Traditional Chinese and the separate Task history entry were checked; the final preview had no warning/error logs.
- One disposable routine was created only in the local preview, with notifications off, then deleted through the UI. No real routines or medication instructions were invented, and no production QA reminders were created.
- Read-only production checks found 8 saved items, 6 reminder rows and 1 enabled device. RLS was enabled on all three existing Mydo tables. The new database migration, rollback-only fixture, and Edge Function change are prepared; their execution/deployment and installed-phone acceptance are pending.
- Physical lock-screen delivery for routine notifications has not been observed.
