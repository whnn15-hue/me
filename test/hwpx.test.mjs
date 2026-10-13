import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { extractHwpxText, inspectHwpx, fillHwpx } from '../server/hwpx.mjs';

const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const section = (body) => `${head}<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">${body}</hs:sec>`;
const para = (text, id = 1) => `<hp:p id="${id}" paraPrIDRef="0"><hp:run charPrIDRef="4"><hp:t>${text}</hp:t></hp:run></hp:p>`;
const cell = (body, id = 0) => `<hp:tc name="cell${id}" header="0"><hp:subList id="${id}" textDirection="HORIZONTAL">${body}</hp:subList><hp:cellAddr colAddr="${id}" rowAddr="0"/><hp:cellSz width="1000" height="400"/></hp:tc>`;
const table = (cells) => `<hp:tbl id="17" rowCnt="1" colCnt="${cells.length}" borderFillIDRef="3"><hp:tr>${cells.join('')}</hp:tr></hp:tbl>`;

async function document(sections, extra = {}, compression = 'DEFLATE') {
  const zip = new JSZip();
  zip.file('mimetype', 'application/hwp+zip', { compression: 'STORE' });
  zip.file('Contents/header.xml', '<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"><hh:fontfaces/></hh:head>');
  zip.file('Contents/content.hpf', '<package><metadata/></package>');
  for (const [name, xml] of Object.entries(sections)) zip.file(`Contents/${name}`, xml);
  for (const [name, bytes] of Object.entries(extra)) zip.file(name, bytes, { createFolders: false });
  return zip.generateAsync({ type: 'nodebuffer', compression });
}

test('inspect/extract handles multiple sections, split runs, paragraphs and Korean', async () => {
  const input = await document({
    'section10.xml': section(table([cell(para('공문 증빙', 5), 0)])),
    'section2.xml': section(`${para('경력 정리', 0)}${table([
      cell('<hp:p id="1"><hp:run charPrIDRef="1"><hp:t>활동</hp:t></hp:run><hp:run charPrIDRef="2"><hp:t> 기관</hp:t></hp:run></hp:p>' + para('둘째 문단', 2), 0),
      cell(para('기간 &amp; 역할', 3), 1),
    ])}`),
  });
  const result = await inspectHwpx(input);
  assert.deepEqual(result.fields.map(({ id, text }) => ({ id, text })), [
    { id: 'Contents/section2.xml:cell:0', text: '활동 기관\n둘째 문단' },
    { id: 'Contents/section2.xml:cell:1', text: '기간 & 역할' },
    { id: 'Contents/section10.xml:cell:0', text: '공문 증빙' },
  ]);
  assert.equal(result.fields[0].label, '활동 기관\n둘째 문단');
  assert.ok(result.fields.every((field) => field.editable));
  assert.ok(result.warnings.length);
  assert.equal(await extractHwpxText(input), '경력 정리\n활동 기관\n둘째 문단\n기간 & 역할\n공문 증빙');
});

test('fill replaces split cell text, escapes Korean multiline input and preserves XML and other files', async () => {
  const source = section(table([
    cell('<hp:p id="7" paraPrIDRef="3"><hp:run charPrIDRef="1"><hp:t>첫 부분</hp:t></hp:run><hp:run charPrIDRef="2"><hp:t>둘째 부분</hp:t></hp:run></hp:p>', 0),
    cell(para('바꾸지 않는 셀', 8), 1),
  ]));
  const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 255, 17]);
  const input = await document({ 'section0.xml': source, 'section1.xml': section(para('다른 본문')) }, { 'BinData/image1.png': image });
  const newText = '홍길동 & 연구 <성과> "인용"\n강의 10회 😊';
  const output = await fillHwpx(input, [{ id: 'Contents/section0.xml:cell:0', text: newText }]);
  const before = await JSZip.loadAsync(input);
  const after = await JSZip.loadAsync(output, { checkCRC32: true });
  const expected = source.replace('첫 부분', '홍길동 &amp; 연구 &lt;성과&gt; "인용"\n강의 10회 😊').replace('둘째 부분', '');
  assert.equal(await after.file('Contents/section0.xml').async('string'), expected);
  for (const name of ['Contents/header.xml', 'Contents/content.hpf', 'Contents/section1.xml', 'BinData/image1.png', 'mimetype']) {
    assert.deepEqual(await after.file(name).async('nodebuffer'), await before.file(name).async('nodebuffer'));
  }
  assert.equal((await inspectHwpx(output)).fields[0].text, newText);
  // The mimetype entry remains stored rather than compressed.
  assert.equal(after.file('mimetype')._data.compression.magic, '\x00\x00');
});

test('empty hp:t, empty run, and run without a text child can be filled without invented style IDs', async () => {
  const source = section(table([
    cell('<hp:p id="1"><hp:run charPrIDRef="2"><hp:t/></hp:run></hp:p>', 0),
    cell('<hp:p id="2"><hp:run charPrIDRef="3"/></hp:p>', 1),
    cell('<hp:p id="3"><hp:run charPrIDRef="4"></hp:run></hp:p>', 2),
    cell('<hp:p id="4"/>', 3),
  ]));
  const input = await document({ 'section0.xml': source });
  const inspection = await inspectHwpx(input);
  assert.deepEqual(inspection.fields.map((field) => field.editable), [true, true, true, false]);
  const output = await fillHwpx(input, {
    [inspection.fields[0].id]: '기간',
    [inspection.fields[1].id]: '기관',
    [inspection.fields[2].id]: '역할',
  });
  const zip = await JSZip.loadAsync(output);
  assert.equal(await zip.file('Contents/section0.xml').async('string'), source
    .replace('<hp:t/>', '<hp:t>기간</hp:t>')
    .replace('<hp:run charPrIDRef="3"/>', '<hp:run charPrIDRef="3"><hp:t>기관</hp:t></hp:run>')
    .replace('<hp:run charPrIDRef="4"></hp:run>', '<hp:run charPrIDRef="4"><hp:t>역할</hp:t></hp:run>'));
  await assert.rejects(() => fillHwpx(input, { [inspection.fields[3].id]: '불가' }), /run/);
});

