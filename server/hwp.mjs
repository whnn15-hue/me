import { inflateRawSync } from 'node:zlib';

/** Read HWP5 text records without running macros or altering the original. */
export function extractHwpText(input) {
  const bytes = Buffer.from(input), END = 0xfffffffe;
  if (bytes.length < 512 || !bytes.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'))) throw Error('Invalid HWP header');
  const sectorSize = 2 ** bytes.readUInt16LE(30), miniSize = 2 ** bytes.readUInt16LE(32);
  if (![512, 4096].includes(sectorSize) || miniSize !== 64 || bytes.length > 25 * 1024 * 1024) throw Error('Unsupported HWP sectors');
  const sectorCount = Math.floor(bytes.length / sectorSize) - 1;
  const sector = id => {
    if (!Number.isInteger(id) || id < 0 || id >= sectorCount) throw Error('Invalid HWP sector');
    return bytes.subarray((id + 1) * sectorSize, (id + 2) * sectorSize);
  };
  const ids = [];
  for (let offset = 76; offset < 512; offset += 4) { const id = bytes.readUInt32LE(offset); if (id < END) ids.push(id); }
  let next = bytes.readUInt32LE(68);
  const difatSeen = new Set();
  for (let count = 0; next < END; count++) {
    if (count >= sectorCount || difatSeen.has(next)) throw Error('Invalid HWP DIFAT');
    difatSeen.add(next);
    const data = sector(next);
    for (let offset = 0; offset < sectorSize - 4; offset += 4) { const id = data.readUInt32LE(offset); if (id < END) ids.push(id); }
    next = data.readUInt32LE(sectorSize - 4);
  }
  if (ids.length > sectorCount || new Set(ids).size !== ids.length) throw Error('Invalid HWP FAT');
  const fat = ids.flatMap(id => { const data = sector(id), result = []; for (let offset = 0; offset < sectorSize; offset += 4) result.push(data.readUInt32LE(offset)); return result; });
  const chain = (start, table, get, limit = 25 * 1024 * 1024) => {
    const chunks = [], seen = new Set(); let id = start, size = 0;
    while (id < END) {
      if (!Number.isInteger(id) || id >= table.length || seen.has(id) || seen.size >= sectorCount * 64) throw Error('Invalid HWP chain');
      seen.add(id); const data = get(id); size += data.length;
      if (size > limit) throw Error('HWP stream too large');
      chunks.push(data); id = table[id];
    }
    if (id !== END && start < END) throw Error('Invalid HWP end marker');
    return Buffer.concat(chunks);
  };
  const directory = chain(bytes.readUInt32LE(48), fat, sector), entries = [];
  for (let offset = 0; offset + 128 <= directory.length; offset += 128) {
    const data = directory.subarray(offset, offset + 128), length = data.readUInt16LE(64);
    if (length > 64 || length % 2 || data.readUInt32LE(124)) throw Error('Invalid HWP directory');
    entries.push({ name: length ? data.subarray(0, length - 2).toString('utf16le') : '', type: data[66], left: data.readUInt32LE(68), right: data.readUInt32LE(72), child: data.readUInt32LE(76), start: data.readUInt32LE(116), size: data.readUInt32LE(120) });
  }
  const root = entries.find(entry => entry.type === 5);
  if (!root) throw Error('Missing HWP root');
  const miniRoot = chain(root.start, fat, sector).subarray(0, root.size);
  const miniFatBytes = chain(bytes.readUInt32LE(60), fat, sector), miniFat = [];
  for (let offset = 0; offset < miniFatBytes.length; offset += 4) miniFat.push(miniFatBytes.readUInt32LE(offset));
  const read = entry => {
    if (!entry || entry.type !== 2 || entry.size > 25 * 1024 * 1024) throw Error('Invalid HWP stream');
    const data = entry.size < bytes.readUInt32LE(56) ? chain(entry.start, miniFat, id => {
      if ((id + 1) * miniSize > miniRoot.length) throw Error('Invalid HWP mini sector');
      return miniRoot.subarray(id * miniSize, (id + 1) * miniSize);
    }) : chain(entry.start, fat, sector);
    if (data.length < entry.size) throw Error('Truncated HWP stream');
    return data.subarray(0, entry.size);
  };
  const header = read(entries.find(entry => entry.name === 'FileHeader'));
  if (header.length < 40 || !header.subarray(0, 17).toString().startsWith('HWP Document File')) throw Error('Invalid HWP file header');
  const flags = header.readUInt32LE(36);
  if (flags & 2 || flags & 4) throw Error('Protected HWP document');
  const body = entries.find(entry => entry.name === 'BodyText' && entry.type === 1);
  if (!body) return '';
  const children = [], stack = [body.child], seen = new Set();
  while (stack.length) {
    const id = stack.pop(); if (id === 0xffffffff) continue;
    if (id >= entries.length || seen.has(id)) throw Error('Invalid HWP directory tree');
    seen.add(id); const entry = entries[id]; children.push(entry); stack.push(entry.left, entry.right);
  }
  const control = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
  const output = []; let total = 0, characters = 0;
  for (const entry of children.filter(entry => /^Section\d+$/.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).slice(0, 50)) {
    const raw = read(entry), data = flags & 1 ? inflateRawSync(raw, { maxOutputLength: 4 * 1024 * 1024 }) : raw;
    total += data.length; if (total > 16 * 1024 * 1024) throw Error('HWP body too large');
    for (let offset = 0; offset + 4 <= data.length;) {
      const record = data.readUInt32LE(offset); offset += 4;
      const tag = record & 0x3ff; let size = record >>> 20;
      if (size === 0xfff) { if (offset + 4 > data.length) throw Error('Invalid HWP record'); size = data.readUInt32LE(offset); offset += 4; }
      if (offset + size > data.length) throw Error('Truncated HWP record');
      if (tag === 67) {
        const text = [];
        for (let index = offset; index + 1 < offset + size;) {
          const code = data.readUInt16LE(index);
          if (code >= 32) { text.push(String.fromCharCode(code)); index += 2; }
          else { if ([10, 13].includes(code)) text.push('\n'); else if (code === 9) text.push(' '); index += control.has(code) ? 16 : 2; }
        }
        const value = text.join('').trim(); if (value) { output.push(value); characters += value.length; }
        if (characters >= 100000) return output.join('\n').slice(0, 100000);
      }
      offset += size;
    }
  }
  return output.join('\n').slice(0, 100000);
}
