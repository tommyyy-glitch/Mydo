import test from "node:test";
import assert from "node:assert/strict";
import {
  TASK_ICONS, IMAGE_MAX_BYTES, IMAGE_MAX_DIMENSION, IMAGE_SOURCE_MAX_BYTES,
  TASK_MEDIA_LIST_MAX_BYTES, validateTaskImage, validateTaskMedia,
  validateTaskMediaList, normalizeTaskMedia, prepareTaskImage,
} from "../task-media.js";
import { validate, parseBackup, saveTask, setTaskStatus } from "../model.js";

// A generated green one-pixel raster with metadata removed, never a user photo.
const JPEG = "/9j/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9sAQwACAgICAgIDAgIDBQMDAwUGBQUFBQYIBgYGBgYICggICAgICAoKCgoKCgoKDAwMDAwMDg4ODg4PDw8PDw8PDw8P/9sAQwECAgIEBAQHBAQHEAsJCxAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ/90ABAAB/9oADAMBAAIRAxEAPwD53ooor58/Kz//2Q==";
const PIXELS = Buffer.from(JPEG, "base64");
const IMAGE = "data:image/jpeg;base64," + JPEG;
const imageURL = bytes => "data:image/jpeg;base64," + Buffer.from(bytes).toString("base64");
function paddedJPEG(size) {
  const comment = Buffer.alloc(size - PIXELS.length - 4, 65);
  const length = comment.length + 2;
  return Buffer.concat([PIXELS.subarray(0, 2), Buffer.from([255, 254, length >> 8, length & 255]),
    comment, PIXELS.subarray(2)]);
}
const task = (id = "a", fields = {}) => ({
  id, title: "A real fixture", project: "工作", notes: "", intent: "must", urgent: false,
  done: false, due: "", deps: [], created: "2026-10-04T00:00:00Z", ...fields,
});

function compressor({ width = 2048, height = 1024, oversized = 0, alwaysLarge = false } = {}) {
  let closes = 0, draws = [], qualities = [];
  const canvas = { width: 0, height: 0,
    getContext() { return { fillRect() {}, drawImage(...args) { draws.push(args); } }; },
    toBlob(callback, type, quality) {
      assert.equal(type, "image/jpeg");
      qualities.push(quality);
      const bytes = alwaysLarge || qualities.length <= oversized ? Buffer.alloc(IMAGE_MAX_BYTES + 1) : PIXELS;
      callback(new Blob([bytes], { type }));
    },
  };
  const options = { decodeImage: async () => ({ image: {}, width, height, close: () => { closes++; } }),
    createCanvas: () => canvas };
  return { options, canvas, draws, qualities, get closes() { return closes; } };
}
const upload = () => new Blob([PIXELS], { type: "image/jpeg" });

test("controlled presets have stable IDs, bilingual labels and safe glyphs", () => {
  assert.equal(TASK_ICONS.length, 16);
  assert.equal(new Set(TASK_ICONS.map(icon => icon.id)).size, TASK_ICONS.length);
  for (const icon of TASK_ICONS) {
    assert.ok(icon.en && icon.zh && icon.glyph);
    assert.equal(validateTaskMedia(task("a", { icon: icon.id })).icon, icon.id);
  }
  for (const icon of [null, false, 1, {}, "unknown", "<img onerror=x>"])
    assert.throws(() => validateTaskMedia(task("a", { icon })), /^Error: mediaIcon$/);
});

test("legacy, added and explicitly removed media round trip through backups", () => {
  const legacy = [task()];
  assert.equal(validate(legacy), legacy);
  let tasks = saveTask(legacy, { ...legacy[0], icon: "work", image: IMAGE });
  assert.deepEqual(parseBackup(JSON.stringify({ version: 1, tasks })), tasks);
  tasks = saveTask(tasks, { ...tasks[0], icon: "", image: "" });
  assert.deepEqual(parseBackup(JSON.stringify({ version: 1, tasks })), tasks);
  assert.equal(validateTaskImage(undefined), undefined);
  assert.equal(validateTaskImage(""), undefined);
});

