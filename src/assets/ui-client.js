function focusField(field) {
  for (let details = field.closest('details'); details; details = details.parentElement.closest('details')) details.open = true;
  field.focus({ preventScroll: true });
  field.scrollIntoView({ block: 'center' });
}

function validationNote(field) {
  return (field.getAttribute('aria-describedby') ?? '').split(/\s+/)
    .map(id => id && document.getElementById(id)).find(note => note?.matches?.('.field-error, .phrase-error'));
}

function showFieldError(field, message) {
  let note = validationNote(field);
  if (!note) {
    if (!field.id) field.id = `checked-field-${document.querySelectorAll('[id^="checked-field-"]').length}`;
    note = document.createElement('p');
    note.id = `${field.id}-error`;
    note.className = 'field-error';
    const label = field.closest('label');
    (label ?? field).after(note);
    field.setAttribute('aria-describedby', [field.getAttribute('aria-describedby'), note.id].filter(Boolean).join(' '));
  }
  note.hidden = false;
  note.textContent = message;
  field.setAttribute('aria-invalid', 'true');
}

function clearFieldError(field) {
  const note = validationNote(field);
  if (note) { note.hidden = true; note.textContent = ''; }
  field.removeAttribute('aria-invalid');
}

function directForms(form) {
  const base = form.dataset.resumeAction.split('/').slice(0, -2).join('/');
  return document.querySelectorAll(`form[action^="${base}/direct/"]`);
}

let firstInvalid;
document.addEventListener('invalid', event => {
  const field = event.target;
  event.preventDefault();
  if (!firstInvalid) {
    firstInvalid = field;
    setTimeout(() => { focusField(firstInvalid); firstInvalid = undefined; }, 0);
  }
  const { valueMissing, customError, rangeOverflow } = field.validity;
  const message = customError ? field.validationMessage : valueMissing
    ? field.type === 'checkbox' ? 'Подтвердите это условие.' : field.tagName === 'SELECT' ? 'Выберите значение из списка.' : 'Заполните это поле.'
    : rangeOverflow && field.type === 'date' ? `Выберите дату не позже ${field.max.split('-').reverse().join('.')}.`
      : 'Проверьте значение и формат поля.';
  showFieldError(field, message);
}, true);
document.addEventListener('input', event => {
  const field = event.target;
  if (field.matches('[aria-invalid="true"]') && !field.closest('[data-report-period]') && (!field.validity || field.validity.valid)) clearFieldError(field);
});

function setupBusinessFields() {
  const url = document.querySelector('#plan-url');
  if (url) {
    const error = document.querySelector('#plan-url-error');
    function validate(showError) {
      const raw = url.value.trim();
      let message = '';
      if (raw) {
        let parsed;
        try { parsed = new URL(raw); } catch { /* An incomplete draft can still be saved. */ }
        if (!/^https?:\/\/[^/?#]/i.test(raw) || !parsed?.hostname || /[\s\\]/.test(raw))
          message = 'Введите полный адрес, например https://example.ru/remont';
        else if (parsed.username || parsed.password)
          message = 'Укажите публичную ссылку без логина и пароля в адресе.';
      } else if (showError && url.required) message = 'Введите ссылку на страницу, куда придёт клиент.';
      url.setCustomValidity(message);
      if (showError || !message) {
        error.textContent = message;
        error.hidden = !message;
        if (message) url.setAttribute('aria-invalid', 'true');
        else url.removeAttribute('aria-invalid');
      }
    }
    url.addEventListener('input', () => validate(!error.hidden));
    url.addEventListener('blur', event => {
      if (!event.relatedTarget?.formNoValidate) validate(true);
    });
    url.addEventListener('invalid', () => validate(true));
    if (url.value && error.hidden) validate(false);
  }

  document.querySelectorAll('[data-business-picker]').forEach(setupBusinessPicker);
}

function setupBusinessPicker(picker) {
  const name = picker.dataset.businessPicker;
  const input = picker.querySelector('input'), toggle = picker.querySelector('button');
  const popup = picker.querySelector('.picker-popup'), list = picker.querySelector('[role=listbox]');
  const empty = picker.querySelector('.picker-empty');
  const openLabel = toggle.getAttribute('aria-label');
  const normalize = value => value.trim().toLocaleLowerCase('ru').replaceAll('ё', 'е');
  const aliases = { 'Москва и область': 'московская область', 'Санкт-Петербург и Ленинградская область': 'ленинградская область спб' };
  const entries = Array.from(input.list.options, option => ({
    name: option.value, search: normalize(option.value + ' ' + (name === 'region' ? aliases[option.value] || '' : '')),
  }));
  input.removeAttribute('list');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-controls', list.id);
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  picker.classList.add('has-picker');
  toggle.hidden = false;
  let active = -1;

  function setOpen(open) {
    popup.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Закрыть список' : openLabel);
    active = -1;
    input.removeAttribute('aria-activedescendant');
  }
  function show(query) {
    const match = normalize(query);
    const fragment = document.createDocumentFragment();
    let index = 0;
    for (const entry of entries) {
      if (!entry.search.includes(match)) continue;
      const row = document.createElement('li');
      row.id = name + '-choice-' + index++;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', 'false');
      row.textContent = entry.name;
      fragment.append(row);
    }
    list.replaceChildren(fragment);
    list.scrollTop = 0;
    empty.hidden = index > 0;
    setOpen(true);
  }
  function select(row) {
    input.value = row.textContent;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    setOpen(false);
  }
  input.addEventListener('input', () => show(input.value));
  if (name === 'goal') input.addEventListener('click', () => { if (popup.hidden) show(''); });
  toggle.addEventListener('click', () => {
    input.focus();
    if (popup.hidden) show('');
    else setOpen(false);
  });
  list.addEventListener('mousedown', event => event.preventDefault());
  list.addEventListener('click', event => {
    const row = event.target.closest('[role=option]');
    if (row) select(row);
  });
  picker.addEventListener('focusout', event => { if (!picker.contains(event.relatedTarget)) setOpen(false); });
  input.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Escape' && !popup.hidden) { event.preventDefault(); setOpen(false); return; }
    if (event.key === 'Enter' && !popup.hidden && active >= 0) { event.preventDefault(); select(list.children[active]); return; }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    if (popup.hidden) show(input.value);
    const rows = list.children;
    if (!rows.length) return;
    if (active >= 0) rows[active].setAttribute('aria-selected', 'false');
    active = event.key === 'ArrowDown' ? Math.min(active + 1, rows.length - 1) : active < 0 ? rows.length - 1 : Math.max(0, active - 1);
    rows[active].setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', rows[active].id);
    rows[active].scrollIntoView({ block: 'nearest' });
  });
}

