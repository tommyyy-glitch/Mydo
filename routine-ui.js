import { isRoutine, routineDate, routineScheduled, routineDone, routineNextDate, setRoutineCheck } from './routines.js';
import { repeatFrequency } from './reminders.js';

const addDays = (date, count) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
};

export function createRoutineUI({ tr, esc, icon, getTasks, getProject, commit, onSaved, errorText, toast }) {
  const weekdays = () => tr(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], ['日', '一', '二', '三', '四', '五', '六']);
  const dateText = date => date.replaceAll('-', '/');
  function scheduleText(t) {
    const r = t.routine;
    const frequency = r.frequency === 'daily' ? tr('Every day', '每天') : r.frequency === 'weekly'
      ? tr('Every ', '逢星期') + [1, 2, 3, 4, 5, 6, 0].filter(day => r.weekdays.includes(day)).map(day => weekdays()[day]).join(tr(', ', '、'))
      : tr(`Monthly · day ${Number(r.start.slice(8))}`, `每月 ${Number(r.start.slice(8))} 日`);
    return `${frequency}${repeatFrequency(t.reminder) !== 'none' ? ` · ${t.reminder.time}` : tr(' · No notification', ' · 不通知')}`;
  }
  function nextText(t) {
    if (t.routine.paused) return tr('Paused · your records are kept', '已暫停 · 紀錄保留');
    const date = routineDate(t);
    const next = routineNextDate(t, routineDone(t, date) ? addDays(date, 1) : date);
    return next === date ? tr('Scheduled today', '今天要做') : tr(`Next: ${dateText(next)}`, `下次：${dateText(next)}`);
  }
  function card(t) {
    const date = routineDate(t), done = routineDone(t, date);
    const checkable = !t.routine.paused && routineScheduled(t, date);
    return `<article class="task routine-card ${done ? 'routine-checked' : ''} ${t.routine.paused ? 'routine-paused' : ''}"><button class="task-check ${done ? 'checked' : ''}" ${checkable ? `data-routine-check="${esc(t.id)}"` : 'disabled'} aria-pressed="${done}" aria-label="${esc(done ? tr(`Undo today's record: ${t.title}`, `取消今天已做：${t.title}`) : tr(`Mark done today: ${t.title}`, `標記今天已做：${t.title}`))}">${done ? icon('check') : icon('clock')}</button><button class="task-body" data-edit="${esc(t.id)}"><strong class="task-title">${esc(t.title)}</strong><span class="routine-schedule">${esc(scheduleText(t))}</span><span class="task-meta">${t.project ? `<span class="badge">${esc(t.project)}</span>` : ''}<span>${esc(done && checkable ? tr('Done today', '今天已做') : nextText(t))}</span></span></button></article>`;
  }
  function stats(list) {
    const scheduled = list.filter(t => !t.routine.paused && routineScheduled(t, routineDate(t)));
    const done = scheduled.filter(t => routineDone(t, routineDate(t))).length;
    const records = list.reduce((sum, t) => {
      const date = routineDate(t), since = addDays(date, -6);
      return sum + Object.entries(t.routine.checks).filter(([d, checked]) => checked && d >= since && d <= date).length;
    }, 0);
    return `<div class="stats">${[[tr('Scheduled today', '今天要做'), scheduled.length], [tr('Done today', '今天已做'), done], [tr('Records · last 7 days', '近 7 天紀錄'), records], [tr('Active routines', '持續日常'), list.filter(t => !t.routine.paused).length]].map(([label, value]) => `<div><span>${label}</span><strong>${String(value).padStart(2, '0')}</strong></div>`).join('')}</div>`;
  }
  function view(list) {
    if (!list.length) return `<div class="empty"><div class="empty-icon">${icon('routines')}</div><h2>${getTasks().some(isRoutine) ? tr('No matching routines', '沒有符合篩選的日常') : tr('Make room for your everyday', '把每天的事放在這裡')}</h2><p>${tr('Daily care, supplements or gym days. Record each time you do it; the routine stays for next time.', '日常護理、補充品或健身日。每次記錄已做，下次仍會再出現。')}</p><button class="primary" data-new>${icon('plus')}${tr('New routine', '新增日常')}</button></div>`;
    const groups = [
      [tr('To do today', '今天未做'), list.filter(t => !t.routine.paused && routineScheduled(t, routineDate(t)) && !routineDone(t, routineDate(t)))],
      [tr('Done today', '今天已做'), list.filter(t => !t.routine.paused && routineScheduled(t, routineDate(t)) && routineDone(t, routineDate(t)))],
      [tr('Upcoming', '其他日子'), list.filter(t => !t.routine.paused && !routineScheduled(t, routineDate(t)))],
      [tr('Paused', '已暫停'), list.filter(t => t.routine.paused)],
    ];
    return `<p class="view-note">${tr('A check means done today. It returns on the next scheduled day. Tap a name to edit the schedule or see records.', '打勾代表今天已做，下個排定日會再次出現。點名稱可修改時間或查看紀錄。')}</p>${groups.filter(([, items]) => items.length).map(([title, items]) => `<div class="section-label"><h2>${title} <span>${items.length}</span></h2></div><div class="task-list">${items.map(card).join('')}</div>`).join('')}`;
  }
  function check(id) {
    const t = getTasks().find(t => t.id === id);
    if (!isRoutine(t) || t.routine.paused) return;
    try {
      const date = routineDate(t), checked = !routineDone(t, date);
      commit(setRoutineCheck(getTasks(), id, date, checked));
      toast(checked ? tr('Recorded for today. It returns next time.', '已記錄今天完成，下次仍會出現。') : tr("Today's record undone.", '已取消今天的紀錄。'));
    } catch (e) { toast(errorText(e)); }
  }
  function open(id = '') {
    const existing = getTasks().find(t => t.id === id);
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(part => [part.type, part.value]));
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    const t = existing || { id: crypto.randomUUID(), kind: 'routine', title: '', project: getProject(), notes: '', intent: 'must', urgent: false, due: '', deps: [], done: false, status: 'preparing', created: new Date().toISOString(), routine: { frequency: 'daily', weekdays: [], start: date, timeZone: zone, paused: false, checks: {} }, reminder: { onDue: false, daily: true, repeat: 'daily', start: date, time: '09:00', timeZone: zone } };
    const r = t.routine, dialog = document.querySelector('#editor');
    const records = Object.entries(r.checks).filter(([, checked]) => checked).map(([d]) => d).sort().reverse().slice(0, 7);
    dialog.innerHTML = `<form id="routine-form"><header class="dialog-header"><div><div class="eyebrow">${tr('KEEP IT GOING', '讓日常持續')}</div><h2 id="editor-title">${existing ? tr('Routine details', '日常詳情') : tr('New routine', '新增日常')}</h2></div><button type="button" class="icon-button" data-close aria-label="${tr('Close', '關閉')}">${icon('close')}</button></header><label>${tr('Routine name', '日常名稱')} *<input name="title" required maxlength="200" value="${esc(t.title)}" placeholder="${tr('e.g. Daily care or gym', '例如：日常護理、健身')}"></label><div class="form-grid"><label>${tr('Frequency', '頻率')}<select name="frequency">${[['daily', tr('Every day', '每天')], ['weekly', tr('Selected weekdays', '每週指定日子')], ['monthly', tr('Every month', '每月')]].map(([value, text]) => `<option value="${value}" ${r.frequency === value ? 'selected' : ''}>${text}</option>`).join('')}</select></label><label>${tr('Start date', '開始日期')}<input type="date" name="start" required min="1900-01-01" max="9999-12-31" value="${esc(r.start)}"><small>${tr('Monthly follows this day; shorter months use their last day.', '每月按此日期；較短月份用最後一天。')}</small></label></div><fieldset id="routine-weekdays" ${r.frequency !== 'weekly' ? 'hidden' : ''}><legend>${tr('Which days?', '星期幾要做？')}</legend><div class="weekday-options">${[1, 2, 3, 4, 5, 6, 0].map(day => `<label><input type="checkbox" name="weekdays" value="${day}" ${r.weekdays.includes(day) ? 'checked' : ''}><span>${tr(weekdays()[day], '星期' + weekdays()[day])}</span></label>`).join('')}</div><small>${tr('Choose one or more days.', '可選一日或多日。')}</small></fieldset><label>${tr('Group', '分組')}<input name="project" maxlength="80" list="routine-projects" value="${esc(t.project)}" placeholder="${tr('e.g. Health, Fitness', '例如：健康、運動')}"><datalist id="routine-projects">${[...new Set(getTasks().filter(isRoutine).map(t => t.project).filter(Boolean))].map(p => `<option value="${esc(p)}"></option>`).join('')}</datalist></label><fieldset class="reminder-fields"><legend>${icon('clock')}${tr('Phone reminders', '手機通知')}</legend><label class="reminder-toggle"><input type="checkbox" name="notify" ${repeatFrequency(t.reminder) !== 'none' ? 'checked' : ''}>${tr('Notify on scheduled days', '在排定日子通知我')}</label><div class="form-grid"><label>${tr('Notification time', '通知時間')}<input type="time" name="time" required value="${esc(t.reminder?.time || '09:00')}"></label><label>${tr('Time zone', '時區')}<select name="zone">${[...new Set([r.timeZone, zone, 'Asia/Hong_Kong', 'UTC'])].map(z => `<option ${z === r.timeZone ? 'selected' : ''} value="${esc(z)}">${esc(z)}</option>`).join('')}</select></label></div><small>${tr('Enable Phone reminders on your iPhone first. A completed day is skipped; the next scheduled day still reminds you. Offline records take effect after syncing.', '請先在 iPhone 啟用「手機通知」。當天已做便跳過，下個排定日仍會提醒。離線紀錄在同步後才會生效。')}</small></fieldset><label class="reminder-toggle"><input type="checkbox" name="paused" ${r.paused ? 'checked' : ''}>${tr('Pause this routine', '暫停這項日常')}</label><small>${tr('Pausing stops scheduled reminders and keeps your records.', '暫停會停止提醒，並保留所有紀錄。')}</small><label>${tr('Notes', '備註')}<textarea name="notes" maxlength="5000" rows="3" placeholder="${tr('Your own instructions…', '記下你自己的指示…')}">${esc(t.notes)}</textarea></label>${existing ? `<section class="routine-history"><h3>${tr('Recent records', '最近紀錄')}</h3>${records.length ? records.map(d => `<span>${icon('check')}${esc(dateText(d))}</span>`).join('') : `<p>${tr('No completed days yet.', '暫時沒有完成紀錄。')}</p>`}</section>` : ''}<p class="form-error" id="form-error" role="alert"></p><div class="dialog-footer">${existing ? `<button type="button" class="text-button danger-text" data-delete="${esc(t.id)}">${tr('Delete routine', '刪除日常')}</button>` : '<span></span>'}<div><button type="button" class="secondary" data-close>${tr('Cancel', '取消')}</button><button type="submit" class="primary">${tr('Save routine', '儲存日常')}</button></div></div></form>`;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('[name=title]').focus();
    const form = dialog.querySelector('form');
    form.elements.frequency.onchange = () => { document.querySelector('#routine-weekdays').hidden = form.elements.frequency.value !== 'weekly'; };
    form.onsubmit = e => {
      e.preventDefault();
      const f = new FormData(form), frequency = f.get('frequency'), notify = f.has('notify');
      try {
        const saved = { ...t, title: f.get('title').trim(), notes: f.get('notes'), project: f.get('project').trim(), routine: { ...r, frequency, weekdays: frequency === 'weekly' ? f.getAll('weekdays').map(Number) : [], start: f.get('start'), timeZone: f.get('zone'), paused: f.has('paused') }, reminder: { onDue: false, daily: notify && frequency === 'daily', repeat: notify ? frequency : 'none', time: f.get('time'), start: f.get('start'), timeZone: f.get('zone') } };
        commit(existing ? getTasks().map(item => item.id === t.id ? saved : item) : [...getTasks(), saved]);
        dialog.close();
        onSaved();
        toast(tr('Routine saved.', '已儲存日常。'));
      } catch (e) { document.querySelector('#form-error').textContent = errorText(e); }
    };
  }
  const calendarKey = () => getTasks().filter(isRoutine).map(t => routineDate(t)).join('|');
  return { view, stats, open, check, calendarKey };
}