test("status changes preserve media, reminders and prerequisite unlocking", () => {
  const reminder = { onDue: false, daily: true, time: "09:00", timeZone: "Asia/Hong_Kong", start: "2026-10-04" };
  let tasks = [task("a", { icon: "ai", image: IMAGE, reminder }), task("b", { deps: ["a"] })];
  for (const status of ["preparing", "ongoing", "almost", "complete"]) {
    tasks = setTaskStatus(tasks, "a", status);
    assert.equal(tasks[0].icon, "ai");
    assert.equal(tasks[0].image, IMAGE);
    assert.deepEqual(tasks[0].reminder, reminder);
    if (status !== "complete") assert.throws(() => setTaskStatus(tasks, "b", "complete"), /blocked/);
  }
  assert.equal(setTaskStatus(tasks, "b", "complete")[1].done, true);
});

test("image validation rejects remote, SVG, incorrect MIME and malformed base64", () => {
  const bad = [null, false, {}, "https://example.test/photo.jpg", "javascript:alert(1)",
    "data:image/svg+xml;base64,PHN2Zy8+", "data:image/png;base64," + JPEG,
    "data:image/jpeg;base64,a===", "data:image/jpeg;base64,AAAA====", IMAGE + " ",
    "data:image/jpeg;base64," + JPEG.slice(0, -1), "data:image/jpeg;base64,/9=="];
  for (const image of bad) assert.throws(() => validate([task("a", { image })]), /mediaImage/);
  assert.throws(() => validateTaskImage(imageURL(Buffer.from("<svg onload='x'>"))), /mediaImage/);
});

test("JPEG marker bounds, dimensions and terminal bytes are validated", () => {
  assert.deepEqual(validateTaskImage(IMAGE), { width: 1, height: 1 });
  assert.throws(() => validateTaskImage(imageURL(PIXELS.subarray(0, -1))), /mediaImage/);
  assert.throws(() => validateTaskImage(imageURL(Buffer.concat([PIXELS, Buffer.from([0])]))), /mediaImage/);
  const malformed = Buffer.from(PIXELS);
  malformed[4] = 255; malformed[5] = 255;
  assert.throws(() => validateTaskImage(imageURL(malformed)), /mediaImage/);
  const oversized = Buffer.from(PIXELS);
  const frame = oversized.indexOf(Buffer.from([255, 192]));
  assert.ok(frame > 0);
  oversized[frame + 7] = 2; oversized[frame + 8] = 1; // width 513
  assert.throws(() => validateTaskImage(imageURL(oversized)), /mediaImage/);
});

test("individual limits use decoded image bytes and allow the exact boundary", () => {
  assert.deepEqual(validateTaskImage(imageURL(paddedJPEG(IMAGE_MAX_BYTES))), { width: 1, height: 1 });
  assert.throws(() => validateTaskImage(imageURL(paddedJPEG(IMAGE_MAX_BYTES + 1))), /^Error: mediaImageSize$/);
  const safe = normalizeTaskMedia({ icon: "work", image: IMAGE });
  assert.deepEqual(safe, { icon: "work", image: IMAGE });
  assert.deepEqual(normalizeTaskMedia({ icon: "<img>", image: "https://example.test/a.jpg" }), { icon: "", image: "" });
  assert.deepEqual(normalizeTaskMedia(null), { icon: "", image: "" });
});

test("photo lists leave cloud headroom and do not newly restrict image-free legacy lists", () => {
  const photos = Array.from({ length: 12 }, (_, i) => task(String(i), { image: imageURL(paddedJPEG(IMAGE_MAX_BYTES)) }));
  assert.ok(new TextEncoder().encode(JSON.stringify(photos)).byteLength > TASK_MEDIA_LIST_MAX_BYTES);
  assert.throws(() => validate(photos), /^Error: mediaBudget$/);
  const within = photos.slice(0, 10);
  assert.equal(validateTaskMediaList(within), within);
  assert.equal(validate(within), within);
  const legacy = Array.from({ length: 200 }, (_, i) => task(String(i), { notes: "中".repeat(5000) }));
  assert.equal(validate(legacy), legacy);
  assert.throws(() => validate([{ ...legacy[0], image: IMAGE }, ...legacy.slice(1)]), /^Error: mediaBudget$/);
});

