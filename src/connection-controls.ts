import { escapeHtml as e } from './html.ts';
import { uiIcon } from './ui-icons.ts';

export const connectionPanels = {
  direct: { title: 'Яндекс Директ', heading: 'connect-title', logo: 'connection-direct.png' },
  metrika: { title: 'Яндекс Метрика', heading: 'metrika-title', logo: 'connection-metrika.png' },
  advertiser: { title: 'Рекламодатель', heading: 'advertiser-title', logo: 'connection-advertiser.svg' },
} as const;
export type ConnectionPanel = keyof typeof connectionPanels;
export type ConnectionTone = 'ok' | 'pending' | 'off';

export function connectionPanel(value: string | null): ConnectionPanel | undefined {
  return value === 'direct' || value === 'metrika' || value === 'advertiser' ? value : undefined;
}

export function connectionPanelHref(href: string, panel: ConnectionPanel) {
  return href + (href.includes('?') ? '&' : '?') + 'panel=' + panel;
}

export const connectionHidden = (name: string, value: string | number) =>
  `<input type="hidden" name="${name}" value="${e(String(value))}">`;

export function connectionHelp(id: string, label: string, content: string) {
  return `<button class="connection-tip-button" type="button" popovertarget="${id}" aria-label="${e(label)}" aria-details="${id}">${uiIcon('help', 20)}</button>
    <div class="connection-tip" id="${id}" popover>${e(content)}</div>`;
}

export function connectionBlock(title: string, body: string, help = '') {
  return `<section class="connection-block"><div class="connection-block-heading"><h3>${e(title)}</h3>${help}</div>${body}</section>`;
}

export const connectionFacts = (rows: [string, string][]) => rows.length ? `<dl class="connection-facts">${rows.map(([label, value]) =>
  `<div><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`).join('')}</dl>` : '';

export function connectionDisconnect(title: string, description: string, action: string, body: string, label: string) {
  return `<details class="connection-disconnect"><summary class="button connection-danger-button" aria-label="${e(title.replace(/\?$/, ''))}">Отключить</summary>
    <div class="connection-confirm" data-confirm-title="${e(title)}"><p>${e(description)}</p>
      <form class="connection-buttons" method="post" action="${action}">${body}
        <button class="secondary" type="button" data-cancel-confirm hidden>Отмена</button>
        <button class="connection-danger-primary" type="submit" name="confirm" value="disconnect">${e(label)}</button></form>
    </div></details>`;
}

export function connectionCard(key: ConnectionPanel, href: string, initial: ConnectionPanel | undefined,
  status: string, tone: ConnectionTone, facts: [string, string][], body: string, footer = '') {
  const { title, heading, logo } = connectionPanels[key];
  const image = `<img class="connection-logo" src="/assets/${logo}" width="24" height="24" alt="">`;
  const badge = `<span class="connection-badge ${tone}">${e(status)}</span>`;
  const openHref = e(connectionPanelHref(href, key));
  return `<section class="connection-card" aria-labelledby="${heading}-card">
    <div class="connection-card-heading"><div class="connection-name">${image}<h2 id="${heading}-card">${title}</h2></div>${badge}</div>
    ${connectionFacts(facts)}<a class="button secondary connection-open" href="${openHref}" data-open-connection="${key}" aria-label="Открыть: ${title}">Открыть</a>
  </section><dialog class="connection-dialog" id="connection-${key}" data-connection-panel="${key}" aria-labelledby="${heading}"${initial === key ? ' open' : ''}>
    <header class="connection-dialog-heading"><div class="connection-name">${image}<h2 id="${heading}" tabindex="-1">${title}</h2>${badge}</div>
      <a class="button secondary connection-close" href="${e(href)}" data-close-connection aria-label="Закрыть окно">×</a></header>
    <div class="connection-dialog-body">${body}</div>${footer ? `<footer class="connection-dialog-actions">${footer}</footer>` : ''}
  </dialog>`;
}
