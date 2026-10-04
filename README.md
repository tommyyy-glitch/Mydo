# Mydo

A quieter place to decide what comes next. / 理清優先次序，踏實做好下一步。

Mydo is a personal task and routine planner with English and Traditional Chinese interfaces, a soft charcoal theme, real deadlines, and prerequisite relationships. It runs locally in your browser without runtime libraries. Optional cloud sync and phone notifications use the same existing Myfin cloud account, with Mydo data kept separate from Myfin.

## Use

Open the hosted GitHub Pages site, or run locally with Node.js 20+:

```sh
npm start
# Open http://127.0.0.1:4175
```

No npm installation or build step is needed. Serve the files over HTTP; opening index.html directly as a file does not support JavaScript modules reliably.

- **Next up:** open, actionable tasks sorted by deadlines and priority. Blocked tasks remain in a separate section.
- **Priority matrix:** Must / Want × Urgent / Not urgent.
- **Task paths:** left-to-right prerequisite diagram. Click a node to inspect, edit, complete, or reopen it.
- **Routines / 日常:** the fourth main page, replacing All tasks. Store ongoing daily care, supplements, gym days, or other recurring activities; each check records that day's occurrence.
- **Task history / 待辦記錄:** the secondary button on the task pages opens all ordinary tasks, including completed items, with search and group filters (`#tasks`). Existing `#all` links open Routines.
- **New task:** enter a title, choose Must or Want, set urgency, optionally add a real date and prerequisites. Press **N** to open the editor outside a form.
- **New routine:** from Routines, enter a name, choose daily, selected weekdays, or monthly, and optionally enable notifications. **N** opens the routine editor on this page.
- **EN / 繁中:** switches the interface; your task text stays as you wrote it.
- **Explore an example first:** an explicitly temporary sample list. Changes to examples are not saved.

## Task logic

Must means an obligation; Want means something personally desired. Neither determines urgency by itself. A task is urgent if you mark it urgent, or its own / an unfinished downstream task's deadline is within three calendar days (overdue included). The original urgency choice is preserved. When deadline pressure disappears, the computed classification updates.

A real deadline is an optional date, due by the end of that day in the device's local time. Dates do not move automatically. A downstream date influences prerequisite priority and is clearly labelled as a downstream deadline, never written into the prerequisite's deadline field.

All prerequisites must be complete before a task can be completed. Cycles, missing links and invalid backups are rejected. Reopening a prerequisite is blocked while any completed downstream task relies on it. Deleting a linked prerequisite requires removing the links first. There are no silent cascading deletes or state changes.

Next-up ordering: overdue linked deadline, deadline within three days, urgency, Must, unblocking an unfinished Must task, then proximity of the effective deadline. Creation order breaks ties. This is a transparent heuristic, not a schedule or a claim that all deadlines are feasible. Duration estimates, buffers and calendar capacity are not modelled.

## Routines

Routines are ongoing activities, rather than tasks that finish permanently. They share the task list's storage, backups and optional cloud account, but have their own page, schedule and completion records. They do not appear in Next up, the priority matrix, task paths or Task history, and cannot be prerequisites for ordinary tasks.

Choose **Every day / 每天**, **Selected weekdays / 每週指定日子** (one or more days), or **Every month / 每月**. No occurrence is scheduled before the start date; weekly also requires a matching selected weekday. Monthly follows the original start day: January 31 uses February's last day, then returns to March 31. The saved time zone determines which day is today, even when the device or server is in a different time zone.

**Mark done today / 標記今天已做** records only today's scheduled occurrence. The same routine returns unfinished on the next scheduled day. Tap the check again to undo today's record. Open the routine to see recent completed dates; changing its schedule keeps its history. **Pause this routine / 暫停這項日常** stops notifications and moves it into Paused while keeping the schedule and records. Resume it by clearing Pause. Deleting the routine also deletes its records. No example medication or exercise routine is added to your personal list automatically.

## Task icons and pictures

Open task details to choose one of 16 optional icons and/or upload a related picture. Both appear on task cards, the priority matrix and dependency paths. Changing or removing a picture does not change progress, priority, prerequisites or reminder settings.

Pictures are resized on the device to at most 512 pixels and compressed to a JPEG of at most 60 KB, without the original file metadata. Input files may be up to 20 MB; HEIC/HEIF works only when the browser can decode it. Pictures are included in JSON backups and existing cloud task sync, so they are stored in your signed-in cloud account when sync is enabled. No external image URLs or separate upload service are used. Photo-containing lists have a conservative 900 KB cloud payload limit; a clear error keeps the saved copies intact if a merge would exceed it. Remove unused pictures and sync again to recover.

## Your data

Tasks and routines are saved in localStorage (`mydo.v1`) on this browser and site origin. They sync between devices only when **Cloud task sync** is enabled; GitHub stores application source, not your personal list. Cloud sync saves the full list in your signed-in account, including notes, groups, relationships, reminder schedules and routine records. Without cloud task sync, enabling phone notifications sends only reminder item IDs, titles, dates/settings, routine schedule/check/pause data, language and the device push subscription; notes and task relationships stay local. Clearing browser data can remove the local copy. Export JSON backups regularly; Import validates a file and asks before replacing the entire list. A corrupted stored list is preserved for export rather than silently overwritten. The app supports up to 2,000 items, but the path diagram is intended for smaller personal projects.