setupBusinessFields();

function setupOfferHelp(editor) {
  const selector = '[data-offer-help]';
  let active;
  function close() {
    if (!active) return;
    active.nextElementSibling.hidden = true;
    active = undefined;
  }
  function show(button) {
    if (button === active) return;
    close();
    active = button;
    active.nextElementSibling.hidden = false;
  }
  editor.addEventListener('pointerover', event => {
    const button = event.target.closest(selector);
    if (button && event.pointerType !== 'touch') show(button);
  });
  editor.addEventListener('pointerout', event => {
    if (!active || event.pointerType === 'touch' || active.matches(':focus-visible')) return;
    const tooltip = active.nextElementSibling;
    const within = node => active.contains(node) || tooltip.contains(node);
    if (within(event.target) && !within(event.relatedTarget)) close();
  });
  editor.addEventListener('focusin', event => {
    if (event.target.matches(`${selector}:focus-visible`)) show(event.target);
  });
  editor.addEventListener('focusout', event => {
    if (event.target === active) close();
  });
  document.addEventListener('click', event => {
    const button = event.target.closest(selector);
    if (button && editor.contains(button)) show(button);
    else if (!active?.nextElementSibling.contains(event.target)) close();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
  });
}

const periodBeforeNavigation = new WeakMap();

