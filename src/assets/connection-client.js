(() => {
  const settings = document.querySelector('[data-connections]');
  if (!settings) return;
  const panels = new Map([...settings.querySelectorAll('[data-connection-panel]')].map(panel => [panel.dataset.connectionPanel, panel]));
  const fragments = { '#connect-title': 'direct', '#metrika-title': 'metrika', '#metrika-counter': 'metrika', '#metrika-goal': 'metrika', '#advertiser-title': 'advertiser' };
  let active, confirmation, pressedOutside, closing = false;
  let inspection, lookup, loadingChoices = false, saving = false, choices;
  let savedPair;
  const opener = key => settings.querySelector(`.connection-card [data-open-connection="${key}"]`);
  const pair = () => panels.get('metrika')?.querySelector('[data-metrika-pair]');
  const openKey = () => active?.dataset.connectionPanel;
  const announce = (form, message, error = false) => {
    const status = form.querySelector('[data-measurement-feedback]');
    status.textContent = message;
    status.toggleAttribute('data-error', error);
  };

  function finishConfirmation(refocus = false) {
    if (!confirmation) return;
    const { dialog, node, details, title, footer } = confirmation;
    details.append(node);
    node.querySelector('[data-cancel-confirm]').hidden = true;
    dialog.querySelector('.connection-dialog-body').hidden = false;
    if (footer) footer.hidden = false;
    dialog.querySelector('h2').textContent = title;
    delete dialog.dataset.confirming;
    confirmation = undefined;
    if (refocus) details.querySelector('summary').focus();
  }

  function hide(refocus = true) {
    if (!active) return;
    const key = openKey();
    finishConfirmation();
    inspection?.abort();
    lookup?.abort();
    if (key === 'metrika' && !saving) restorePair();
    active.close();
    active = undefined;
    if (refocus) opener(key)?.focus({ preventScroll: true });
  }

  function dismiss() {
    if (closing || !active) return;
    if (history.state?.connectionPanel) {
      closing = true;
      history.back();
    } else hide();
  }

  function show(key, setHistory) {
    const next = panels.get(key);
    if (!next || next === active) return;
    const replacing = Boolean(active);
    if (active) hide(false);
    if (setHistory) {
      const state = { ...history.state, connectionPanel: key };
      if (replacing) history.replaceState(state, '', opener(key).href);
      else history.pushState(state, '', opener(key).href);
    }
    document.body.style.setProperty('--connection-scroll-space', `${innerWidth - document.documentElement.clientWidth}px`);
    active = next;
    active.showModal();
    const field = active.querySelector('[aria-invalid="true"]');
    const target = field ?? active.querySelector('[data-close-connection]');
    target.focus({ preventScroll: !field });
    if (key === 'metrika') { rememberPair(pair()); loadChoices(); }
    if (key === 'advertiser') loadAdvertiser();
  }

  const requested = panels.has(history.state?.connectionPanel) ? history.state.connectionPanel
    : [...panels].find(([, panel]) => panel.open)?.[0] ?? fragments[location.hash];
  for (const dialog of panels.values()) if (dialog.open) dialog.removeAttribute('open');
  if (requested && panels.has(requested)) {
    const anchor = fragments[location.hash] && document.getElementById(location.hash.slice(1));
    if (!history.state?.connectionPanel) history.replaceState(history.state, '', panels.get(requested).querySelector('[data-close-connection]').href);
    const notice = document.querySelector('#notification[role="alert"]');
    if (notice) panels.get(requested).querySelector('.connection-dialog-body').prepend(notice);
    show(requested, !history.state?.connectionPanel);
    if (anchor && !active.querySelector('[aria-invalid="true"]')) anchor.focus({ preventScroll: true });
  }
  addEventListener('popstate', () => {
    closing = false;
    if (panels.has(history.state?.connectionPanel)) show(history.state.connectionPanel, false);
    else hide();
  });
  addEventListener('hashchange', () => {
    const key = fragments[location.hash];
    if (panels.has(key) && !active) {
      const anchor = document.getElementById(location.hash.slice(1));
      history.replaceState(history.state, '', panels.get(key).querySelector('[data-close-connection]').href);
      show(key, true);
      anchor?.focus({ preventScroll: true });
    }
  });

  settings.addEventListener('click', event => {
    const control = event.target.closest('[data-open-connection],[data-close-connection],.connection-disconnect>summary,[data-cancel-confirm]');
    if (!control || event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (control.hasAttribute('data-open-connection')) show(control.dataset.openConnection, true);
    else if (control.hasAttribute('data-close-connection')) dismiss();
    else if (control.hasAttribute('data-cancel-confirm')) finishConfirmation(true);
    else if (!saving) {
      const details = control.parentElement;
      const node = details.querySelector('.connection-confirm');
      const heading = active.querySelector('h2');
      const footer = active.querySelector('.connection-dialog-actions');
      confirmation = { dialog: active, details, node, title: heading.textContent, footer };
      details.open = false;
      heading.textContent = node.dataset.confirmTitle;
      active.dataset.confirming = '';
      active.querySelector('.connection-dialog-body').hidden = true;
      if (footer) footer.hidden = true;
      active.append(node);
      const cancel = node.querySelector('[data-cancel-confirm]');
      cancel.hidden = false;
      cancel.focus();
    }
  });

  const outside = event => {
    if (event.target !== active) return false;
    const bounds = active.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX >= bounds.right || event.clientY < bounds.top || event.clientY >= bounds.bottom;
  };
  settings.addEventListener('pointerdown', event => { pressedOutside = active && outside(event); });
  settings.addEventListener('click', event => {
    if (pressedOutside && active && outside(event)) dismiss();
    pressedOutside = false;
  });
  settings.addEventListener('keydown', event => {
    const tip = event.key === 'Escape' && active?.querySelector('.connection-tip:popover-open');
    if (tip) { event.preventDefault(); tip.hidePopover(); }
  });
  settings.addEventListener('cancel', event => {
    if (event.target !== active) return;
    event.preventDefault();
    if (confirmation) finishConfirmation(true);
    else dismiss();
  }, true);

  function placeTip() {
    const tip = active?.querySelector('.connection-tip:popover-open');
    if (!tip) return;
    const anchor = active.querySelector(`[popovertarget="${tip.id}"]`).getBoundingClientRect();
    const body = active.querySelector('.connection-dialog-body').getBoundingClientRect();
    if (anchor.bottom <= body.top || anchor.top >= body.bottom) return tip.hidePopover();
    const { width, height, offsetLeft: x, offsetTop: y } = window.visualViewport ?? { width: innerWidth, height: innerHeight, offsetLeft: 0, offsetTop: 0 };
    const edge = 12;
    tip.dataset.positioned = '';
    tip.style.maxWidth = `${width - edge * 2}px`;
    const below = anchor.bottom + 7;
    tip.style.left = `${Math.max(x + edge, Math.min(anchor.left, x + width - tip.offsetWidth - edge))}px`;
    tip.style.top = `${below + tip.offsetHeight <= y + height - edge ? below : Math.max(y + edge, anchor.top - tip.offsetHeight - 7)}px`;
  }
  settings.addEventListener('toggle', event => {
    if (!event.target.matches('.connection-tip')) return;
    if (event.newState === 'open') placeTip();
    else {
      delete event.target.dataset.positioned;
      event.target.removeAttribute('style');
    }
  }, true);
  settings.addEventListener('scroll', placeTip, true);
  addEventListener('resize', placeTip);
  visualViewport?.addEventListener('resize', placeTip);
  visualViewport?.addEventListener('scroll', placeTip);

  function post(form, { url = form.action, fields = new FormData(form), signal, json = false } = {}) {
    return fetch(url, { method: 'POST', body: new URLSearchParams(fields), signal, headers: json ? { Accept: 'application/json' } : {} });
  }

  async function readJSON(response) {
    const content = response.headers.get('Content-Type') ?? '';
    if (!content.startsWith('application/json')) throw new Error('Откройте подключения заново и повторите действие.');
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Метрика недоступна. Повторите чтение.');
    return result;
  }

  function updateCounterOption(select, id, text) {
    const option = [...select.options].find(entry => entry.value === id);
    if (option) option.text = text;
    else select.add(new Option(text, id));
  }

  function showChoices(form) {
    for (const counter of choices ?? []) updateCounterOption(form.elements.counterId, counter.id, `${counter.name || counter.domain} · ${counter.id}`);
    if (choices?.length === 0 && !form.elements.counterId.value && !inspection && !saving)
      announce(form, 'У этого аккаунта нет доступных счётчиков. Проверьте права в Яндекс Метрике или укажите номер счётчика.');
  }

  async function loadChoices() {
    const form = pair();
    if (!form?.hasAttribute('data-counter-list')) return;
    if (choices) return showChoices(form);
    if (loadingChoices) return;
    loadingChoices = true;
    try {
      const url = new URL(form.action);
      url.pathname = url.pathname.replace(/\/configure$/, '/choices');
      choices = (await readJSON(await post(form, { url, json: true }))).counters;
      const current = pair();
      if (current) showChoices(current);
    } catch (error) {
      if (pair() === form && !inspection && !saving && !form.elements.counterId.value)
        announce(form, `${error.message} Можно указать номер счётчика.`, true);
    } finally { loadingChoices = false; }
  }

  function updateMeasurementControls(form) {
    const { counterId, goalId } = form.elements;
    const label = goalId.nextElementSibling;
    label.textContent = goalId.selectedOptions[0]?.text ?? '';
    label.hidden = !label.textContent;
    const enable = form.querySelector('[data-enable-metrika]');
    if (enable) enable.disabled = saving || !counterId.value || !goalId.value;
  }

  function rememberPair(form) {
    if (!form || savedPair?.form === form) return;
    const { counterId, goalId } = form.elements;
    savedPair = { form, counter: counterId.value, goal: goalId.value, options: [...goalId.options].map(option => option.cloneNode(true)),
      feedback: form.querySelector('[data-measurement-feedback]').textContent };
  }

  function restorePair() {
    const form = pair();
    if (!savedPair || savedPair.form !== form) return;
    const { counterId, goalId } = form.elements;
    counterId.value = savedPair.counter;
    goalId.replaceChildren(...savedPair.options.map(option => option.cloneNode(true)));
    goalId.value = savedPair.goal;
    announce(form, savedPair.feedback);
    updateMeasurementControls(form);
  }

  async function inspectCounter(id, manualForm) {
    inspection?.abort();
    const form = pair();
    const { counterId, goalId } = form.elements;
    goalId.replaceChildren(new Option('Выберите цель', ''));
    goalId.disabled = Boolean(id);
    updateMeasurementControls(form);
    if (!id) { inspection = undefined; announce(form, 'Выберите счётчик.'); return; }
    const request = new AbortController();
    inspection = request;
    const inspect = manualForm ?? panels.get('metrika').querySelector('[data-inspect-counter]');
    const fields = new FormData(inspect);
    fields.set('counterId', id);
    announce(form, 'Загружаем цели счётчика…');
    try {
      const result = await readJSON(await post(inspect, { fields, signal: request.signal, json: true }));
      if (request.signal.aborted || form !== pair()) return;
      if (![...counterId.options].some(option => option.value === id)) updateCounterOption(counterId, id, `${result.name || result.domain} · ${id}`);
      counterId.value = id;
      for (const goal of result.goals) goalId.add(new Option(goal.name, goal.id));
      announce(form, result.goals.length ? 'Выберите цель для нового счётчика.' : 'У счётчика пока нет доступных целей.');
      if (manualForm && result.goals.length) {
        manualForm.closest('details').open = false;
        goalId.disabled = false;
        goalId.focus();
      }
    } catch (error) {
      if (!request.signal.aborted && form === pair()) {
        counterId.value = '';
        announce(form, error.message, true);
      }
    } finally {
      if (inspection === request) { inspection = undefined; goalId.disabled = false; }
    }
  }

  function refreshPanels(doc, keys) {
    for (const key of keys) {
      const fresh = doc.getElementById(`connection-${key}`);
      if (!fresh || !fresh.previousElementSibling?.classList.contains('connection-card')) throw new Error('Откройте подключения заново и проверьте настройки.');
      const current = panels.get(key);
      current.previousElementSibling.replaceWith(fresh.previousElementSibling);
      current.replaceChildren(...fresh.childNodes);
      if (key === 'metrika') enhanceMetrika(current);
    }
  }

  function enhanceMetrika(panel) {
    for (const control of panel.querySelectorAll('[data-metrika-native]')) control.hidden = true;
    for (const control of panel.querySelectorAll('[data-metrika-enhanced]')) control.hidden = false;
  }

  async function readPage(response) {
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    if (!response.ok) throw new Error(doc.querySelector('#notification p')?.textContent || 'Откройте подключения заново и повторите действие.');
    return doc;
  }

  async function loadAdvertiser() {
    const form = panels.get('advertiser')?.querySelector('[data-advertiser-lookup]');
    if (!form || lookup || saving) return;
    const request = new AbortController();
    lookup = request;
    const action = form.querySelector('button');
    action.disabled = true;
    try {
      const doc = await readPage(await post(form, { signal: request.signal }));
      if (!request.signal.aborted && openKey() === 'advertiser') {
        const closeFocused = document.activeElement?.hasAttribute('data-close-connection');
        refreshPanels(doc, ['advertiser']);
        if (closeFocused) active.querySelector('[data-close-connection]').focus();
      }
    } catch (error) {
      if (!request.signal.aborted) {
        const status = panels.get('advertiser')?.querySelector('[data-advertiser-status]');
        if (status) status.textContent = error.message;
      }
    } finally { lookup = undefined; action.disabled = false; }
  }

  async function savePair(form, submitter) {
    if (saving || inspection || !form.elements.counterId.value || !form.elements.goalId.value) return;
    const fields = new FormData(form, submitter);
    const modal = panels.get('metrika');
    const focusId = modal.contains(document.activeElement) ? document.activeElement.id : '';
    const controls = [...modal.querySelectorAll('input,select,button[type="submit"]')].filter(control => !control.disabled);
    saving = true;
    for (const control of controls) control.disabled = true;
    announce(form, 'Сохраняем настройки…');
    try {
      const doc = await readPage(await post(form, { fields }));
      finishConfirmation();
      refreshPanels(doc, [...panels.keys()]);
      const fresh = pair();
      if (!fresh) throw new Error('Откройте подключения заново и проверьте настройки.');
      showChoices(fresh);
      rememberPair(fresh);
      announce(fresh, fields.has('enable') ? 'Чтение отчётов включено.' : 'Настройки сохранены.');
      if (openKey() === 'metrika') (document.getElementById(focusId) ?? fresh.elements.goalId).focus({ preventScroll: true });
    } catch (error) {
      if (openKey() === 'metrika' && form === pair()) {
        announce(form, error.message, true);
        const retry = form.querySelector('[data-retry-metrika-save]');
        if (retry) {
          retry.parentElement.querySelector('[formaction]').hidden = true;
          retry.parentElement.hidden = false;
        }
      } else restorePair();
    }
    finally {
      saving = false;
      for (const control of controls) control.disabled = false;
      if (pair()) updateMeasurementControls(pair());
      if (openKey() === 'advertiser') loadAdvertiser();
    }
  }

  settings.addEventListener('change', event => {
    const field = event.target;
    if (field.hasAttribute('data-connection-scope')) location.assign(field.value);
    else if (field.id === 'metrika-counter') void inspectCounter(field.value);
    else if (field.id === 'metrika-goal') {
      const form = pair();
      updateMeasurementControls(form);
      if (form.hasAttribute('data-reading') && field.value) void savePair(form);
    }
  });

  settings.addEventListener('submit', event => {
    const form = event.target;
    if (form.matches('[data-inspect-counter]')) {
      event.preventDefault();
      void inspectCounter(form.elements.counterId.value, form);
    } else if (form.matches('[data-metrika-pair]')) {
      event.preventDefault();
      void savePair(form, event.submitter);
    } else if (saving && openKey() === 'metrika') event.preventDefault();
  });
  if (pair()) {
    updateMeasurementControls(pair());
    enhanceMetrika(panels.get('metrika'));
  }
})();
