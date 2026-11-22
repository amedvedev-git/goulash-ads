import { escapeHtml } from './operations-page.ts';

// Preserve sentence boundaries in short, authored instructions as the column changes width.
export function sentenceText(copy: string) {
  return copy.split(/(?<=[.!?])\s+(?=[А-ЯЁA-Z«])/u)
    .map(sentence => `<span class="hint-sentence">${escapeHtml(sentence)}</span>`)
    .join(' ');
}
