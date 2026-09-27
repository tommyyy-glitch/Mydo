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
