(() => {
  const form = document.querySelector('#campaign-form');
  const notice = document.querySelector('#notification');
  if (notice) notice.focus();
  const invalid = document.querySelector('[aria-invalid="true"]');
  if (invalid) invalid.focus();
  if (!form) {
    document.querySelector('[data-logout]')?.closest('form').addEventListener('submit', () => {
      try { sessionStorage.removeItem('goulash-work:' + document.body.dataset.scope); } catch { /* Storage disabled. */ }
    });
    return;
  }
  if (form.dataset.plan === '1') {
    const storageKey = 'goulash-plan:' + form.dataset.scope, recovery = document.querySelector('#recovery');
    const state = document.querySelector('#save-state'), label = state.textContent;
    const consents = new Set(['aiConsent', 'researchConsent', 'judgeConsent', 'rejudgeConsent', 'confirmPlan', 'replace', 'manualReview']);
    const values = () => [...new FormData(form).entries()].filter(([key]) => !consents.has(key)).map(([key, value]) => [key, String(value)]);
    const initial = JSON.stringify(values());
    let dirty = form.dataset.dirty === '1', sending = false, leaving = false;
    function remember() {
      if (!recovery.hidden) return;
      try { if (dirty) sessionStorage.setItem(storageKey, JSON.stringify(values())); else sessionStorage.removeItem(storageKey); }
      catch { document.querySelector('#local-recovery-note').textContent = 'Временное хранение недоступно. Сохраните рабочий ввод перед уходом.'; }
    }
    try {
      if (form.dataset.ack === '1') {
        sessionStorage.removeItem(storageKey);
        const url = new URL(location.href);
        for (const key of ['preparation', 'campaign']) if (url.searchParams.get(key) === 'saved') url.searchParams.delete(key);
        history.replaceState(null, '', url.pathname + url.search + url.hash);
      }
      const raw = sessionStorage.getItem(storageKey);
      if (raw && raw !== initial && form.dataset.restored !== '1') {
        const restored = JSON.parse(raw);
        if (Array.isArray(restored)) {
          recovery.hidden = false;
          document.querySelector('#restore-work').addEventListener('click', () => {
            const target = document.createElement('form'); target.method = 'post'; target.action = '/preparation/resume';
            restored.slice(0, 250).forEach(([name, value]) => {
              if (consents.has(name)) return;
              const input = document.createElement('input'); input.type = 'hidden'; input.name = String(name).slice(0, 100); input.value = String(value).slice(0, 4096); target.append(input);
            });
            document.body.append(target); sending = true; target.submit();
          });
        }
      }
    } catch { /* The server-saved workspace remains available. */ }
    document.querySelector('#discard-work').addEventListener('click', () => { try { sessionStorage.removeItem(storageKey); } catch {} recovery.hidden = true; });
    form.addEventListener('input', () => {
      recovery.hidden = true; dirty = form.dataset.dirty === '1' || JSON.stringify(values()) !== initial; remember(); state.textContent = dirty ? 'Есть несохранённые изменения' : label;
      ['title', 'adText', 'url'].forEach(name => { const node = document.querySelector('[data-preview="' + name + '"]'); if (node) node.textContent = form.elements.namedItem(name)?.value || ''; });
    });
    form.addEventListener('submit', event => {
      if (sending) { event.preventDefault(); return; }
      if (event.submitter?.getAttribute('formaction') === '/preparation/example' && !window.confirm('Заменить исходные данные вымышленным примером? Ручной текст объявления сохранится.')) { event.preventDefault(); return; }
      dirty = true; recovery.hidden = true; remember(); sending = true; form.setAttribute('aria-busy', 'true');
    });
    document.querySelectorAll('form[action^="/direct/"]').forEach(target => target.addEventListener('submit', event => {
      if (dirty || sending) { event.preventDefault(); state.textContent = 'Сначала сохраните изменения и подтвердите актуальный план.'; state.scrollIntoView({ block: 'center' }); return; }
      sending = true; target.setAttribute('aria-busy', 'true');
    }));
    window.addEventListener('beforeunload', event => { if (dirty && !sending && !leaving) { remember(); event.preventDefault(); event.returnValue = ''; } });
    document.querySelectorAll('a[href]').forEach(link => link.addEventListener('click', event => {
      if (!dirty || event.ctrlKey || event.metaKey || event.shiftKey || link.getAttribute('href').startsWith('#')) return;
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
      const restore = document.createElement('form'); restore.method = 'post'; restore.action = '/campaign/resume';
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
    if (event.submitter?.getAttribute('formaction') === '/campaign/example' && dirty &&
        !window.confirm('Заменить исходные данные тестовым примером? Несохранённое описание, адрес, география и бюджет будут заменены. Ваши формулировки объявления останутся.')) {
      event.preventDefault(); return;
    }
    recovery.hidden = true; dirty = true; remember(); submitting = true;
    form.setAttribute('aria-busy', 'true');
    if (event.submitter) event.submitter.setAttribute('aria-disabled', 'true');
  });
  document.querySelectorAll('form[action^="/direct/"]').forEach(directForm => directForm.addEventListener('submit', event => {
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