After the first successful online load, a scoped service worker caches the app shell for offline opening. On iPhone, open the hosted site in Safari, tap Share → Add to Home Screen, then launch Mydo from its icon. Export a backup before moving between Safari and the installed app in case their storage contexts differ. Close all Mydo windows to activate an available application update. Browser/OS storage eviction can remove offline data. Phone reminders can arrive while Mydo is closed once enabled from the installed Home Screen app. Browser storage is not encrypted. Do not store secrets in task notes.

## Development and verification

```sh
npm run check
npm test
```

`tests/ui.mjs` is an optional Playwright end-to-end test. With Playwright available, start the app in a separate terminal and run `node tests/ui.mjs`. Set `PLAYWRIGHT_MODULE` to a preinstalled Playwright entrypoint or `CHROME_PATH` to an existing Chromium browser if needed; `MYDO_URL` and `QA_OUTPUT` override the URL and artifact folder. The tests use an isolated temporary browser profile.

The UI suite covers dependency cycles, blocked completion, unlocking, reopen guards, persistence, JSON round trips, invalid input, HTML escaping, language persistence, mobile overflow, and corrupt-storage recovery. It saves desktop/mobile screenshots for visual review.

Files: `model.js` is the dependency and prioritization logic; `routines.js` provides routine calendar validation and per-date checks; `routine-ui.js` provides the routine page/editor; `app.js` is the bilingual UI and storage; `styles.css` is the responsive night theme; `sw.js` and `manifest.webmanifest` provide the installable offline shell. Increment the service worker cache version whenever app shell files change. `docs/research.md` records the skill / GitHub research and why this implementation stays small.

## Hosting

GitHub Pages can serve the repository root directly from `main`. All assets and navigation use relative URLs / hashes, so the `/Mydo/` project path works without rewriting routes. CI runs the model and syntax checks. GitHub stores the application source only.

## Phone reminders

1. Open Mydo from its iPhone Home Screen icon.
2. Open **Phone reminders / 手機通知**, sign in with your existing **Myfin cloud account** (not your Supabase dashboard/GitHub login), and tap **Enable this phone** → Allow.
3. Send a test notification and verify it appears on your iPhone.
4. In a task, select **Remind me on the due date** and/or **Repeat until completed** → Daily, Weekly or Monthly. Choose the local time, timezone and repeating start date, then save.
5. In a routine, select **Notify on scheduled days / 在排定日子通知我** and choose the notification time and time zone. It uses the routine's schedule, including all selected weekly days.

Due-day reminders are sent on that calendar date after the selected time. Repeating reminders start on the chosen date and continue after a deadline until completion. Weekly uses the start weekday; monthly uses the original day, or the last day of a shorter month. Both modes combine on the due date. The scheduler checks every minute; this is best-effort delivery, not an exact alarm. Focus mode, network availability, permissions, service outages and OS behavior can delay or suppress notifications. Past days are not replayed.

Task progress is **Preparing / 準備中 → Ongoing / 進行中 → Almost complete / 接近完成 → Complete / 已完成**. Choose it in task details; the current stage appears on cards and task paths. The first three stages keep reminders active. Only Complete stops reminders after sync and unlocks dependent tasks. Progress stays independent from Must/Want, urgency and deadlines. Old open tasks display Preparing, and old completed tasks display Complete.

Ordinary task completion, deletion and disabled reminders are removed from the server after successful sync. Routine checks skip notifications for that date, while the next scheduled date still reminds you; paused routines stop delivery and retain their scheduler state. **Offline checks, undo, pause or other changes affect server reminders only after reconnecting and syncing.** A notification already in flight may still arrive. Pending sync is shown in the app. Use **Stop this phone's reminders** to disable the device remotely. Storage remains local unless you enable cloud task sync. The notification-only copy is not a full backup.

The service accepts up to 100 active reminder tasks per device. Each device has its own subscription and reminder copy. Signing out of notifications stops that device's reminders. Push subscription expiration requires reconnecting notifications from that device. Losing browser data can lose the local device identity; remove stale subscriptions administratively if needed.

See [notification deployment](docs/notifications.md) for server setup and verification.

## Cloud task sync

Open **Cloud tasks / 雲端任務**, sign in with the same Myfin cloud account, then select **Enable cloud task sync**. Existing local tasks and routines are backed up and merged with the same cloud list; routines need no separate account. Devices using the same account receive changes on opening or returning to Mydo, or with **Sync tasks now**. Offline edits remain saved locally until reconnecting. Cloud-linked phone reminders also update when a task is added or completed, or a routine is checked, paused or edited elsewhere. Routine checks merge by date, preserving explicit undo records; contradictory edits require conflict resolution. See [cloud sync](docs/cloud-sync.md) for conflict handling, deployment and verification.
