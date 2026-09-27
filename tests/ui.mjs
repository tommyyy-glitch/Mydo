import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || undefined,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
  acceptDownloads: true,
});
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const out = process.env.QA_OUTPUT || "test-results";
await mkdir(out, { recursive: true });
try {
  await page.goto(process.env.MYDO_URL || "http://127.0.0.1:4175");
  await page.getByRole("button", { name: "Explore an example first" }).click();
  await page.screenshot({ path: out + "/desktop-focus.png", fullPage: true });
  await page.locator(".view-tabs [data-view=matrix]").click();
  assert.equal(await page.locator(".quadrant").count(), 4);
  await page.screenshot({ path: out + "/desktop-matrix.png", fullPage: true });
  await page.locator(".view-tabs [data-view=paths]").click();
  assert.equal(await page.locator(".graph-node").count(), 8);
  await page.screenshot({ path: out + "/desktop-paths.png", fullPage: true });
  await page.getByRole("button", { name: "Back to my tasks" }).click();
  assert.equal(await page.locator(".graph-node").count(), 0);
  async function create(title, deps = [], due = "") {
    await page.locator(".add-main").click();
    await page.locator("[name=title]").fill(title);
    await page.locator("[name=project]").fill("Acceptance");
    if (due) await page.locator("[name=due]").fill(due);
    for (const name of deps)
      await page
        .locator(".dep-picker label")
        .filter({ hasText: name })
        .locator("input")
        .check();
    await page.getByRole("button", { name: "Save task", exact: true }).click();
    assert.equal(
      await page.locator("#editor").evaluate((el) => el.open),
      false,
    );
  }
  await create("A — First step");
  await create("B — Next step", ["A — First step"], "2026-10-01");
  await page.locator(".view-tabs [data-view=all]").click();
  await page
    .locator("[data-edit]")
    .filter({ hasText: "A — First step" })
    .first()
    .click();
  await page
    .locator(".dep-picker label")
    .filter({ hasText: "B — Next step" })
    .locator("input")
    .check();
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  assert.match(await page.locator("#form-error").innerText(), /loop/);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  // Accessible blocked action reports why and does not change completion.
  await page
    .getByRole("button", { name: "Complete: B — Next step", exact: true })
    .click({ force: true });
  assert.match(await page.locator("#toast").innerText(), /prerequisites/);
  await page
    .getByRole("button", { name: "Complete: A — First step", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "Complete: B — Next step", exact: true })
      .getAttribute("aria-disabled"),
    null,
  );
  await page
    .getByRole("button", { name: "Complete: B — Next step", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reopen: A — First step", exact: true })
    .click();
  assert.match(await page.locator("#toast").innerText(), /follow-up/);
  await page.reload();
  assert.equal(await page.locator(".task.done").count(), 2);
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#export").click();
  const download = await downloadPromise;
  await download.saveAs(out + "/roundtrip.backup.json");
  await create("Temporary task");
  await page.locator('[data-edit]').filter({ hasText: 'Temporary task' }).first().click();
  await page.locator('[name=title]').fill('Temporary edited task');
  await page.locator('[name=title]').press('Enter');
  assert.equal(await page.getByRole('button', { name: 'Complete: Temporary edited task', exact: true }).count(), 1);
  await page.locator('[data-edit]').filter({ hasText: 'Temporary edited task' }).first().click();
  await page.locator('[name=notes]').fill('Saved while completing');
  await page.getByRole('button', { name: 'Mark complete', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Reopen: Temporary edited task', exact: true }).count(), 1);
  assert.ok(await page.evaluate(()=>JSON.parse(localStorage.getItem('mydo.v1')).tasks.some(t=>t.title==='Temporary edited task'&&t.notes==='Saved while completing'&&t.done)));

  await page
    .locator("#import-file")
    .setInputFiles(out + "/roundtrip.backup.json");
  await page.locator("#confirm-yes").click();
  assert.equal(await page.locator(".task").count(), 2);
  await page
    .locator("#import-file")
    .setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"version":1,"tasks":[{}]}'),
    });
  await page.waitForFunction(() =>
    document.querySelector("#toast").textContent.includes("valid Mydo backup"),
  );
  assert.match(await page.locator("#toast").innerText(), /valid Mydo backup/);
  assert.equal(await page.locator(".task").count(), 2);
  await create("<img src=x onerror=alert(1)>");
  assert.equal(await page.locator(".task-title img").count(), 0);
  await page.getByRole("button", { name: "Switch to Chinese" }).click();
  assert.equal(await page.locator("html").getAttribute("lang"), "zh-Hant");
  await page.reload();
  assert.equal(await page.locator("html").getAttribute("lang"), "zh-Hant");
  for (const width of [375, 390, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `Overflow at ${width}`,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: out + "/mobile-chinese.png", fullPage: true });
  await page.locator(".add-main").click();
  await page.screenshot({ path: out + "/mobile-editor.png", fullPage: true });
  assert.ok(
    await page
      .locator("#editor")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  );
  await page.keyboard.press("Escape");
  // Installed shell remains usable without network after successful first load.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  assert.equal(await page.locator("h1").count(), 1);
  await page.locator(".add-main").click();
  await page.locator("[name=title]").fill("Offline task");
  await page.locator("button[type=submit]").last().click();
  assert.match(await page.locator("#content").innerText(), /Offline task/);
  await context.setOffline(false);
  // Storage corruption is preserved and prevents silent replacement.
  const broken = await context.newPage();
  await broken.goto(process.env.MYDO_URL || "http://127.0.0.1:4175");
  await broken.evaluate(() =>
    localStorage.setItem("mydo.v1", "broken original data"),
  );
  await broken.reload();
  assert.equal(await broken.locator(".banner.danger").count(), 1);
  assert.equal(
    await broken.evaluate(() => localStorage.getItem("mydo.v1")),
    "broken original data",
  );
  await broken.close();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: desktop, mobile, EN/中文, dependency cycle prevention, block/unlock, reopen guard, persistence, export/import, invalid backup rejection, XSS escaping, storage recovery; no page errors.",
  );
} finally {
  await browser.close();
}