function setupCampaignPeriod(form) {
  const group = form.querySelector('[data-report-period]');
  if (!group) return;
  const from = form.elements.namedItem('customFrom');
  const to = form.elements.namedItem('customTo');
  const lastDay = new Date(group.dataset.lastDay + 'T00:00:00Z');
  const submitButton = form.querySelector('[data-period-submit]');
  const errorLine = form.querySelector('#campaign-period-error');
  const calendar = group.querySelector('dialog');
  let appliedFrom = form.elements.namedItem('dateFrom').value;
  let appliedTo = form.elements.namedItem('dateTo').value;
  let saving;
  if (typeof calendar.showModal !== 'function') return;
  submitButton.hidden = true;
  const activePreset = form.querySelector('[name="days"][aria-pressed="true"]');
  const results = form.closest('.results');
  const refresh = results.querySelector('#analytics-refresh');
  const refreshButtons = [...results.querySelectorAll('button[form="analytics-refresh"]:not(:disabled)')];

  function periodHasError(show = true) {
    const start = readDate(from.value);
    const end = readDate(to.value);
    let invalid, message;
    if (!start || !end) {
      invalid = !start ? from : to;
      message = !from.value || !to.value ? 'Укажите обе даты.' : 'Введите существующую дату в формате ДД.ММ.ГГГГ.';
    } else if (start > lastDay || end > lastDay) {
      invalid = start > lastDay ? from : to;
      message = 'Последняя доступная дата — вчера по Москве.';
    } else if (start > end) {
      invalid = to;
      message = 'Дата окончания должна быть не раньше даты начала.';
    } else if (end - start > 30 * 86_400_000) {
      invalid = to;
      message = 'Выберите период до 31 дня.';
    }
    for (const field of [from, to]) {
      if (show && field === invalid) field.setAttribute('aria-invalid', 'true');
      else field.removeAttribute('aria-invalid');
    }
    errorLine.textContent = show ? message ?? '' : '';
    for (const button of refreshButtons) button.disabled = Boolean(invalid);
    return Boolean(invalid);
  }

  const periodChanged = () => isoDay(readDate(from.value)) !== appliedFrom || isoDay(readDate(to.value)) !== appliedTo;

  function applyPeriod() {
    if (form.dataset.periodSubmitting || periodHasError()) return;
    if (!periodChanged()) {
      activePreset?.setAttribute('aria-pressed', 'true');
      return;
    }
    form.requestSubmit(submitButton);
  }

  for (const field of [from, to]) {
    field.addEventListener('input', () => {
      periodHasError(field.value.length === 10 || field.value === '');
      for (const preset of form.querySelectorAll('[name="days"]')) preset.setAttribute('aria-pressed', 'false');
    });
    field.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      applyPeriod();
    });
  }
  group.addEventListener('focusout', event => {
    const next = event.relatedTarget;
    if (group.contains(next) || form.contains(next) || next?.closest('a, button')) return;
    applyPeriod();
  });
  form.addEventListener('submit', event => {
    if (form.dataset.periodSubmitting || (event.submitter?.value === 'custom' && periodHasError())) {
      event.preventDefault();
      return;
    }
    form.dataset.periodSubmitting = 'true';
  });
  refresh?.addEventListener('submit', event => {
    if (form.dataset.periodSubmitting || periodHasError()) {
      event.preventDefault();
      return;
    }
    if (event.submitter?.name === 'reportId') {
      if (periodChanged()) {
        event.preventDefault();
        applyPeriod();
      }
      return;
    }
    refresh.elements.namedItem('dateFrom').value = isoDay(readDate(from.value));
    refresh.elements.namedItem('dateTo').value = isoDay(readDate(to.value));
    form.dataset.periodSubmitting = 'true';
  });
  periodBeforeNavigation.set(form, () => {
    if (saving) return saving;
    if (form.dataset.periodSubmitting) return false;
    if (periodHasError(false) || !periodChanged()) return true;
    const data = new URLSearchParams(new FormData(form, submitButton));
    form.dataset.periodSubmitting = 'true';
    from.readOnly = to.readOnly = true;
    saving = (async () => {
      try {
        const response = await fetch(form.action, { method: 'POST', body: data });
        const destination = new URL(response.url);
        const conflict = response.status === 409;
        if ((!response.ok && !conflict) || (!conflict && destination.searchParams.get('filters') !== 'applied')
          || destination.searchParams.get('ad') !== new URL(form.action).searchParams.get('ad')) throw new Error('Period unavailable');
        const incoming = new DOMParser().parseFromString(await response.text(), 'text/html');
        const updated = incoming.querySelector('#analytics-filters');
        if (!updated || incoming.body.dataset.scope !== document.body.dataset.scope) throw new Error('Period unavailable');
        for (const name of ['revision', 'dateFrom', 'dateTo']) {
          const value = updated.elements.namedItem(name).value;
          form.elements.namedItem(name).value = value;
          const refreshField = refresh?.elements.namedItem(name);
          if (refreshField) refreshField.value = value;
        }
        appliedFrom = form.elements.namedItem('dateFrom').value;
        appliedTo = form.elements.namedItem('dateTo').value;
        if (conflict) {
          errorLine.textContent = incoming.querySelector('#notification p')?.textContent || 'Период не сохранён. Проверьте даты и повторите.';
          return false;
        }
        return true;
      } catch {
        errorLine.textContent = 'Период не сохранён. Останьтесь на вкладке и примените даты заново.';
        return false;
      } finally {
        from.readOnly = to.readOnly = false;
        delete form.dataset.periodSubmitting;
        saving = undefined;
      }
    })();
    return saving;
  });

  const isoDay = date => date.toISOString().slice(0, 10);
  function readDate(value) {
    const parts = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
    if (!parts || parts[3] === '0000') return undefined;
    const iso = [parts[3], parts[2], parts[1]].join('-');
    const date = new Date(iso + 'T00:00:00Z');
    if (!Number.isNaN(date.getTime()) && isoDay(date) === iso) return date;
  }

  const monthCaption = calendar.querySelector('#calendar-month');
  const calendarBody = calendar.querySelector('tbody');
  const monthControls = [...calendar.querySelectorAll('[data-month-offset]')];
  const monthLabel = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const dayLabel = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'full', timeZone: 'UTC' });
  const addDays = (date, offset) => new Date(date.getTime() + offset * 86_400_000);
  const daysFromMonday = date => (date.getUTCDay() + 6) % 7;
  const supportedDay = date => date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999;
  let calendarInput, calendarTrigger, activeDay;
  const availableDay = date => supportedDay(date) && date <= lastDay;
  function availableMonth(date) {
    const first = new Date(date);
    first.setUTCDate(1);
    return availableDay(first);
  }

  function moveMonth(date, offset) {
    const next = new Date(date);
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + offset);
    const last = new Date(next);
    last.setUTCMonth(last.getUTCMonth() + 1, 0);
    next.setUTCDate(Math.min(date.getUTCDate(), last.getUTCDate()));
    return next;
  }

  function renderCalendar(focusDay = false) {
    const month = activeDay.getUTCMonth();
    const selected = readDate(calendarInput.value)?.getTime();
    const caption = monthLabel.format(activeDay);
    if (monthCaption.textContent !== caption) monthCaption.textContent = caption;
    const first = new Date(activeDay);
    first.setUTCDate(1);
    const firstCell = addDays(first, -daysFromMonday(first));
    const rows = document.createDocumentFragment();
    for (let week = 0; week < 6; week++) {
      const row = document.createElement('tr');
      for (let weekday = 0; weekday < 7; weekday++) {
        const date = addDays(firstCell, week * 7 + weekday);
        const cell = row.insertCell();
        if (!supportedDay(date)) continue;
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.day = isoDay(date);
        button.textContent = String(date.getUTCDate());
        button.tabIndex = date.getTime() === activeDay.getTime() ? 0 : -1;
        button.setAttribute('aria-label', dayLabel.format(date));
        button.disabled = !availableDay(date);
        cell.setAttribute('aria-selected', String(date.getTime() === selected));
        if (date.getUTCMonth() !== month) button.className = 'adjacent-month';
        cell.append(button);
      }
      rows.append(row);
    }
    calendarBody.replaceChildren(rows);
    for (const control of monthControls) {
      control.disabled = !availableMonth(moveMonth(activeDay, Number(control.dataset.monthOffset)));
    }
    if (focusDay) calendarBody.querySelector('[tabindex="0"]')?.focus({ preventScroll: true });
  }

  function positionCalendar() {
    const anchor = calendarInput.parentElement.getBoundingClientRect();
    const { width, height } = calendar.getBoundingClientRect();
    const roomBelow = innerHeight - anchor.bottom;
    const top = roomBelow >= height + 18 ? anchor.bottom + 6 : anchor.top - height - 6;
    calendar.style.left = Math.max(12, Math.min(anchor.left, document.documentElement.clientWidth - width - 12)) + 'px';
    calendar.style.top = Math.max(12, Math.min(top, innerHeight - height - 12)) + 'px';
  }

  for (const trigger of group.querySelectorAll('[data-calendar-for]')) {
    trigger.hidden = false;
    trigger.addEventListener('click', () => {
      if (form.dataset.periodSubmitting) return;
      calendarTrigger = trigger;
      calendarInput = trigger.dataset.calendarFor === 'from' ? from : to;
      const stored = readDate(calendarInput.value);
      activeDay = stored && availableDay(stored) ? stored : lastDay;
      renderCalendar();
      calendar.showModal();
      positionCalendar();
      window.addEventListener('resize', onResize);
      calendarBody.querySelector('[tabindex="0"]')?.focus({ preventScroll: true });
    });
  }

  function acceptDate(iso = '') {
    calendarInput.value = iso.split('-').reverse().join('.');
    calendar.close();
    applyPeriod();
  }

  calendar.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (button?.dataset.day) return acceptDate(button.dataset.day);
    if (button?.hasAttribute('data-calendar-latest')) return acceptDate(isoDay(lastDay));
    if (button?.hasAttribute('data-calendar-clear')) return acceptDate();
    if (button?.hasAttribute('data-calendar-close')) return calendar.close();
    if (button?.dataset.monthOffset) {
      const offset = Number(button.dataset.monthOffset);
      const next = moveMonth(activeDay, offset);
      activeDay = next > lastDay ? lastDay : next;
      return renderCalendar(!availableMonth(moveMonth(activeDay, offset)));
    }
    if (event.target === calendar) {
      const { left, right, top, bottom } = calendar.getBoundingClientRect();
      if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) calendar.close();
    }
  });

  calendarBody.addEventListener('keydown', event => {
    if (!event.target.matches('button[data-day]')) return;
    const weekOffset = daysFromMonday(activeDay);
    const shifts = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -weekOffset, End: 6 - weekOffset };
    let next;
    if (Object.hasOwn(shifts, event.key)) next = addDays(activeDay, shifts[event.key]);
    else if (event.key === 'PageUp' || event.key === 'PageDown') next = moveMonth(activeDay, event.key === 'PageUp' ? -1 : 1);
    else return;
    event.preventDefault();
    if (!availableDay(next)) return;
    activeDay = next;
    renderCalendar(true);
  });
  calendar.addEventListener('close', () => calendarTrigger?.focus({ preventScroll: true }));
  const onResize = () => positionCalendar();
  calendar.addEventListener('close', () => window.removeEventListener('resize', onResize));
}

