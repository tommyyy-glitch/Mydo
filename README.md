# Mydo

A quieter place to decide what comes next. / 理清優先次序，踏實做好下一步。

Mydo is a personal task planner with English and Traditional Chinese interfaces, a soft charcoal theme, real deadlines, and prerequisite relationships. It runs entirely in your browser with no runtime libraries, account, or backend.

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

Tasks are saved in localStorage (`mydo.v1`) on this browser and site origin. They are **not synced between devices**, backed up to GitHub, or sent to a service. Clearing browser data can remove tasks. Export JSON backups regularly; Import validates a file and asks before replacing the entire list. A corrupted stored list is preserved for export rather than silently overwritten. The app supports up to 2,000 tasks, but the path diagram is intended for smaller personal projects.

After the first successful online load, a scoped service worker caches the app shell for offline opening. On iPhone, open the hosted site in Safari, tap Share → Add to Home Screen, then launch Mydo from its icon. Export a backup before moving between Safari and the installed app in case their storage contexts differ. Close all Mydo windows to activate an available application update. Browser/OS storage eviction can remove offline data. There are no background deadline notifications. Browser storage is not encrypted. Do not store secrets in task notes.

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