test('nested cells are edited independently and inline structural elements are retained', async () => {
  const nested = table([cell(para('안쪽 셀', 10), 0)]);
  const source = section(table([cell(`<hp:p id="1"><hp:run charPrIDRef="0"><hp:t>바깥<hp:lineBreak/>셀</hp:t><hp:ctrl>${nested}</hp:ctrl></hp:run></hp:p>`, 0)]));
  const input = await document({ 'section0.xml': source });
  const inspection = await inspectHwpx(input);
  assert.deepEqual(inspection.fields.map((field) => field.text), ['바깥\n셀', '안쪽 셀']);
  const output = await fillHwpx(input, { [inspection.fields[0].id]: '바깥 변경' });
  const zip = await JSZip.loadAsync(output);
  assert.equal(await zip.file('Contents/section0.xml').async('string'), source.replace('바깥<hp:lineBreak/>셀', '바깥 변경<hp:lineBreak/>'));
  assert.equal((await inspectHwpx(output)).fields[1].text, '안쪽 셀');
});

test('no-op returns exact archive bytes and empty string clears cell text', async () => {
  const input = await document({ 'section0.xml': section(table([cell(para('지울 내용'))])) });
  assert.deepEqual(await fillHwpx(input, {}), input);
  assert.deepEqual(await fillHwpx(input, []), input);
  const output = await fillHwpx(input, { 'Contents/section0.xml:cell:0': '' });
  assert.equal((await inspectHwpx(output)).fields[0].text, '');
});

test('CDATA text and BOM preserve unrelated source bytes during filling', async () => {
  const source = '\ufeff' + section(table([cell(para('<![CDATA[경력 <내용> & 공문]]>'))]));
  const input = await document({ 'section0.xml': source });
  assert.equal((await inspectHwpx(input)).fields[0].text, '경력 <내용> & 공문');
  const output = await fillHwpx(input, { 'Contents/section0.xml:cell:0': '새 내용 & 공문' });
  const zip = await JSZip.loadAsync(output);
  assert.deepEqual(await zip.file('Contents/section0.xml').async('nodebuffer'), Buffer.from(source.replace('<![CDATA[경력 <내용> & 공문]]>', '새 내용 &amp; 공문')));
});

test('rejects HWP binary and ordinary ZIP files', async () => {
  const hwp = Buffer.alloc(64);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(hwp);
  await assert.rejects(() => inspectHwpx(hwp), /HWP.*HWPX/);
  await assert.rejects(() => inspectHwpx(Buffer.from('not a zip')), /ZIP/);
  const zip = new JSZip();
  zip.file('document.txt', 'hello');
  const ordinaryZip = await zip.generateAsync({ type: 'nodebuffer' });
  await assert.rejects(() => inspectHwpx(ordinaryZip), /section/);
});

test('rejects malformed XML, DTD and unsupported entities', async () => {
  for (const xml of [
    '<hp:sec><hp:p></hp:sec>',
    '<!DOCTYPE hs:sec [<!ENTITY stolen SYSTEM "file:///etc/passwd">]>' + section(para('&stolen;')),
    section(para('&unknown;')),
    section(para('&#x110000;')),
    section(para('&#0;')),
  ]) {
    const input = await document({ 'section0.xml': xml });
    await assert.rejects(() => inspectHwpx(input), { code: 'INVALID_HWPX' });
  }
});

test('rejects unsafe paths, uncompressed size bombs and CRC corruption', async () => {
  const source = section(table([cell(para('CRC TEST'))]));
  const unsafe = await document({ 'section0.xml': source }, { '../outside': 'x' });
  await assert.rejects(() => inspectHwpx(unsafe), /경로/);
  const input = await document({ 'section0.xml': source }, {}, 'STORE');
  const oversized = Buffer.from(input);
  const eocd = oversized.length - 22;
  const directory = oversized.readUInt32LE(eocd + 16);
  oversized.writeUInt32LE(101 * 1024 * 1024, directory + 24);
  await assert.rejects(() => inspectHwpx(oversized), /크기/);
  const corrupted = Buffer.from(input);
  const textPosition = corrupted.indexOf(Buffer.from('CRC TEST'));
  assert.ok(textPosition > 0);
  corrupted[textPosition] ^= 1;
  await assert.rejects(() => inspectHwpx(corrupted), /무결성/);
});

test('rejects unknown cells, duplicate mappings, invalid XML characters and too much text', async () => {
  const input = await document({ 'section0.xml': section(table([cell(para('경력'))])) });
  const id = 'Contents/section0.xml:cell:0';
  await assert.rejects(() => fillHwpx(input, { unknown: 'x' }), /없는 셀/);
  await assert.rejects(() => fillHwpx(input, [{ id, text: 'a' }, { id, text: 'b' }]), /여러 번/);
  await assert.rejects(() => fillHwpx(input, { [id]: '\u0000' }), /문자열/);
  await assert.rejects(() => fillHwpx(input, { [id]: '\ud800' }), /문자열/);
  await assert.rejects(() => fillHwpx(input, { [id]: 'x'.repeat(100_001) }), /100,000/);
});
