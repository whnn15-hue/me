// Metadata only: uploaded HTML is never executed during extraction.
export function decodeHtml(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let encoding = 'utf-8';
  if (data[0] === 0xff && data[1] === 0xfe) encoding = 'utf-16le';
  else if (data[0] === 0xfe && data[1] === 0xff) encoding = 'utf-16be';
  else if (!(data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf)) {
    const declaration = new TextDecoder('windows-1252').decode(data.subarray(0, 4096));
    encoding = /<meta\b[^>]*charset\s*=\s*["']?\s*([\w-]+)/i.exec(declaration)?.[1] || encoding;
  }
  try { return new TextDecoder(encoding).decode(data); }
  catch { return new TextDecoder().decode(data); }
}

export function isHtmlBytes(bytes) {
  const text = decodeHtml(bytes.subarray(0, 65536)).replace(/^\uFEFF/, '');
  if (/[\u0000-\u0008\u000e-\u001f]/.test(text)) return false;
  return /^\s*(?:<!--[\s\S]*?-->\s*)*(?:<!doctype\s+html\b|<(?:html|head|body|meta|title|style|main|article|section|div|h[1-6]|p|table|form|svg)\b)/i.test(text);
}

function entities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, name) => {
    if (name[0] !== '#') return named[name.toLowerCase()] || match;
    const point = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '';
  });
}
const plain = text => entities(text.replace(/<[^>]*>/g, ' ')).replace(/[\t \r]+/g, ' ').trim();
export function htmlMetadata(source) {
  const safe = String(source).slice(0, 512 * 1024)
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '');
  const title = plain(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(safe)?.[1] || '').slice(0, 300);
  const meta = {};
  for (const tag of safe.match(/<meta\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi) || []) {
    const attrs = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))
      attrs[match[1].toLowerCase()] = entities(match[2] ?? match[3] ?? match[4]);
    const key = (attrs.name || attrs.property || '').toLowerCase();
    if (['description', 'author', 'og:description'].includes(key)) meta[key] = attrs.content || '';
  }
  const text = plain(safe.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, '').replace(/<\/?(?:br|p|div|li|h[1-6]|tr|section|article|header|footer)\b[^>]*>/gi, '\n'))
    .replace(/\n\s*\n+/g, '\n').slice(0, 60000);
  return { title, description: (meta.description || meta['og:description'] || '').trim().slice(0, 500), author: (meta.author || '').trim().slice(0, 300), text };
}
