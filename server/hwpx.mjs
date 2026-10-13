import JSZip from 'jszip';
import { XMLValidator } from 'fast-xml-parser';

const LIMITS = Object.freeze({
  archive: 25 * 1024 * 1024,
  inflated: 100 * 1024 * 1024,
  section: 8 * 1024 * 1024,
  entries: 2048,
  depth: 256,
  text: 100_000,
});
const SECTION = /^Contents\/section(\d+)\.xml$/i;
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function fail(message) {
  const error = new Error(message);
  error.code = 'INVALID_HWPX';
  return error;
}

// Check central-directory sizes before asking a ZIP library to inflate anything.
function checkArchive(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  if (buffer.length < 22 || buffer.length > LIMITS.archive) {
    throw fail('HWPX 파일은 25MB 이하의 유효한 ZIP 파일이어야 합니다.');
  }
  if (buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
    throw fail('HWP 바이너리 파일은 직접 편집할 수 없습니다. 한글에서 HWPX로 저장한 뒤 업로드해 주세요.');
  }
  let eocd = -1;
  const minimum = Math.max(0, buffer.length - 22 - 0xffff);
  for (let i = buffer.length - 22; i >= minimum; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw fail('HWPX ZIP 파일을 읽을 수 없습니다.');
  const entries = buffer.readUInt16LE(eocd + 10);
  const directorySize = buffer.readUInt32LE(eocd + 12);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (buffer.readUInt16LE(eocd + 4) || buffer.readUInt16LE(eocd + 6)
      || buffer.readUInt16LE(eocd + 8) !== entries || entries === 0xffff
      || directoryOffset === 0xffffffff || directorySize === 0xffffffff
      || entries > LIMITS.entries || directoryOffset + directorySize > eocd) {
    throw fail('분할 ZIP, ZIP64 또는 지나치게 많은 파일이 있는 HWPX는 지원하지 않습니다.');
  }
  let offset = directoryOffset;
  let inflated = 0;
  const names = new Set();
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > eocd || buffer.readUInt32LE(offset) !== 0x02014b50) throw fail('ZIP 파일 목록이 손상되었습니다.');
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameSize = buffer.readUInt16LE(offset + 28);
    const extraSize = buffer.readUInt16LE(offset + 30);
    const commentSize = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const next = offset + 46 + nameSize + extraSize + commentSize;
    if (next > directoryOffset + directorySize || localOffset + 30 > directoryOffset
        || buffer.readUInt32LE(localOffset) !== 0x04034b50 || size === 0xffffffff
        || compressed === 0xffffffff || (flags & 1) || ![0, 8].includes(method)) {
      throw fail('암호화되었거나 손상된 ZIP 항목은 지원하지 않습니다.');
    }
    const name = buffer.subarray(offset + 46, offset + 46 + nameSize).toString('utf8');
    if (name.includes('\\') || name.startsWith('/') || name.split('/').includes('..')
        || name.includes('\0') || names.has(name)) throw fail('안전하지 않거나 중복된 ZIP 파일 경로입니다.');
    names.add(name);
    inflated += size;
    if (inflated > LIMITS.inflated || (SECTION.test(name) && size > LIMITS.section)) {
      throw fail('압축을 푼 문서의 크기가 허용 범위를 초과합니다.');
    }
    const localData = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    if (localData + compressed > directoryOffset) throw fail('ZIP 압축 데이터의 범위가 잘못되었습니다.');
    offset = next;
  }
  if (offset !== directoryOffset + directorySize) throw fail('ZIP 파일 목록의 크기가 일치하지 않습니다.');
  if (![...names].some((name) => SECTION.test(name))) throw fail('Contents/section*.xml이 없는 파일입니다. HWPX 양식을 올려 주세요.');
  return buffer;
}

