export const IMAGE_MAX_BYTES = 60000;
export const IMAGE_MAX_DIMENSION = 512;
export const IMAGE_SOURCE_MAX_BYTES = 20 * 1024 * 1024;
export const TASK_MEDIA_LIST_MAX_BYTES = 900000;

export const TASK_ICONS = Object.freeze([
  { id: "work", en: "Work", zh: "工作", glyph: "💼" },
  { id: "money", en: "Money", zh: "金錢", glyph: "💰" },
  { id: "ai", en: "AI", zh: "人工智能", glyph: "🤖" },
  { id: "productivity", en: "Productivity", zh: "效率", glyph: "⚡" },
  { id: "health", en: "Health", zh: "健康", glyph: "💚" },
  { id: "medicine", en: "Medicine", zh: "用藥", glyph: "💊" },
  { id: "gym", en: "Exercise", zh: "運動", glyph: "🏋️" },
  { id: "study", en: "Study", zh: "學習", glyph: "🎓" },
  { id: "home", en: "Home", zh: "家居", glyph: "🏠" },
  { id: "family", en: "Family", zh: "家人", glyph: "🫶" },
  { id: "shopping", en: "Shopping", zh: "購物", glyph: "🛍️" },
  { id: "travel", en: "Travel", zh: "旅行", glyph: "✈️" },
  { id: "food", en: "Food", zh: "飲食", glyph: "🍽️" },
  { id: "creative", en: "Creative", zh: "創作", glyph: "🎨" },
  { id: "reading", en: "Reading", zh: "閱讀", glyph: "📚" },
  { id: "other", en: "Other", zh: "其他", glyph: "📌" },
].map(Object.freeze));
const ICON_IDS = new Set(TASK_ICONS.map(({ id }) => id));
const JPEG_PREFIX = "data:image/jpeg;base64,";
const JPEG_MAX_TEXT_LENGTH = JPEG_PREFIX.length + Math.ceil(IMAGE_MAX_BYTES / 3) * 4;

function validateIcon(value) {
  if (value !== undefined && value !== "" && !ICON_IDS.has(value)) throw Error("mediaIcon");
}

// Check the bounded JPEG container before ever giving imported data to an <img>.
// The browser performs the actual raster decode; SVG and remote URLs are never accepted.
function jpegDimensions(bytes) {
  if (bytes.length < 20 || bytes[0] !== 0xff || bytes[1] !== 0xd8
    || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9)
    throw Error("mediaImage");
  let offset = 2, width = 0, height = 0, scanned = false;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) throw Error("mediaImage");
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (!scanned || !width || !height || offset !== bytes.length) throw Error("mediaImage");
      return { width, height };
    }
    if (marker === undefined || marker === 0x00 || marker === 0xd8
      || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) throw Error("mediaImage");
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (!Number.isInteger(length) || length < 2 || offset + length > bytes.length)
      throw Error("mediaImage");
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (width || length < 11 || bytes[offset + 2] !== 8) throw Error("mediaImage");
      height = bytes[offset + 3] * 256 + bytes[offset + 4];
      width = bytes[offset + 5] * 256 + bytes[offset + 6];
      const components = bytes[offset + 7];
      if (![1, 3].includes(components) || length !== 8 + 3 * components
        || !width || !height || width > IMAGE_MAX_DIMENSION || height > IMAGE_MAX_DIMENSION)
        throw Error("mediaImage");
    } else if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      throw Error("mediaImage");
    }
    if (marker === 0xda) {
      if (!width || !height || length < 8 || length !== 6 + 2 * bytes[offset + 2])
        throw Error("mediaImage");
      scanned = true;
      offset += length;
      // Entropy data may contain escaped FF bytes and restart markers.
      let data = false;
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) { offset++; data = true; continue; }
        let next = offset + 1;
        while (bytes[next] === 0xff) next++;
        const code = bytes[next];
        if (code === 0x00 || (code >= 0xd0 && code <= 0xd7)) {
          offset = next + 1; data = true;
        } else break;
      }
      if (!data) throw Error("mediaImage");
    } else offset += length;
  }
  throw Error("mediaImage");
}

export function validateTaskImage(value) {
  if (value === undefined || value === "") return;
  if (typeof value !== "string" || !value.startsWith(JPEG_PREFIX)) throw Error("mediaImage");
  if (value.length > JPEG_MAX_TEXT_LENGTH) throw Error("mediaImageSize");
  const base64 = value.slice(JPEG_PREFIX.length);
  if (!base64 || base64.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64))
    throw Error("mediaImage");
  let decoded;
  try {
    decoded = atob(base64);
    // Canonical encoding rejects malformed padding and non-zero unused bits.
    if (btoa(decoded) !== base64) throw Error();
  } catch { throw Error("mediaImage"); }
  if (decoded.length > IMAGE_MAX_BYTES) throw Error("mediaImageSize");
  return jpegDimensions(Uint8Array.from(decoded, (char) => char.charCodeAt(0)));
}

export function validateTaskMedia(task) {
  validateIcon(task.icon);
  validateTaskImage(task.image);
  return task;
}

export function normalizeTaskMedia(task) {
  let icon = "", image = "";
  try { validateIcon(task?.icon); icon = task?.icon || ""; } catch { /* Ignore unsafe imported previews. */ }
  try { validateTaskImage(task?.image); image = task?.image || ""; } catch { /* Ignore unsafe imported previews. */ }
  return { icon, image };
}

