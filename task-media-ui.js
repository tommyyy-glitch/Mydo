import { TASK_ICONS, prepareTaskImage, normalizeTaskMedia } from './task-media.js';

const PHOTO_TYPES = 'image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif';

function mediaValue(task) {
  try { return normalizeTaskMedia(task); }
  catch { return { icon: '', image: '' }; }
}

function previewMarkup({ icon, image }, { tr, esc }) {
  const entry = TASK_ICONS.find(item => item.id === icon);
  if (!entry && !image) {
    return `<span class="task-media-placeholder" aria-hidden="true">＋</span><span class="task-media-placeholder-label">${esc(tr('No visual', '未加入圖片'))}</span>`;
  }
  return `<span class="task-visual ${image ? 'has-image' : ''}" aria-hidden="true">${image ? `<img class="task-visual-image" src="${esc(image)}" alt="">` : ''}${entry ? `<span class="task-visual-icon">${esc(entry.glyph)}</span>` : ''}</span>`;
}

/** Optional fields; the returned binding owns pending image work for this form only. */
export function taskMediaFields(task, { tr, esc }) {
  const media = mediaValue(task);
  const choices = [{ id: '', en: 'None', zh: '不設圖示', glyph: '—' }, ...TASK_ICONS];
  return `<fieldset class="task-media-fields" data-task-media><legend>${esc(tr('Icon or photo', '圖示或圖片'))} <span class="task-media-optional">${esc(tr('Optional', '可選'))}</span></legend><div class="task-media-layout"><div class="task-media-preview" data-media-preview role="img" aria-label="${esc(tr('Task visual preview', '任務圖片預覽'))}">${previewMarkup(media, { tr, esc })}</div><div class="task-media-photo-controls"><button type="button" class="secondary" data-media-choose>${esc(media.image ? tr('Change photo', '更換圖片') : tr('Choose photo', '選擇圖片'))}</button><button type="button" class="text-button" data-media-remove ${media.image ? '' : 'hidden'}>${esc(tr('Remove photo', '移除圖片'))}</button><input type="file" accept="${PHOTO_TYPES}" data-media-file hidden aria-label="${esc(tr('Choose a task photo', '選擇任務圖片'))}"><small>${esc(tr('Photos are resized before saving. Choose a photo up to 20 MB.', '儲存前會縮小圖片，可選擇 20 MB 以內的圖片。'))}</small></div></div><p class="task-media-feedback" data-media-feedback role="status" aria-live="polite" hidden></p><fieldset class="task-media-icon-field"><legend>${esc(tr('Choose an icon', '選擇圖示'))}</legend><div class="task-media-icons">${choices.map(item => `<label class="task-media-icon-choice"><input type="radio" name="taskIcon" value="${esc(item.id)}" ${media.icon === item.id ? 'checked' : ''}><span class="task-media-icon-option"><span class="task-media-choice-glyph" aria-hidden="true">${esc(item.glyph)}</span><span>${esc(tr(item.en, item.zh))}</span></span></label>`).join('')}</div></fieldset></fieldset>`;
}

function imageError(error, hasPrevious, tr) {
  const message = {
    mediaFileType: tr('Choose a JPEG, PNG, WebP, GIF or supported phone photo.', '請選擇 JPEG、PNG、WebP、GIF 或手機支援的相片。'),
    mediaFileSize: tr('This photo is too large. Choose one up to 20 MB.', '這張圖片太大，請選擇 20 MB 以內的圖片。'),
    mediaDecode: tr('This device could not open the photo. Try a JPEG or PNG copy.', '這部裝置無法開啟圖片，請改用 JPEG 或 PNG 版本。'),
    mediaRead: tr('The photo could not be read. Please choose it again.', '未能讀取圖片，請重新選擇。'),
  }[error?.message] || tr('The photo could not be prepared. Please try another photo.', '未能處理圖片，請試用另一張圖片。');
  return message + (hasPrevious ? tr(' Your previous photo is kept.', ' 原有圖片已保留。') : '');
}

export function bindTaskMediaEditor(form, { task, tr, esc, prepareImage = prepareTaskImage }) {
  const fieldset = form.querySelector('[data-task-media]');
  if (!fieldset) throw new Error('mediaEditorMissing');
  const picker = fieldset.querySelector('[data-media-file]');
  const choose = fieldset.querySelector('[data-media-choose]');
  const remove = fieldset.querySelector('[data-media-remove]');
  const preview = fieldset.querySelector('[data-media-preview]');
  const feedback = fieldset.querySelector('[data-media-feedback]');
  const current = mediaValue(task);
  let image = current.image;
  let pending = false;
  let disposed = false;
  let generation = 0;

  const attached = () => !disposed && form.isConnected && fieldset.isConnected && form.contains(fieldset);
  const selectedIcon = () => fieldset.querySelector('[name="taskIcon"]:checked')?.value || '';

  function setFeedback(text = '', error = false) {
    feedback.textContent = text;
    feedback.hidden = !text;
    feedback.classList.toggle('has-error', error);
  }
  function updatePreview() {
    preview.innerHTML = previewMarkup({ icon: selectedIcon(), image }, { tr, esc });
    choose.textContent = image ? tr('Change photo', '更換圖片') : tr('Choose photo', '選擇圖片');
    remove.hidden = !image && !pending;
    fieldset.setAttribute('aria-busy', pending ? 'true' : 'false');
  }
  const choosePhoto = () => { if (!disposed) picker.click(); };
  const removePhoto = () => {
    if (disposed) return;
    generation++;
    image = '';
    pending = false;
    picker.value = '';
    setFeedback(tr('Photo removed. Save the task to keep this change.', '圖片已移除，儲存任務後便會生效。'));
    updatePreview();
  };
  const iconChanged = event => {
    if (!disposed && event.target?.name === 'taskIcon') updatePreview();
  };
  const photoChanged = async () => {
    const file = picker.files?.[0];
    // Cancelling the file picker keeps both the saved image and any active work.
    if (!file || disposed) return;
    const ownGeneration = ++generation;
    pending = true;
    setFeedback(tr('Preparing photo… You can save when it is ready.', '正在處理圖片… 完成後即可儲存。'));
    updatePreview();
    try {
      const prepared = await prepareImage(file);
      if (ownGeneration !== generation || !attached()) return;
      const validated = normalizeTaskMedia({ icon: selectedIcon(), image: prepared });
      // Validation protects the preview as well as the saved task.
      if (!validated.image) throw new Error('mediaImage');
      image = validated.image;
      pending = false;
      setFeedback(tr('Photo ready. Save the task to keep it.', '圖片已準備好，儲存任務即可保留。'));
      updatePreview();
    } catch (error) {
      if (ownGeneration !== generation || !attached()) return;
      pending = false;
      setFeedback(imageError(error, !!image, tr), true);
      updatePreview();
    } finally {
      if (ownGeneration === generation && attached()) picker.value = '';
    }
  };

  choose.addEventListener('click', choosePhoto);
  remove.addEventListener('click', removePhoto);
  picker.addEventListener('change', photoChanged);
  fieldset.addEventListener('change', iconChanged);
  updatePreview();

  return {
    getMedia() {
      if (disposed) throw new Error('mediaEditorClosed');
      if (pending) throw new Error('imagePending');
      return normalizeTaskMedia({ icon: selectedIcon(), image });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      pending = false;
      choose.removeEventListener('click', choosePhoto);
      remove.removeEventListener('click', removePhoto);
      picker.removeEventListener('change', photoChanged);
      fieldset.removeEventListener('change', iconChanged);
      picker.value = '';
    },
  };
}
