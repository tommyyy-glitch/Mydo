# Mydo

A quieter place to decide what comes next. / 理清優先次序，踏實做好下一步。

Mydo is a personal task planner with English and Traditional Chinese interfaces, a soft charcoal theme, real deadlines, and prerequisite relationships. The task planner runs locally in your browser without runtime libraries. Optional phone notifications use your existing Supabase cloud account and a separate reminder service.

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
- **All tasks:** open and completed items, search, and space filters.
- **New task:** enter a title, choose Must or Want, set urgency, optionally add a real date and prerequisites. Press **N** to open the editor outside a form.
- **EN / 繁中:** switches the interface; your task text stays as you wrote it.
- **Explore an example first:** an explicitly temporary sample list. Changes to examples are not saved.

## Task logic

Must means an obligation; Want means something personally desired. Neither determines urgency by itself. A task is urgent if you mark it urgent, or its own / an unfinished downstream task's deadline is within three calendar days (overdue included). The original urgency choice is preserved. When deadline pressure disappears, the computed classification updates.

A real deadline is an optional date, due by the end of that day in the device's local time. Dates do not move automatically. A downstream date influences prerequisite priority and is clearly labelled as a downstream deadline, never written into the prerequisite's deadline field.

All prerequisites must be complete before a task can be completed. Cycles, missing links and invalid backups are rejected. Reopening a prerequisite is blocked while any completed downstream task relies on it. Deleting a linked prerequisite requires removing the links first. There are no silent cascading deletes or state changes.

Next-up ordering: overdue linked deadline, deadline within three days, urgency, Must, unblocking an unfinished Must task, then proximity of the effective deadline. Creation order breaks ties. This is a transparent heuristic, not a schedule or a claim that all deadlines are feasible. Duration estimates, buffers and calendar capacity are not modelled.

## Your data

Tasks are saved in localStorage (`mydo.v1`) on this browser and site origin. They are **not synced between devices** or backed up to GitHub. When phone reminders are enabled, only open reminder tasks (title, date, reminder settings and task ID), language and the device push subscription are sent to Supabase; notes and task relationships stay local. Clearing browser data can remove tasks. Export JSON backups regularly; Import validates a file and asks before replacing the entire list. A corrupted stored list is preserved for export rather than silently overwritten. The app supports up to 2,000 tasks, but the path diagram is intended for smaller personal projects.

After the first successful online load, a scoped service worker caches the app shell for offline opening. On iPhone, open the hosted site in Safari, tap Share → Add to Home Screen, then launch Mydo from its icon. Export a backup before moving between Safari and the installed app in case their storage contexts differ. Close all Mydo windows to activate an available application update. Browser/OS storage eviction can remove offline data. Phone reminders can arrive while Mydo is closed once enabled from the installed Home Screen app. Browser storage is not encrypted. Do not store secrets in task notes.

## Development and verification

```sh
npm run check
npm test
```

`tests/ui.mjs` is an optional Playwright end-to-end test. With Playwright available, start the app in a separate terminal and run `node tests/ui.mjs`. Set `PLAYWRIGHT_MODULE` to a preinstalled Playwright entrypoint or `CHROME_PATH` to an existing Chromium browser if needed; `MYDO_URL` and `QA_OUTPUT` override the URL and artifact folder. The tests use an isolated temporary browser profile.

The UI suite covers dependency cycles, blocked completion, unlocking, reopen guards, persistence, JSON round trips, invalid input, HTML escaping, language persistence, mobile overflow, and corrupt-storage recovery. It saves desktop/mobile screenshots for visual review.

Files: `model.js` is the dependency and prioritization logic; `app.js` is the bilingual UI and storage; `styles.css` is the responsive night theme; `sw.js` and `manifest.webmanifest` provide the installable offline shell. Increment the service worker cache version whenever app shell files change. `docs/research.md` records the skill / GitHub research and why this implementation stays small.

## Hosting

GitHub Pages can serve the repository root directly from `main`. All assets and navigation use relative URLs / hashes, so the `/Mydo/` project path works without rewriting routes. CI runs the model and syntax checks. GitHub stores the application source only.

## Phone reminders

1. Open Mydo from its iPhone Home Screen icon.
2. Open **Phone reminders / 手機通知**, sign in with your existing **Myfin cloud account** (not your Supabase dashboard/GitHub login), and tap **Enable this phone** → Allow.
3. Send a test notification and verify it appears on your iPhone.
4. In a task, select **Remind me on the due date** and/or **Every day until completed**. Choose the local time, timezone and daily start date, then save.

Due-day reminders are sent on that calendar date after the selected time. Daily reminders start on the chosen date and continue after a deadline until completion. Both modes combine on the due date. The scheduler checks every minute; this is best-effort delivery, not an exact alarm. Focus mode, network availability, permissions, service outages and OS behavior can delay or suppress notifications. Past days are not replayed.

Completion, deletion and disabled task reminders are removed from the server after successful sync. **Offline changes cannot cancel already scheduled server reminders until reconnecting and syncing.** Pending sync is shown in the app. Use **Stop this phone's reminders** to disable the device remotely. Task storage remains local unless you enable cloud task sync. The notification-only copy is not a full backup.

The service accepts up to 100 active reminder tasks per device. Each device has its own subscription and reminder copy. Signing out of notifications stops that device's reminders. Push subscription expiration requires reconnecting notifications from that device. Losing browser data can lose the local device identity; remove stale subscriptions administratively if needed.

See [notification deployment](docs/notifications.md) for server setup and verification.

## Cloud task sync

Open **Cloud tasks / 雲端任務**, sign in with the same Myfin cloud account, then select **Enable cloud task sync**. Existing local tasks are backed up and merged with the cloud list. Devices using the same account receive cloud tasks on opening or returning to Mydo, or with **Sync tasks now**. Offline edits remain saved locally until reconnecting. Cloud-linked phone reminders also update when a task is added or completed elsewhere. See [cloud sync](docs/cloud-sync.md) for conflict handling, deployment and verification.