export function validateTaskMediaList(tasks) {
  // Keep existing image-free local lists valid. Only new embedded photos use this budget.
  if (!tasks.some((task) => typeof task.image === "string" && task.image)) return tasks;
  const json = JSON.stringify(tasks);
  let spaces = 0, inString = false, escaped = false;
  for (const char of json) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === ":" || char === ",") spaces++;
  }
  // PostgreSQL's jsonb text adds structural spaces; leave headroom for its 1 MB limit.
  if (new TextEncoder().encode(json).byteLength + spaces > TASK_MEDIA_LIST_MAX_BYTES)
    throw Error("mediaBudget");
  return tasks;
}

function inputType(file) {
  const types = new Set(["image/jpeg", "image/png", "image/webp", "image/gif",
    "image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);
  const type = typeof file?.type === "string" ? file.type.toLowerCase() : "";
  if (types.has(type)) return type;
  // Some iPhone photo pickers provide no MIME type, but do provide the original extension.
  if (!type && typeof file?.name === "string") {
    const extension = file.name.split(".").pop().toLowerCase();
    return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
      gif: "image/gif", heic: "image/heic", heif: "image/heif" })[extension] || "";
  }
  return "";
}

function checkInputSignature(bytes, type) {
  const ascii = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n);
  if (type === "image/webp") return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
  if (type === "image/gif") return ["GIF87a", "GIF89a"].includes(ascii(0, 6));
  if (type.startsWith("image/hei")) {
    const brands = new Set(["heic", "heix", "hevc", "hevx", "mif1", "msf1"]);
    if (bytes.length < 16 || ascii(4, 8) !== "ftyp") return false;
    const boxLength = bytes[0] * 16777216 + bytes[1] * 65536 + bytes[2] * 256 + bytes[3];
    if (boxLength < 16 || boxLength > bytes.length || boxLength > 1024) return false;
    if (brands.has(ascii(8, 12))) return true;
    for (let offset = 16; offset + 4 <= boxLength; offset += 4)
      if (brands.has(ascii(offset, offset + 4))) return true;
  }
  return false;
}

async function decodeImageFile(file) {
  // Image uses the browser's native image support, including HEIC where available.
  if (typeof globalThis.Image !== "function" || !globalThis.URL?.createObjectURL)
    throw Error("mediaDecode");
  const url = URL.createObjectURL(file);
  const image = new Image();
  let timer;
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Error("mediaDecode")), 15000);
      image.onload = () => resolve();
      image.onerror = () => reject(Error("mediaDecode"));
      image.src = url;
    });
    return { image, width: image.naturalWidth, height: image.naturalHeight,
      close: () => { image.src = ""; } };
  } catch (error) {
    image.src = "";
    throw error;
  } finally {
    clearTimeout(timer);
    image.onload = image.onerror = null;
    URL.revokeObjectURL(url);
  }
}

function encodeCanvas(canvas, quality) {
  return new Promise((resolve, reject) => {
    let timer = setTimeout(() => reject(Error("mediaProcess")), 15000);
    try {
      canvas.toBlob((blob) => {
        clearTimeout(timer);
        if (!blob || blob.type !== "image/jpeg") reject(Error("mediaProcess"));
        else resolve(blob);
      }, "image/jpeg", quality);
    } catch {
      clearTimeout(timer);
      reject(Error("mediaProcess"));
    }
  });
}

export async function prepareTaskImage(file, {
  decodeImage = decodeImageFile,
  createCanvas = () => document.createElement("canvas"),
} = {}) {
  const type = inputType(file);
  if (!type || typeof file?.arrayBuffer !== "function") throw Error("mediaFileType");
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > IMAGE_SOURCE_MAX_BYTES)
    throw Error("mediaFileSize");
  let bytes;
  try { bytes = new Uint8Array(await file.arrayBuffer()); }
  catch { throw Error("mediaRead"); }
  if (bytes.byteLength !== file.size || bytes.byteLength > IMAGE_SOURCE_MAX_BYTES)
    throw Error("mediaFileSize");
  if (!checkInputSignature(bytes, type)) throw Error("mediaFileType");
  let decoded, canvas;
  try {
    try { decoded = await decodeImage(file); }
    catch { throw Error("mediaDecode"); }
    if (!decoded || !Number.isSafeInteger(decoded.width) || !Number.isSafeInteger(decoded.height)
      || decoded.width < 1 || decoded.height < 1) throw Error("mediaDecode");
    canvas = createCanvas();
    const context = canvas?.getContext("2d");
    if (!context || typeof canvas.toBlob !== "function") throw Error("mediaProcess");
    let dimension = Math.min(IMAGE_MAX_DIMENSION, Math.max(decoded.width, decoded.height));
    for (let attempt = 0; attempt < 4; attempt++) {
      const scale = dimension / Math.max(decoded.width, decoded.height);
      canvas.width = Math.max(1, Math.round(decoded.width * scale));
      canvas.height = Math.max(1, Math.round(decoded.height * scale));
      // JPEG has no alpha; compositing onto the app's quiet background avoids black cutouts.
      context.fillStyle = "#eef2ed";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(decoded.image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.82, 0.65, 0.48]) {
        const blob = await encodeCanvas(canvas, quality);
        if (blob.size > IMAGE_MAX_BYTES) continue;
        let output;
        try { output = new Uint8Array(await blob.arrayBuffer()); }
        catch { throw Error("mediaRead"); }
        if (output.byteLength > IMAGE_MAX_BYTES) continue;
        const value = JPEG_PREFIX + btoa(String.fromCharCode(...output));
        validateTaskImage(value);
        return value;
      }
      dimension = Math.max(32, Math.floor(dimension * 0.75));
    }
    throw Error("mediaImageSize");
  } catch (error) {
    if (/^media[A-Z]/.test(error?.message || "")) throw error;
    throw Error("mediaProcess");
  } finally {
    try { decoded?.close?.(); } catch { /* Cleanup must not mask the result. */ }
    try { if (canvas) canvas.width = canvas.height = 0; } catch { /* Released by the browser. */ }
  }
}