async function openDocument(buffer) {
  buffer = checkArchive(buffer);
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer, { checkCRC32: true, createFolders: false });
  } catch {
    throw fail('HWPX 압축 데이터가 손상되었거나 무결성 확인에 실패했습니다.');
  }
  const paths = Object.keys(zip.files).filter((path) => SECTION.test(path)).sort((a, b) => (
    Number(a.match(SECTION)[1]) - Number(b.match(SECTION)[1]) || a.localeCompare(b)
  ));
  const sections = [];
  for (const path of paths) {
    const bytes = await zip.file(path).async('nodebuffer');
    if (bytes.length > LIMITS.section) throw fail('문서 본문이 허용 크기를 초과합니다.');
    let xml;
    try { xml = utf8.decode(bytes); } catch { throw fail('UTF-8이 아닌 HWPX XML 본문은 지원하지 않습니다.'); }
    const encoding = xml.match(/^\s*<\?xml[^?]*encoding\s*=\s*["']([^"']+)/i)?.[1];
    if (encoding && !/^utf-?8$/i.test(encoding)) throw fail('UTF-8 HWPX 양식으로 저장해 주세요.');
    sections.push({ path, xml, ...readSection(xml, path) });
  }
  return { zip, sections };
}

function escapeXml(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function decodeXml(text) {
  if (/&(?!amp;|lt;|gt;|quot;|apos;|#x[\da-fA-F]+;|#\d+;)/.test(text)) {
    throw fail('지원하지 않거나 올바르지 않은 XML 엔터티입니다.');
  }
  return text.replace(/&(?:#x[\da-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (entity) => {
    if (entity[1] === '#') {
      const value = entity[2].toLowerCase() === 'x' ? parseInt(entity.slice(3, -1), 16) : parseInt(entity.slice(2, -1), 10);
      if (![9, 10, 13].includes(value) && !(value >= 0x20 && value <= 0xd7ff)
          && !(value >= 0xe000 && value <= 0xfffd) && !(value >= 0x10000 && value <= 0x10ffff)) {
        throw fail('XML에 저장할 수 없는 문자 엔터티입니다.');
      }
      return String.fromCodePoint(value);
    }
    return { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }[entity] ?? entity;
  });
}

function localName(name) { return name.split(':').at(-1); }

// Retain source offsets, so filling never rebuilds XML or drops namespace/style attributes.
function readSection(xml, path) {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw fail('외부 엔터티와 DTD가 포함된 XML은 지원하지 않습니다.');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(xml)) throw fail('XML에 저장할 수 없는 문자가 포함되어 있습니다.');
  const validation = XMLValidator.validate(xml);
  if (validation !== true) throw fail('HWPX 본문 XML이 올바르지 않습니다.');
  const tokens = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(?:"[^"]*"|'[^']*'|[^'">])*>/g;
  const stack = [];
  const cells = [];
  const texts = [];
  let previous = 0;
  let paragraphIndex = 0;
  const currentText = () => stack.findLast((node) => node.kind === 't');
  const addCharacters = (start, end, cdata = false) => {
    if (start === end) return;
    const text = currentText();
    if (!text) return;
    const raw = xml.slice(start, end);
    text.spans.push({ start, end, cdata });
    text.value += cdata ? raw.slice(9, -3) : decodeXml(raw);
  };
  for (const match of xml.matchAll(tokens)) {
    const start = match.index;
    const end = start + match[0].length;
    const token = match[0];
    addCharacters(previous, start);
    previous = end;
    if (token.startsWith('<![CDATA[')) { addCharacters(start, end, true); continue; }
    if (token.startsWith('<!--') || token.startsWith('<?')) continue;
    if (token.startsWith('</')) {
      const node = stack.pop();
      if (!node) throw fail('HWPX XML 구조를 읽을 수 없습니다.');
      node.closeStart = start;
      node.end = end;
      continue;
    }
    const name = token.match(/^<([\w:.-]+)/)?.[1];
    if (!name) throw fail('HWPX XML 태그를 읽을 수 없습니다.');
    for (const attribute of token.matchAll(/(["'])([\s\S]*?)\1/g)) decodeXml(attribute[2]);
    const kind = localName(name);
    if (kind === 'lineBreak' && currentText()) currentText().value += '\n';
    if (kind === 'tab' && currentText()) currentText().value += '\t';
    const cell = stack.findLast((node) => node.kind === 'tc');
    const node = { name, kind, start, openEnd: end, end, selfClosing: /\/\s*>$/.test(token), cell };
    if (kind === 'tc') {
      node.id = `${path}:cell:${cells.length}`;
      node.texts = [];
      node.runs = [];
      cells.push(node);
      // A run holding a nested table is not a safe insertion target for a missing text node.
      for (const ancestor of stack) if (ancestor.kind === 'run') ancestor.nestedTable = true;
    }
    if (kind === 'p') node.paragraph = paragraphIndex++;
    if (kind === 'run' && cell) cell.runs.push(node);
    if (kind === 't') {
      node.spans = [];
      node.value = '';
      node.paragraph = stack.findLast((parent) => parent.kind === 'p')?.paragraph;
      texts.push(node);
      if (cell) cell.texts.push(node);
    }
    if (!node.selfClosing) stack.push(node);
    if (stack.length > LIMITS.depth) throw fail('XML 중첩이 너무 깊습니다.');
  }
  addCharacters(previous, xml.length);
  return { cells, texts };
}

function combineTexts(texts) {
  let result = '';
  let lastParagraph;
  for (const text of texts) {
    if (result && text.paragraph !== lastParagraph) result += '\n';
    result += text.value;
    lastParagraph = text.paragraph;
  }
  return result;
}

function insertionRun(cell) { return cell.runs.find((run) => !run.nestedTable); }

export async function extractHwpxText(buffer) {
  const { sections } = await openDocument(buffer);
  return sections.map((section) => combineTexts(section.texts)).join('\n').trim();
}

export async function inspectHwpx(buffer) {
  const { sections } = await openDocument(buffer);
  const fields = sections.flatMap((section) => section.cells.map((cell, index) => {
    const text = combineTexts(cell.texts);
    return { id: cell.id, label: text.trim() || `빈 셀 ${index + 1}`, text, editable: Boolean(cell.texts.length || insertionRun(cell)) };
  }));
  const warnings = ['선택한 표 셀의 글자만 바꿉니다. 저장한 파일은 한글에서 열어 서식과 줄바꿈을 확인해 주세요.'];
  if (fields.some((field) => !field.editable)) warnings.push('글자나 실행(run) 요소가 없는 일부 셀은 구조를 유지하기 위해 자동 입력하지 않습니다.');
  if (!fields.length) warnings.push('이 양식에는 편집할 수 있는 표 셀이 없습니다.');
  return { fields, warnings };
}

function normalizeMappings(mappings) {
  const entries = Array.isArray(mappings)
    ? mappings.map((mapping) => {
      if (!mapping || typeof mapping.id !== 'string') throw fail('입력할 셀 ID가 필요합니다.');
      return [mapping.id, mapping.text];
    })
    : mappings && typeof mappings === 'object' ? Object.entries(mappings) : null;
  if (!entries) throw fail('셀별 입력 내용을 지정해 주세요.');
  const normalized = new Map();
  let totalText = 0;
  for (const [id, text] of entries) {
    if (normalized.has(id)) throw fail('같은 셀을 여러 번 지정할 수 없습니다.');
    if (typeof text !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u.test(text)) {
      throw fail('입력 내용은 XML에 저장 가능한 문자열이어야 합니다.');
    }
    totalText += text.length;
    if (totalText > LIMITS.text) throw fail('입력 내용은 전체 100,000자 이하여야 합니다.');
    normalized.set(id, text);
  }
  return normalized;
}

function textEdits(xml, node, value) {
  const escaped = escapeXml(value);
  if (node.selfClosing) {
    if (!value) return [];
    const open = xml.slice(node.start, node.openEnd).replace(/\/\s*>$/, '>');
    return [{ start: node.start, end: node.openEnd, value: `${open}${escaped}</${node.name}>` }];
  }
  if (!node.spans.length) return value ? [{ start: node.openEnd, end: node.openEnd, value: escaped }] : [];
  return node.spans.map((span, index) => ({ start: span.start, end: span.end, value: index === 0 ? escaped : '' }));
}

export async function fillHwpx(buffer, mappings) {
  const values = normalizeMappings(mappings);
  const { zip, sections } = await openDocument(buffer);
  const known = new Set(sections.flatMap((section) => section.cells.map((cell) => cell.id)));
  for (const id of values.keys()) if (!known.has(id)) throw fail(`양식에 없는 셀 ID입니다: ${id}`);
  if (!values.size) return Buffer.from(buffer);
  for (const section of sections) {
    const edits = [];
    for (const cell of section.cells) {
      if (!values.has(cell.id)) continue;
      const value = values.get(cell.id);
      if (cell.texts.length) {
        cell.texts.forEach((node, index) => edits.push(...textEdits(section.xml, node, index === 0 ? value : '')));
      } else {
        const run = insertionRun(cell);
        if (!run) throw fail('선택한 빈 셀에는 안전하게 글자를 넣을 실행(run) 요소가 없습니다.');
        if (!value) continue;
        const prefix = run.name.includes(':') ? `${run.name.split(':')[0]}:` : '';
        const text = `<${prefix}t>${escapeXml(value)}</${prefix}t>`;
        if (run.selfClosing) {
          const open = section.xml.slice(run.start, run.openEnd).replace(/\/\s*>$/, '>');
          edits.push({ start: run.start, end: run.openEnd, value: `${open}${text}</${run.name}>` });
        } else edits.push({ start: run.closeStart, end: run.closeStart, value: text });
      }
    }
    if (!edits.length) continue;
    let xml = section.xml;
    for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) {
      xml = xml.slice(0, edit.start) + edit.value + xml.slice(edit.end);
    }
    // A final parse catches accidental malformed output before it is offered for download.
    readSection(xml, section.path);
    zip.file(section.path, xml, { date: zip.file(section.path).date });
  }
  // Keep the package mimetype uncompressed, while compressing the other entries.
  const mimetype = zip.file('mimetype');
  if (mimetype) zip.file('mimetype', await mimetype.async('nodebuffer'), { date: mimetype.date, compression: 'STORE' });
  const output = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  if (output.length > LIMITS.archive) throw fail('작성한 HWPX 파일이 25MB를 초과합니다.');
  return output;
}
