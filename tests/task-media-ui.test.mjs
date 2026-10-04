import test from 'node:test';
import assert from 'node:assert/strict';
import { TASK_ICONS, validateTaskImage } from '../task-media.js';
import { taskMediaFields, bindTaskMediaEditor } from '../task-media-ui.js';

const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwC/RRRXGcB//9k=';
// A real one-pixel JPEG with different comments, rather than personal photos.
function photo(comment) {
  const pixels = Buffer.from(JPEG, 'base64'), label = Buffer.from(comment);
  return 'data:image/jpeg;base64,' + Buffer.concat([
    pixels.subarray(0, 2), Buffer.from([255, 254, 0, label.length + 2]), label, pixels.subarray(2),
  ]).toString('base64');
}
const PHOTO_A = photo('initial'), PHOTO_B = photo('replacement'), PHOTO_C = photo('latest');
validateTaskImage(PHOTO_A);
const tr = (en) => en;
const esc = value => String(value ?? '').replace(/[&<>"']/g,
  character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// The adapter implements only DOM events and references used by the editor.
// The real browser acceptance covers file decoding, layout and native controls.
class Element {
  constructor() {
    this.listeners = new Map(); this.attributes = new Map(); this.classes = new Set();
    this.classList = { toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name) };
    this.hidden = false; this.isConnected = true; this.textContent = ''; this.innerHTML = '';
    this.files = []; this.value = '';
  }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  click() { return this.emit('click'); }
  async emit(type, event = {}) {
    await Promise.all([...this.listeners.get(type) || []].map(callback => callback({ target: this, ...event })));
  }
}
function editor(task = {}, prepareImage = async () => PHOTO_B) {
  const form = new Element(), fieldset = new Element(), picker = new Element(), choose = new Element();
  const remove = new Element(), preview = new Element(), feedback = new Element();
  let selected = task.icon || '';
  const elements = {
    '[data-media-file]': picker, '[data-media-choose]': choose, '[data-media-remove]': remove,
    '[data-media-preview]': preview, '[data-media-feedback]': feedback,
  };
  fieldset.querySelector = selector => selector === '[name="taskIcon"]:checked'
    ? { value: selected } : elements[selector] || null;
  form.querySelector = selector => selector === '[data-task-media]' ? fieldset : null;
  form.contains = element => element === fieldset;
  const binding = bindTaskMediaEditor(form, { task, tr, esc, prepareImage });
  return { form, fieldset, picker, choose, remove, preview, feedback, binding,
    async icon(value) { selected = value; await fieldset.emit('change', { target: { name: 'taskIcon' } }); },
    upload(file = { name: 'fixture.png' }) { picker.files = [file]; return picker.emit('change'); },
    cancel() { picker.files = []; return picker.emit('change'); },
  };
}

test('media fields have labeled radio choices, native raster picker and polite status in both languages', () => {
  for (const translate of [tr, (en, zh) => zh]) {
    const markup = taskMediaFields({ icon: 'work', image: PHOTO_A }, { tr: translate, esc });
    assert.equal((markup.match(/type="radio"/g) || []).length, TASK_ICONS.length + 1);
    assert.match(markup, /name="taskIcon" value="work" checked/);
    assert.match(markup, /role="status" aria-live="polite"/);
    assert.match(markup, /<input type="file" accept="image\/jpeg,image\/png,image\/webp,image\/gif,image\/heic,image\/heif"/);
    assert.ok(markup.includes(translate('Choose an icon', '選擇圖示')));
    for (const entry of TASK_ICONS) assert.ok(markup.includes(translate(entry.en, entry.zh)));
    assert.equal(markup.includes('image/svg'), false);
  }
});

test('unsafe imported preview fields are omitted and legacy tasks select None', () => {
  const unsafe = taskMediaFields({ icon: '<script>', image: 'https://example.test/private.jpg' }, { tr, esc });
  assert.equal(unsafe.includes('<script>'), false);
  assert.equal(unsafe.includes('https://example.test'), false);
  assert.match(unsafe, /name="taskIcon" value="" checked/);
  assert.equal(unsafe.includes('<img'), false);
  const fields = taskMediaFields({}, { tr, esc });
  assert.match(fields, /name="taskIcon" value="" checked/);
});

test('saving waits for photo preparation then retains the latest selected icon', async () => {
  const work = deferred(), state = editor({ icon: 'work', image: PHOTO_A }, () => work.promise);
  const upload = state.upload();
  assert.throws(() => state.binding.getMedia(), /^Error: imagePending$/);
  assert.equal(state.fieldset.attributes.get('aria-busy'), 'true');
  await state.icon('money');
  work.resolve(PHOTO_B);
  await upload;
  assert.deepEqual(state.binding.getMedia(), { icon: 'money', image: PHOTO_B });
  assert.equal(state.fieldset.attributes.get('aria-busy'), 'false');
  assert.match(state.feedback.textContent, /Photo ready/);
  assert.ok(state.preview.innerHTML.includes(PHOTO_B));
});

test('cancelling the native picker keeps the saved image without processing a file', async () => {
  let processed = 0;
  const state = editor({ icon: 'home', image: PHOTO_A }, async () => { processed++; return PHOTO_B; });
  await state.cancel();
  assert.equal(processed, 0);
  assert.deepEqual(state.binding.getMedia(), { icon: 'home', image: PHOTO_A });
});

test('failed replacement preserves the previous photo and reports a readable explanation', async () => {
  const state = editor({ image: PHOTO_A }, async () => { throw Error('mediaDecode'); });
  await state.upload();
  assert.equal(state.binding.getMedia().image, PHOTO_A);
  assert.match(state.feedback.textContent, /Try a JPEG or PNG copy/);
  assert.match(state.feedback.textContent, /previous photo is kept/);
  assert.equal(state.feedback.classes.has('has-error'), true);
});

test('an unsafe processor result cannot replace a valid photo or enter the preview', async () => {
  const state = editor({ image: PHOTO_A }, async () => 'data:image/svg+xml,<svg onload="alert(1)">');
  await state.upload();
  assert.equal(state.binding.getMedia().image, PHOTO_A);
  assert.equal(state.preview.innerHTML.includes('<svg'), false);
  assert.equal(state.feedback.classes.has('has-error'), true);
});

test('removing a photo invalidates pending work and clears only the photo', async () => {
  const work = deferred(), state = editor({ icon: 'health', image: PHOTO_A }, () => work.promise);
  const upload = state.upload();
  await state.remove.emit('click');
  assert.deepEqual(state.binding.getMedia(), { icon: 'health', image: '' });
  assert.equal(state.remove.hidden, true);
  work.resolve(PHOTO_B);
  await upload;
  assert.deepEqual(state.binding.getMedia(), { icon: 'health', image: '' });
  assert.equal(state.preview.innerHTML.includes(PHOTO_B), false);
});

test('a late first upload cannot overwrite a newer choice', async () => {
  const first = deferred(), second = deferred();
  const state = editor({}, file => file.name === 'first' ? first.promise : second.promise);
  const oldUpload = state.upload({ name: 'first' }), newUpload = state.upload({ name: 'second' });
  second.resolve(PHOTO_C); await newUpload;
  first.resolve(PHOTO_B); await oldUpload;
  assert.equal(state.binding.getMedia().image, PHOTO_C);
});

test('disposal stops listeners and late uploads from altering either the old or reopened editor', async () => {
  const work = deferred(), old = editor({ icon: 'work', image: PHOTO_A }, () => work.promise);
  const oldUpload = old.upload();
  old.binding.dispose();
  old.binding.dispose();
  const oldPreview = old.preview.innerHTML;
  const next = editor({ icon: 'medicine' });
  work.resolve(PHOTO_B); await oldUpload;
  assert.equal(old.preview.innerHTML, oldPreview);
  assert.deepEqual(next.binding.getMedia(), { icon: 'medicine', image: '' });
  assert.throws(() => old.binding.getMedia(), /^Error: mediaEditorClosed$/);
  assert.equal(old.picker.listeners.get('change').size, 0);
});

test('detaching the form before completion prevents delayed writes to its preview', async () => {
  const work = deferred(), state = editor({ image: PHOTO_A }, () => work.promise);
  const upload = state.upload(), previousPreview = state.preview.innerHTML;
  state.form.isConnected = false;
  work.resolve(PHOTO_B); await upload;
  assert.equal(state.preview.innerHTML, previousPreview);
  state.binding.dispose();
});
