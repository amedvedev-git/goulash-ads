function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export function renderPage(value: string | undefined, message = '', isError = false, oauth = false, name?: string) {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Автопилот рекламы — тестовый стенд</title>
  <style>
    body { margin: 0; background: #f3f5f9; color: #14223b; font: 1rem/1.55 system-ui, sans-serif; }
    main { max-width: 36rem; margin: clamp(1.5rem, 8vw, 5rem) auto; padding: 0 1rem; }
    h1 { margin: 0; line-height: 1.2; }
    section { margin-top: 1.5rem; padding: clamp(1rem, 4vw, 1.75rem); background: white; border: 1px solid #ced7e4; border-radius: 0.75rem; }
    h2, p { margin: 0 0 0.75rem; }
    .mode { color: #425373; margin-bottom: 0.5rem; }
    .connection { margin-top: 0.75rem; }
    label { display: block; font-weight: 600; }
    input, button { box-sizing: border-box; font: inherit; border-radius: 0.4rem; padding: 0.5rem 0.75rem; }
    input { width: 100%; margin: 0.35rem 0 0.75rem; border: 1px solid #61728e; }
    button { background: #214885; color: white; border: 1px solid #214885; cursor: pointer; }
    :focus-visible { outline: 3px solid #4e65b1; outline-offset: 2px; }
    [role="alert"] { color: #9b2533; }
  </style>
</head>
<body>
  <main>
    <p class="mode">Стенд · тестовый режим</p>
    <h1>Автопилот рекламы</h1>
    <p class="connection">Директ не подключён</p>
    ${message ? `<p role="${isError ? 'alert' : 'status'}">${escapeHtml(message)}</p>` : ''}
    ${oauth ? `<section aria-label="Вход через Яндекс ID">
      ${name ? `<p>Вы вошли как <strong>${escapeHtml(name)}</strong></p>
      <form method="post" action="/logout"><button type="submit">Выйти</button></form>`
    : '<a href="/auth/yandex">Войти через Яндекс ID</a>'}
    </section>` : ''}
    ${value === undefined ? '' : `<section aria-labelledby="record-title">
      <h2 id="record-title">Тестовая запись</h2>
      <p id="hint">До 200 символов. Запись хранится в локальной базе SQLite.</p>
      <form method="post" action="/test-record">
        <label for="content">Текст записи</label>
        <input id="content" name="content" maxlength="200" required aria-describedby="hint" value="${escapeHtml(value)}">
        <button type="submit">Сохранить</button>
      </form>
    </section>`}
  </main>
</body>
</html>`;
}