test("compression respects aspect ratio and strips source metadata by drawing a new canvas", async () => {
  const stub = compressor();
  assert.equal(await prepareTaskImage(upload(), stub.options), IMAGE);
  assert.equal(stub.draws.length, 1);
  assert.deepEqual(stub.draws[0].slice(1), [0, 0, IMAGE_MAX_DIMENSION, IMAGE_MAX_DIMENSION / 2]);
  assert.deepEqual(stub.qualities, [0.82]);
  assert.equal(stub.closes, 1);
  assert.equal(stub.canvas.width, 0);
  assert.equal(stub.canvas.height, 0);
});

test("compression lowers quality and then dimensions to meet actual encoded bounds", async () => {
  const stub = compressor({ oversized: 3 });
  assert.equal(await prepareTaskImage(upload(), stub.options), IMAGE);
  assert.deepEqual(stub.qualities, [0.82, 0.65, 0.48, 0.82]);
  assert.equal(stub.draws[1][3], Math.floor(IMAGE_MAX_DIMENSION * 0.75));
  assert.equal(stub.closes, 1);
  const impossible = compressor({ alwaysLarge: true });
  await assert.rejects(prepareTaskImage(upload(), impossible.options), /^Error: mediaImageSize$/);
  assert.equal(impossible.qualities.length, 12);
  assert.equal(impossible.closes, 1);
  assert.equal(impossible.canvas.width, 0);
});

test("unsafe, oversized and spoofed input files fail before decoding", async () => {
  let decoded = 0;
  const options = { decodeImage: async () => { decoded++; throw Error(); } };
  await assert.rejects(prepareTaskImage(new Blob(["<svg/>"], { type: "image/svg+xml" }), options), /mediaFileType/);
  await assert.rejects(prepareTaskImage({ size: IMAGE_SOURCE_MAX_BYTES + 1, type: "image/jpeg", arrayBuffer() { throw Error(); } }, options), /mediaFileSize/);
  await assert.rejects(prepareTaskImage(new Blob(["<svg/>"], { type: "image/jpeg" }), options), /mediaFileType/);
  assert.equal(decoded, 0);
});

test("read, decoder and canvas failures have friendly errors and release decoded resources", async () => {
  await assert.rejects(prepareTaskImage({ type: "image/jpeg", size: PIXELS.length, arrayBuffer: async () => { throw Error(); } }), /mediaRead/);
  await assert.rejects(prepareTaskImage(upload(), { decodeImage: async () => { throw Error("native decoder failure"); } }), /^Error: mediaDecode$/);
  const invalid = compressor({ width: 0 });
  await assert.rejects(prepareTaskImage(upload(), invalid.options), /mediaDecode/);
  assert.equal(invalid.closes, 1);
  const broken = compressor();
  broken.options.createCanvas = () => ({ getContext: () => null });
  await assert.rejects(prepareTaskImage(upload(), broken.options), /mediaProcess/);
  assert.equal(broken.closes, 1);
});

test("iPhone HEIC inputs are accepted only if the browser can decode them", async () => {
  const bytes = Buffer.from([0,0,0,20, ...Buffer.from("ftypheic"), 0,0,0,0, ...Buffer.from("mif1")]);
  const file = new Blob([bytes], { type: "image/heic" });
  await assert.rejects(prepareTaskImage(file, { decodeImage: async () => { throw Error(); } }), /^Error: mediaDecode$/);
  const stub = compressor({ width: 200, height: 100 });
  assert.equal(await prepareTaskImage(file, stub.options), IMAGE);
  const unnamed = { name: "IMG_1234.HEIC", type: "", size: file.size, arrayBuffer: () => file.arrayBuffer() };
  assert.equal(await prepareTaskImage(unnamed, compressor().options), IMAGE);
});