function setupPanelControls(root) {
  // Results controls: changing the campaign or goal applies at once. The visible
  // "Показать" button keeps the same flow working without JavaScript.
  const resultsControls = root.querySelector('#analytics-filters');
  if (resultsControls) {
    setupCampaignPeriod(resultsControls);
    const applyFilters = resultsControls.querySelector('.campaign-field button');
    for (const select of resultsControls.querySelectorAll('select')) {
      select.addEventListener('change', () => {
        resultsControls.requestSubmit(applyFilters);
      });
    }
  }

  const creativeEditor = root.querySelector('[data-creative-editor]');
  if (creativeEditor) {
    const title = creativeEditor.elements.namedItem('title');
    const text = creativeEditor.elements.namedItem('adText');
    const previewTitle = creativeEditor.querySelector('[data-creative-title]');
    const previewText = creativeEditor.querySelector('[data-creative-text]');
    const status = creativeEditor.querySelector('[data-creative-status]');
    const recovery = creativeEditor.querySelector('[data-creative-recovery]');
    const storageKey = 'goulash-creative:' + document.body.dataset.scope + ':' + creativeEditor.elements.namedItem('run').value;
    function updatePreview() {
      previewTitle.textContent = title.value;
      previewText.textContent = text.value;
      const changed = title.value !== creativeEditor.dataset.savedTitle || text.value !== creativeEditor.dataset.savedText;
      const message = changed ? 'Изменения ещё не сохранены.' : creativeEditor.dataset.creativeSaved === 'true'
        ? 'Предложенная правка сохранена в Goulash.' : 'Исходный текст из Директа.';
      if (status.textContent !== message) status.textContent = message;
    }
    function rememberCreativeInput() {
      try {
        if (title.value === creativeEditor.dataset.savedTitle && text.value === creativeEditor.dataset.savedText) {
          sessionStorage.removeItem(storageKey);
        } else {
          sessionStorage.setItem(storageKey, JSON.stringify({ title: title.value, text: text.value }));
        }
      } catch { /* Browser storage can be disabled. */ }
    }
    creativeEditor.addEventListener('input', () => {
      updatePreview();
      rememberCreativeInput();
    });
    creativeEditor.addEventListener('submit', rememberCreativeInput);
    function forgetCreativeInput() {
      try { sessionStorage.removeItem(storageKey); } catch { /* Browser storage can be disabled. */ }
      recovery.hidden = true;
    }
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey));
      if (typeof saved?.title === 'string' && typeof saved.text === 'string') {
        if (saved.title.trim() === creativeEditor.dataset.savedTitle && saved.text.trim() === creativeEditor.dataset.savedText) {
          forgetCreativeInput();
        } else if (saved.title !== title.value || saved.text !== text.value) {
          recovery.hidden = false;
          recovery.querySelector('[data-restore-creative]').addEventListener('click', () => {
            title.value = saved.title;
            text.value = saved.text;
            recovery.hidden = true;
            updatePreview();
            focusField(title);
          });
          recovery.querySelector('[data-discard-creative]').addEventListener('click', () => {
            forgetCreativeInput();
            focusField(title);
          });
        }
      }
    } catch { /* The current server-saved text is still available. */ }
  }

  for (const button of root.querySelectorAll('[data-copy-target]')) {
    const target = document.getElementById(button.dataset.copyTarget);
    const status = button.parentElement.querySelector('[data-copy-status]');
    button.hidden = false;
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(target.textContent);
        status.textContent = 'Номер скопирован.';
      } catch {
        const range = document.createRange();
        range.selectNodeContents(target);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        status.textContent = 'Номер выделен. Скопируйте его.';
      }
    });
  }
}

setupPanelControls(document);
window.addEventListener('pageshow', () => {
  document.querySelector('[data-period-submitting]')?.removeAttribute('data-period-submitting');
});

const account = document.querySelector('.topbar .account');
if (account) {
  const navigation = account.parentElement.querySelector('.nav');
  const compact = window.matchMedia('(max-width: 820px)');
  const updateHeaderOrder = () => {
    const first = compact.matches ? account : navigation;
    const second = compact.matches ? navigation : account;
    if (first.nextElementSibling === second) return;
    // Move the group without focus to preserve keyboard position during zoom and resize.
    if (first.contains(document.activeElement)) first.after(second);
    else second.before(first);
  };
  compact.addEventListener('change', updateHeaderOrder);
  updateHeaderOrder();

  const closeOutsideAccount = event => {
    if (account.open && !account.contains(event.target)) account.open = false;
  };
  document.addEventListener('focusin', closeOutsideAccount);
  document.addEventListener('pointerdown', closeOutsideAccount);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !account.open) return;
    event.preventDefault();
    account.open = false;
    account.querySelector('summary').focus();
  });
}

