// One escaping helper for every server-rendered string. Kept in its own module
// so pages can share it without importing each other.
export function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