// The learning rule runs in the background. Update its status in place instead of
// reloading the page: focus, scroll position and screen-reader position stay put.
const demoStatus = document.querySelector('[data-demo-poll]');
if (demoStatus) {
  const demoDecision = document.querySelector('[data-demo-decision]');
  const dataset = demoStatus.dataset.demoPoll;
  let demoStopped = false, demoPolls = 0;
  async function pollDemo() {
    if (demoStopped) return;
    if (++demoPolls > 40) { demoStopped = true; return; }
    try {
      const response = await fetch('/demo/status?dataset=' + encodeURIComponent(dataset), { cache: 'no-store', signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw new Error('status');
      const data = await response.json();
      if (data.status) demoStatus.textContent = data.status;
      if (data.html && demoDecision) demoDecision.innerHTML = data.html;
      if (data.settled) { demoStopped = true; demoStatus.removeAttribute('data-demo-poll'); setTimeout(() => demoStatus.remove(), 800); return; }
    } catch { /* Keep the last known status: the page stays usable without a reload. */ }
    setTimeout(pollDemo, 1500);
  }
  setTimeout(pollDemo, 1000);
}
(() => {
  const form = document.querySelector('#campaign-form');
  const notice = document.querySelector('#notification');
  if ((location.pathname === '/connections/direct' && location.hash === '#metrika-title') ||
      (location.pathname === '/results' && location.hash === '#demo')) {
    for (const link of document.querySelectorAll('[data-login-return]')) {
      const login = new URL(link.href);
      const destination = login.searchParams.get('return');
      if (destination && !destination.includes('#') && (location.hash !== '#demo' || destination === '/results')) {
        login.searchParams.set('return', destination + location.hash);
        link.href = login.href;
      }
    }
  }
  const invalid = document.querySelector('[aria-invalid="true"]:not([hidden])');
  const fragment = ['#pilot-results-title', '#metrika-title'].includes(location.hash) ? document.querySelector(location.hash) : null;
  const target = invalid ?? document.querySelector('[data-page-focus]') ??
    (notice ? (notice.getAttribute('role') === 'alert' ? document.querySelector('[data-recovery]') : null) : fragment);
  if (target) focusField(target);
  else if (notice) notice.focus();
  if (!form) {
    if (location.pathname === '/' && location.hash === '#direct' && document.querySelector('nav.nav')) {
      location.replace('/campaign?ad=default#direct');
      return;
    }
    document.querySelector('[data-logout]')?.closest('form').addEventListener('submit', () => {
      try { sessionStorage.removeItem('goulash-work:' + document.body.dataset.scope); } catch { /* Storage disabled. */ }
    });
    return;
  }
  if (form.dataset.plan === '1') {
    const storageKey = 'goulash-plan:' + form.dataset.scope, recovery = document.querySelector('#recovery');
    const state = document.querySelector('#save-state'), label = state.textContent;
    const consents = new Set(['aiConsent', 'wordingConsent', 'researchConsent', 'judgeConsent', 'rejudgeConsent', 'confirmPlan', 'replace', 'manualReview']);
    const values = () => [...new FormData(form).entries()].filter(([key]) => !consents.has(key)).map(([key, value]) => [key, String(value)]);
    const initial = JSON.stringify(values());
    const editor = document.querySelector('[data-offer-editor]');
    if (editor) {
      setupOfferHelp(editor);
      const addButton = list => editor.querySelector(`[data-add-row="${list.dataset.editorList}"]`);
      function syncAdd(list) {
        const hasBlank = list.dataset.editorList !== 'offer' &&
          [...list.children].some(row => !row.querySelector('input:not([type=hidden])').value.trim());
        addButton(list).disabled = hasBlank || list.children.length >= Number(list.dataset.limit);
      }
      editor.querySelectorAll('[data-editor-list]').forEach(syncAdd);
      editor.addEventListener('input', event => {
        const list = event.target.closest('[data-editor-list]');
        if (list) syncAdd(list);
      });
      editor.addEventListener('click', event => {
        const button = event.target.closest('[data-add-row], [data-remove-row]');
        if (!button) return;
        event.preventDefault();
        const kind = button.dataset.addRow || button.closest('[data-editor-list]').dataset.editorList;
        const list = editor.querySelector(`[data-editor-list="${kind}"]`);
        const add = addButton(list);
        const row = button.closest('[data-editor-row]');
        let focus;
        if (row) {
          focus = row.nextElementSibling || row.previousElementSibling;
          row.remove();
        } else {
          if (add.disabled) return;
          focus = editor.querySelector(`[data-row-template="${kind}"]`).content.firstElementChild.cloneNode(true);
          list.append(focus);
        }
        Array.from(list.children).forEach((item, index) => {
          item.querySelector('[data-row-title]').textContent = list.dataset.label + ' ' + (index + 1);
          item.querySelectorAll('[name]:not(button), [id], [for], [aria-describedby]').forEach(node => {
            for (const attr of ['id', 'name', 'for', 'aria-describedby']) {
              const value = node.getAttribute(attr);
              if (value) node.setAttribute(attr, value.replace(/(?:\d+|__index__)(?=(?:-error)?(?:\s|$))/g, String(index)));
            }
          });
          const remove = item.querySelector('[data-remove-row]');
          remove.value = 'remove-' + kind + '-' + index;
          remove.setAttribute('aria-label', 'Удалить: ' + list.dataset.label + ' ' + (index + 1));
        });
        syncAdd(list);
        form.dispatchEvent(new Event('input', { bubbles: true }));
        (focus?.querySelector('input:not([type=hidden]), textarea') || add).focus();
      });
    }
    const adStep = setupAdStep(form);
    let dirty = form.dataset.dirty === '1', sending = false, leaving = false;
    const forwardSteps = document.querySelectorAll('[data-forward-step]');
    function syncForwardSteps() {
      forwardSteps.forEach(button => {
        button.disabled = dirty;
        button.title = dirty ? 'Сохраните изменения или нажмите «Далее»' : '';
      });
    }
    syncForwardSteps();
    function remember() {
      if (!recovery.hidden) return;
      try { if (dirty) sessionStorage.setItem(storageKey, JSON.stringify(values())); else sessionStorage.removeItem(storageKey); }
      catch { document.querySelector('#local-recovery-note').textContent = 'Временное хранение недоступно. Сохраните рабочий ввод перед уходом.'; }
    }
    try {
      if (form.dataset.ack === '1') {
        sessionStorage.removeItem(storageKey);
        const url = new URL(location.href);
        if (url.pathname !== '/prepare') url.pathname = '/campaign';
        const ad = form.elements.namedItem('ad')?.value;
        if (ad) url.searchParams.set('ad', ad);
        for (const key of ['preparation', 'campaign']) if (url.searchParams.get(key) === 'saved') url.searchParams.delete(key);
        url.searchParams.delete('research');
        history.replaceState(null, '', url.pathname + url.search + url.hash);
      }
      const raw = sessionStorage.getItem(storageKey);
      if (raw && raw !== initial && form.dataset.restored !== '1') {
        const restored = JSON.parse(raw);
        if (Array.isArray(restored)) {
          recovery.hidden = false;
          document.querySelector('#restore-work').addEventListener('click', () => {
            const target = document.createElement('form'); target.method = 'post'; target.action = form.dataset.resumeAction;
            restored.slice(0, 250).forEach(([name, value]) => {
              if (consents.has(name)) return;
              // A valid list can include spaces and line breaks beyond Direct's 4096 counted characters.
              const input = document.createElement('input'); input.type = 'hidden'; input.name = String(name).slice(0, 100); input.value = String(value).slice(0, name === 'negatives' ? 4096 + 20 * 7 : 4096); target.append(input);
            });
            document.body.append(target); sending = true; target.submit();
          });
        }
      }
    } catch { /* The server-saved workspace remains available. */ }
    document.querySelector('#discard-work').addEventListener('click', () => { try { sessionStorage.removeItem(storageKey); } catch {} recovery.hidden = true; });
    form.addEventListener('input', () => {
      recovery.hidden = true; dirty = form.dataset.dirty === '1' || JSON.stringify(values()) !== initial; remember(); state.textContent = dirty ? 'Есть несохранённые изменения' : label;
      syncForwardSteps();
    });
    form.addEventListener('submit', event => {
      if (sending) { event.preventDefault(); return; }
      if (event.submitter?.dataset.operation === 'example' && !window.confirm('Заменить исходные данные вымышленным примером? Ручной текст объявления сохранится.')) { event.preventDefault(); return; }
      if (adStep && !adStep.submit(event.submitter)) { event.preventDefault(); return; }
      dirty = true; recovery.hidden = true; remember(); sending = true;
      if (!event.submitter?.hasAttribute?.('data-research-submit')) form.setAttribute('aria-busy', 'true');
    });
    directForms(form).forEach(target => target.addEventListener('submit', event => {
      if (dirty || sending) { event.preventDefault(); state.textContent = 'Сначала сохраните изменения и подтвердите актуальный план.'; state.scrollIntoView({ block: 'center' }); return; }
      sending = true; target.setAttribute('aria-busy', 'true');
    }));
    window.addEventListener('beforeunload', event => { if (dirty && !sending && !leaving) { remember(); event.preventDefault(); event.returnValue = ''; } });
    document.querySelectorAll('a[href]').forEach(link => link.addEventListener('click', event => {
      if (!dirty || event.ctrlKey || event.metaKey || event.shiftKey || link.target === '_blank' || link.getAttribute('href').startsWith('#')) return;
      if (!window.confirm('Рабочий ввод ещё не сохранён. Перейти?')) { event.preventDefault(); return; }
      remember(); leaving = true;
    }));
    document.querySelector('[data-logout]')?.closest('form').addEventListener('submit', event => {
      if (dirty && !window.confirm('Выйти без сохранения? Ввод этой вкладки будет удалён.')) { event.preventDefault(); return; }
      try { sessionStorage.removeItem(storageKey); } catch {} leaving = true;
    });
    window.addEventListener('pageshow', () => { sending = false; leaving = false; form.removeAttribute('aria-busy'); });
    return;
  }
  const keys = ['description', 'url', 'region', 'budget', 'period', 'title', 'adText'];
  const storageKey = 'goulash-work:' + form.dataset.scope;
  let dirty = form.dataset.dirty === '1', submitting = false, leaving = false;
  const values = () => Object.fromEntries(keys.map(key => [key, form.elements.namedItem(key)?.value ?? '']));
  const initial = JSON.stringify(values());
  const state = document.querySelector('#save-state'), cleanLabel = state.textContent;
  let storageWorks = true;
  function remember() {
    // Until the user chooses, every exit path must preserve the offered recovery copy.
    if (!recovery.hidden) return;
    try {
      if (dirty) sessionStorage.setItem(storageKey, JSON.stringify({ values: values(), step: form.dataset.step, revision: form.elements.revision.value }));
      else sessionStorage.removeItem(storageKey);
    } catch {
      storageWorks = false;
      document.querySelector('#local-recovery-note').textContent = 'Браузер не разрешил временное хранение. Сохраните черновик перед уходом со страницы.';
    }
  }
  function paint() {
    keys.forEach(key => {
      const input = form.elements.namedItem(key);
      const preview = document.querySelector(`[data-preview="${key}"]`);
      if (preview && input) preview.textContent = key === 'budget' ? (/^\d+$/.test(input.value) ? Number(input.value).toLocaleString('ru-RU') + ' ₽' : 'Укажите бюджет') : key === 'period' ? input.value + ' дней' : input.value || 'Не заполнено';
      const counter = input?.id && document.querySelector(`[data-count-for="${input.id}"]`);
      if (counter) counter.textContent = input.value.length + ' / ' + input.maxLength;
    });
    state.textContent = dirty ? 'Есть несохранённые изменения' : cleanLabel;
    state.classList.toggle('dirty', dirty);
  }
  let recovered;
  try {
    if (form.dataset.saved === '1') {
      sessionStorage.removeItem(storageKey);
      // Consume the save acknowledgement once: a later reload must not delete newly typed work.
      const url = new URL(location.href); url.searchParams.delete('campaign');
      if (url.pathname === '/') url.pathname = '/campaign';
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
    const raw = sessionStorage.getItem(storageKey);
    if (raw) recovered = JSON.parse(raw);
  } catch { storageWorks = false; }
  const recovery = document.querySelector('#recovery');
  if (form.dataset.restore === '1' && recovered?.values && recovered?.revision !== undefined &&
      (JSON.stringify(recovered.values) !== initial || String(recovered.revision) !== form.elements.revision.value)) {
    recovery.hidden = false;
    document.querySelector('#restore-work').addEventListener('click', () => {
      const restore = document.createElement('form'); restore.method = 'post'; restore.action = form.dataset.resumeAction;
      const payload = { ...Object.fromEntries(keys.map(key => [key, String(recovered.values[key] ?? '').slice(0, 4096)])), revision: String(recovered.revision), step: String(recovered.step) };
      Object.entries(payload).forEach(([name, value]) => { const input = document.createElement('input'); input.type = 'hidden'; input.name = name; input.value = value; restore.append(input); });
      document.body.append(restore); submitting = true; restore.submit();
    });
    document.querySelector('#discard-work').addEventListener('click', () => {
      try { sessionStorage.removeItem(storageKey); } catch { /* Browser storage can be disabled. */ }
      recovery.hidden = true;
    });
  }
  // A direct example URL must not overwrite the prior working copy before the user chooses.
  if (dirty && recovery.hidden) remember();
  if (!storageWorks) document.querySelector('#local-recovery-note').textContent = 'Временное хранение недоступно. Сохраните черновик перед уходом со страницы.';
  form.addEventListener('input', () => { recovery.hidden = true; dirty = form.dataset.dirty === '1' || JSON.stringify(values()) !== initial; paint(); remember(); });
  form.querySelectorAll('[data-use-proposal]').forEach(button => {
    button.hidden = false;
    button.addEventListener('click', () => {
      form.elements.title.value = button.dataset.title; form.elements.adText.value = button.dataset.text;
      dirty = true; paint(); remember(); form.elements.title.focus();
    });
  });
  form.addEventListener('submit', event => {
    if (submitting) { event.preventDefault(); return; }
    if (event.submitter?.dataset.operation === 'example' &&
        !window.confirm('Заменить исходные данные тестовым примером? Несохранённое описание, адрес, география и бюджет будут заменены. Ваши формулировки объявления останутся.')) {
      event.preventDefault(); return;
    }
    recovery.hidden = true; dirty = true; remember(); submitting = true;
    form.setAttribute('aria-busy', 'true');
    if (event.submitter) event.submitter.setAttribute('aria-disabled', 'true');
  });
  directForms(form).forEach(directForm => directForm.addEventListener('submit', event => {
    if (dirty) {
      event.preventDefault();
      state.textContent = 'Сначала сохраните изменения черновика выше. Затем вернитесь к Директу.';
      state.scrollIntoView({ block: 'center' });
      return;
    }
    if (submitting) { event.preventDefault(); return; }
    submitting = true;
    directForm.setAttribute('aria-busy', 'true');
    if (event.submitter) event.submitter.setAttribute('aria-disabled', 'true');
  }));
  window.addEventListener('beforeunload', event => {
    if (dirty && !submitting && !leaving) { remember(); event.preventDefault(); event.returnValue = ''; }
  });
  document.querySelectorAll('a[href]').forEach(link => link.addEventListener('click', event => {
    if (!dirty || event.ctrlKey || event.metaKey || event.shiftKey || link.getAttribute('href').startsWith('#')) return;
    if (!window.confirm(storageWorks ? 'Изменения ещё не сохранены. Перейти? Ввод можно будет восстановить в этой вкладке.' : 'Изменения ещё не сохранены. При переходе ввод может быть потерян. Перейти?')) { event.preventDefault(); return; }
    remember(); leaving = true;
  }));
  document.querySelector('[data-logout]')?.closest('form').addEventListener('submit', event => {
    if (dirty && !window.confirm('Выйти без сохранения? Несохранённый ввод этого аккаунта будет удалён.')) { event.preventDefault(); return; }
    try { sessionStorage.removeItem(storageKey); } catch { /* Nothing persisted. */ }
    leaving = true;
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) { submitting = false; leaving = false; form.removeAttribute('aria-busy'); form.querySelectorAll('[aria-disabled]').forEach(el => el.removeAttribute('aria-disabled')); }
  });
  paint();
})();

function setupAdStep(form) {
  const section = document.querySelector('[data-ad-step]');
  if (!section) return;
  const editors = [];
  const keyOf = value => value.trim().toLocaleLowerCase('ru').replaceAll('ё','е').split(/\s+/u).sort().join(' ');
  const separator = /[,\r\n]+/u;
  const entries = text => text.split(separator).map(value => value.trim().replace(/ +/gu, ' ')).filter(Boolean);
  for (const editor of section.querySelectorAll('[data-phrase-editor]')) {
    const source = editor.querySelector('textarea'), label = editor.querySelector('label');
    const negative = source.name === 'negatives';
    const limit = negative ? 20 : 30;
    let phrases = entries(source.value);
    const list = document.createElement('ul');
    list.className = 'phrase-items';
    list.setAttribute('aria-label', label.textContent);
    const row = document.createElement('div');
    row.className = 'phrase-input-row';
    const input = document.createElement('input');
    input.id = source.id + '-input';
    input.type = 'text';
    input.placeholder = source.placeholder;
    input.autocomplete = 'off';
    label.htmlFor = input.id;
    const error = document.getElementById(source.id + '-error') ?? document.createElement('p');
    error.id = source.id + '-error';
    error.className = 'phrase-error';
    error.setAttribute('role', 'status');
    input.setAttribute('aria-describedby', source.id + '-hint ' + error.id);
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'secondary';
    add.textContent = 'Добавить';
    row.append(input, add);
    editor.append(list, row, error);
    if (source.getAttribute('aria-invalid') === 'true') input.setAttribute('aria-invalid', 'true');
    source.hidden = true;

    function sync() {
      source.value = [...phrases, ...entries(input.value)].join('\n');
      source.dispatchEvent(new Event('input', {bubbles:true}));
    }
    function render() {
      list.replaceChildren();
      phrases.forEach((phrase,index) => {
        const item = document.createElement('li'), text = document.createElement('span'), remove = document.createElement('button');
        text.textContent = phrase;
        remove.type = 'button';
        remove.textContent = '×';
        remove.setAttribute('aria-label', 'Удалить «' + phrase + '»');
        remove.addEventListener('click', () => {
          phrases.splice(index,1);
          error.textContent = '';
          render(); sync();
          (list.children[index]?.querySelector('button') || input).focus();
        });
        item.append(text,remove); list.append(item);
      });
      add.disabled = !input.value.trim();
    }
    function validate(items) {
      if (items.length > limit) return 'Максимум фраз в этом списке: ' + limit + '.';
      if (items.some(phrase => {
        const words = phrase.split(/\s+/u);
        return !/^[\p{L}\p{N} ]+$/u.test(phrase) || words.length > 7 || words.some(word => word.length > 35);
      })) return 'Укажите до 7 слов, до 35 символов в каждом. Используйте буквы, цифры и пробелы.';
      if (negative && items.reduce((length, phrase) => length + phrase.replaceAll(' ', '').length, 0) > 4096)
        return 'Общая длина минус-фраз — до 4096 символов без пробелов.';
      if (!negative && items.some(phrase => phrase.length > 100)) return 'Укажите до 100 символов в каждой поисковой фразе.';
      if (new Set(items.map(keyOf)).size !== items.length) return 'Такая фраза уже есть в списке.';
      return '';
    }
    function commit(additions) {
      const next = [...phrases, ...additions];
      const message = validate(next);
      if (message) { showFieldError(input, message); focusField(input); return false; }
      clearFieldError(input);
      phrases = next; input.value = ''; render(); sync(); input.focus(); return true;
    }
    input.addEventListener('input', () => { add.disabled = !input.value.trim(); sync(); });
    input.addEventListener('paste', event => {
      const pasted = event.clipboardData?.getData('text');
      if (!pasted || !separator.test(pasted)) return;
      event.preventDefault();
      const raw = input.value.slice(0,input.selectionStart) + pasted + input.value.slice(input.selectionEnd);
      commit(entries(raw));
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); if (input.value.trim()) commit(entries(input.value)); }
    });
    add.addEventListener('click', () => commit(entries(input.value)));
    editors.push({source, input, error, validate: () => validate(entries(source.value))});
    render();
  }
  const picker = section.querySelector('.candidate-picker');
  picker?.addEventListener('change', () => {
    picker.querySelector('[data-selected-count]').textContent = picker.querySelectorAll('[name=selected]:checked').length;
  });

  let timer, inProgress = false;
  const progress = section.querySelector('[data-research-progress]');
  const researchButton = section.querySelector('[data-research-submit]');
  function leaveWait() {
    inProgress = false;
    clearTimeout(timer);
    if (researchButton) {
      researchButton.removeAttribute('data-sending');
      researchButton.removeAttribute('aria-disabled');
    }
    if (progress) progress.hidden = true;
  }
  window.addEventListener('pageshow',leaveWait);
  window.addEventListener('pagehide',leaveWait);
  function startWait() {
    inProgress = true;
    progress.hidden = false;
    const status = progress.querySelector('p'), saved = progress.querySelector('a');
    status.textContent = 'Проверяем регион для подбора…';
    saved.hidden = true;
    const revision = form.elements.namedItem('preparationRevision').value;
    const ad = form.elements.namedItem('ad')?.value;
    const query = new URLSearchParams({ revision, ...(ad ? { ad } : {}) });
    const start = Date.now();
    async function update() {
      if (!inProgress) return;
      try {
        const response = await fetch('/preparation/research-status?' + query, {cache:'no-store', signal:AbortSignal.timeout(4000)});
        if (!response.ok) throw new Error('status');
        const data = await response.json();
        if (!inProgress) return;
        const messages = {
          region: 'Проверяем регион для подбора…',
          wordstat: 'Wordstat проверяет запросы. Готово направлений: ' + data.done + ' из ' + data.total + '.',
          deepseek: 'DeepSeek проверяет, какие запросы подходят вашему объявлению…',
          complete: 'Подбор завершён. Открываем сохранённые фразы…',
          stopped: 'Подбор остановлен. Открываем полученные результаты…'
        };
        status.textContent = messages[data.phase] || 'Ожидаем ответ сервиса…';
      } catch {
        if (!inProgress) return;
        status.textContent = 'Пока нет сведений о ходе подбора. Результат можно проверить в кабинете.';
        saved.hidden = false;
      }
      if (Date.now() - start > 8000) saved.hidden = false;
      if (Date.now() - start > 180000) {
        status.textContent = 'Ответ задержался. Откройте сохранённое состояние перед новой попыткой.';
        return;
      }
      if (inProgress) timer = setTimeout(update,1800);
    }
    timer = setTimeout(update,700);
  }
  return {
    submit(button) {
      const action = button?.hasAttribute('formaction') ? button.dataset.operation : form.dataset.operation;
      if (button?.hasAttribute('data-research-submit')) {
        const missing = ['researchConsent','judgeConsent'].map(name=>form.elements.namedItem(name)).find(box=>!box?.checked);
        if (missing) {
          progress.hidden = false;
          progress.querySelector('p').textContent = 'Для подбора подтвердите оба запроса к источникам.';
          showFieldError(missing, 'Подтвердите этот запрос к источнику.');
          focusField(missing);
          return false;
        }
        button.setAttribute('data-sending', 'true');
        button.setAttribute('aria-disabled', 'true');
        startWait();
      }
      if (action === 'offer') {
        for (const editor of editors) {
          const message = editor.validate();
          if (message) {
            showFieldError(editor.input, message); focusField(editor.input); return false;
          }
        }
        const manual = editors.find(editor=>editor.source.name==='phrases');
        if (!manual.source.value.trim() && !section.querySelector('[name=selected]:checked')) {
          showFieldError(manual.input, 'Добавьте хотя бы одну поисковую фразу.');
          focusField(manual.input); return false;
        }
      }
      return true;
    }
  };
}

function setupCampaignTabs() {
  const main = document.querySelector('main[data-campaign-id]');
  const navigation = main?.querySelector('.guided-tabs');
  if (!navigation) return;

  const tabs = [...navigation.querySelectorAll('a')];
  const sameCampaign = url => url.origin === location.origin
    && url.searchParams.get('ad') === main.dataset.campaignId
    && tabs.some(tab => new URL(tab.href).pathname === url.pathname);
  const route = url => url.pathname + url.search;
  if (!sameCampaign(new URL(location.href))) return;

  let renderedRoute = route(location);
  let pending;
  async function loadTab(url, backOrForward = false) {
    const replacing = Boolean(pending);
    pending?.abort();
    let panel = main.querySelector('[data-campaign-panel]');
    if (route(url) === renderedRoute && !replacing) {
      panel.removeAttribute('aria-busy');
      if (!backOrForward && url.href !== location.href) location.assign(url.href);
      return;
    }

    const request = new AbortController();
    pending = request;
    panel.setAttribute('aria-busy', 'true');
    try {
      const savePeriod = periodBeforeNavigation.get(panel.querySelector('#analytics-filters'));
      if (!backOrForward && savePeriod && !await savePeriod()) return;
      if (request.signal.aborted) return;
      const response = await fetch(url, { signal: request.signal, redirect: 'manual' });
      if (!response.ok) throw new Error('Campaign view unavailable');
      const incoming = new DOMParser().parseFromString(await response.text(), 'text/html');
      if (request.signal.aborted) return;

      const nextMain = incoming.querySelector('main[data-campaign-id]');
      const nextPanel = nextMain?.querySelector('[data-campaign-panel]');
      const nextHeading = nextMain?.querySelector('[data-campaign-heading]');
      const nextTab = nextMain?.querySelector('.guided-tabs [aria-current="page"]');
      const tab = tabs.find(link => link.id === nextTab?.id);
      if (incoming.body.dataset.scope !== document.body.dataset.scope
        || nextMain?.dataset.campaignId !== main.dataset.campaignId || !nextPanel || !nextHeading || !tab) {
        throw new Error('Campaign context changed');
      }

      if (!backOrForward && url.href !== location.href) history.pushState(null, '', url.href);
      renderedRoute = route(url);
      document.title = incoming.title;
      const heading = main.querySelector('[data-campaign-heading]');
      if (!heading.isEqualNode(nextHeading)) heading.replaceWith(nextHeading);
      for (const link of tabs) {
        if (link === tab) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      }
      const connection = incoming.querySelector('[data-campaign-connection]');
      if (connection) {
        const target = connection.getAttribute('href');
        document.querySelectorAll('[data-campaign-connection]').forEach(link => link.setAttribute('href', target));
      }
      const accountState = document.querySelector('.account-state');
      const nextAccountState = incoming.querySelector('.account-state');
      if (accountState && nextAccountState && !accountState.isEqualNode(nextAccountState)) {
        accountState.replaceWith(nextAccountState);
      }
      const footer = document.querySelector('.footer-inner');
      const nextFooter = incoming.querySelector('.footer-inner');
      if (footer && nextFooter && !footer.isEqualNode(nextFooter)) footer.replaceWith(nextFooter);
      panel.replaceWith(nextPanel);
      panel = nextPanel;
      setupPanelControls(panel);
      panel.focus({ preventScroll: true });
      if (url.hash) revealCampaignAnchor(url.hash);
    } catch {
      if (request.signal.aborted) return;
      if (backOrForward) location.reload();
      else location.assign(url.href);
    } finally {
      if (pending === request) {
        pending = undefined;
        panel.removeAttribute('aria-busy');
      }
    }
  }

  main.addEventListener('click', event => {
    const link = event.target.closest('.guided-tabs a, .campaign-journal-filters a');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const url = new URL(link.href);
    if (!sameCampaign(url)) return;
    event.preventDefault();
    void loadTab(url);
  });
  window.addEventListener('popstate', () => {
    const url = new URL(location.href);
    if (sameCampaign(url)) void loadTab(url, true);
  });
  window.addEventListener('pagehide', () => pending?.abort());
  window.addEventListener('hashchange', () => revealCampaignAnchor(location.hash));
  if (location.hash) revealCampaignAnchor(location.hash);
}

function revealCampaignAnchor(hash) {
  const target = document.getElementById(hash.slice(1));
  if (!target?.closest('[data-campaign-panel]')) return;
  for (let details = target.closest('details'); details; details = details.parentElement.closest('details')) details.open = true;
  target.scrollIntoView();
}
setupCampaignTabs();
