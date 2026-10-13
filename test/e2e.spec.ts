import { test, expect, type Page, type Download } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';

const firstTitle = '브라우저 검증 디지털 교육 특강';
const secondTitle = '브라우저 검증 미디어 연구회 위원';
const firstFile = { name: '특강 위촉 공문.txt', mimeType: 'text/plain', buffer: Buffer.from(`활동명: ${firstTitle}\n기관: 한국교육학술정보원\n2025년 3월 14일 강사로 디지털 교육 특강 진행`, 'utf8') };
const secondFile = { name: '연구회 위촉 공문.txt', mimeType: 'text/plain', buffer: Buffer.from(`활동명: ${secondTitle}\n기관: 교육청\n2025년 4월 16일 미디어 연구회 위원으로 위촉`, 'utf8') };

async function data(page: Page) { const response = await page.request.get('/api/data'); expect(response.ok()).toBeTruthy(); return response.json(); }
async function navigate(page: Page, name: string) { await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('button', { name, exact: name !== '경력 아카이브' }).click(); }
async function findCareer(page: Page, title: string) { await navigate(page, '경력 아카이브'); await page.getByRole('textbox', { name: '경력 검색', exact: true }).fill(title); return page.locator('.career-row').filter({ hasText: title }); }
async function archive(download: Download) { const path = await download.path(); expect(path).toBeTruthy(); return JSZip.loadAsync(await readFile(path!)); }
async function removeDocument(page: Page, filename: string) {
  await page.getByRole('button', { name: `${filename} 삭제`, exact: true }).click();
  await page.getByRole('dialog', { name: '기록을 삭제할까요?' }).getByRole('button', { name: '삭제하기', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '기록을 삭제할까요?' })).toHaveCount(0);
}

test('personal career workflow persists records, reviews uploads, exports evidence and HWPX, and restores backups', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const initial = await data(page); const initialCount = initial.careers.length;
  await expect(page.locator('.career-row')).toHaveCount(initialCount);
  await expect(page.locator('.nav-count')).toHaveText(String(initialCount));
  if (initial.careers.some((career: { title: string }) => career.title.includes('KERIS'))) {
    await page.getByRole('textbox', { name: '경력 검색', exact: true }).fill('KERIS');
    await expect(page.locator('.career-row')).toHaveCount(1);
    await page.getByRole('textbox', { name: '경력 검색', exact: true }).fill('');
  }

  // A career without a document can be created, persisted across reload, edited and deleted.
  await page.getByRole('button', { name: '경력 추가', exact: true }).click();
  let editor = page.getByRole('dialog', { name: '새 경력 기록하기' });
  await editor.getByPlaceholder('어떤 경험을 하셨나요?').fill('브라우저 검증 증빙 없는 활동');
  await editor.getByRole('button', { name: '연도', exact: true }).click();
  await editor.getByRole('textbox', { name: '활동 시작', exact: true }).fill('2024');
  await editor.getByPlaceholder('예: 강사, 위원, 집필진').fill('회장');
  await editor.getByPlaceholder('예: 대구광역시교육청').fill('브라우저 검증 연구회');
  await editor.getByRole('textbox', { name: '태그 추가', exact: true }).fill('미디어');
  await editor.getByRole('textbox', { name: '태그 추가', exact: true }).press('Enter');
  await editor.getByRole('radio', { name: '증빙 불필요' }).check();
  await editor.getByRole('button', { name: '확인하고 저장', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.reload();
  let row = await findCareer(page, '브라우저 검증 증빙 없는 활동');
  await expect(row).toHaveCount(1); await expect(row).toContainText('증빙 불필요');
  await row.click();
  const detail = page.getByRole('dialog', { name: '경력 상세' });
  await detail.getByRole('button', { name: '경력 수정하기', exact: true }).click();
  editor = page.getByRole('dialog', { name: '경력 수정하기' });
  await editor.getByPlaceholder('어떤 경험을 하셨나요?').fill('브라우저 검증 수정한 활동');
  await editor.getByRole('button', { name: '확인하고 저장', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(detail.getByRole('heading', { name: '브라우저 검증 수정한 활동' })).toBeVisible();
  await detail.getByRole('button', { name: '삭제', exact: true }).click();
  await page.getByRole('dialog', { name: '기록을 삭제할까요?' }).getByRole('button', { name: '삭제하기', exact: true }).click();
  await expect(detail).toHaveCount(0);
  expect((await data(page)).careers).toHaveLength(initialCount);

  // Multiple UTF-8 documents create reviewable drafts and keep their original attachments.
  await page.getByLabel('공문 파일 선택', { exact: true }).setInputFiles([firstFile, secondFile]);
  editor = page.getByRole('dialog', { name: '새 경력 기록하기' });
  await expect(editor.getByPlaceholder('어떤 경험을 하셨나요?')).toHaveValue(firstTitle);
  await expect(editor).toContainText('AI 미연결');
  await expect(editor.getByRole('checkbox', { name: firstFile.name, exact: true })).toBeChecked();
  await editor.getByRole('button', { name: '저장하고 다음', exact: true }).click();
  await expect(editor.getByPlaceholder('어떤 경험을 하셨나요?')).toHaveValue(secondTitle);
  await editor.getByRole('button', { name: '확인하고 저장', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.locator('.document-row')).toHaveCount(2);
  let current = await data(page);
  expect(current.careers).toHaveLength(initialCount + 2); expect(current.documents).toHaveLength(2);
  const firstCareer = current.careers.find((career: { title: string }) => career.title === firstTitle);
  const secondCareer = current.careers.find((career: { title: string }) => career.title === secondTitle);
  expect(firstCareer.documentIds).toHaveLength(1);

  // Duplicate originals are reported without reopening drafts or making new analyze calls.
  let analysisRequests = 0;
  const watchAnalysis = (request: { url: () => string }) => { if (request.url().endsWith('/api/analyze')) analysisRequests++; };
  page.on('request', watchAnalysis);
  const duplicateResponse = page.waitForResponse(response => response.url().endsWith('/api/documents') && response.request().method() === 'POST');
  await page.getByLabel('공문 파일 선택', { exact: true }).setInputFiles(firstFile);
  expect((await duplicateResponse).ok()).toBeTruthy();
  await expect(page.locator('.toast')).toContainText('중복 파일 1개');
  await expect(page.locator('.busy-indicator')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '새 경력 기록하기' })).toHaveCount(0);
  expect(analysisRequests).toBe(0); page.off('request', watchAnalysis);
  expect((await data(page)).careers).toHaveLength(initialCount + 2);

  // One original may support more than one career, using the explicit link action.
  await page.getByRole('button', { name: `${firstFile.name} 기존 경력에 연결`, exact: true }).click();
  const link = page.getByRole('dialog', { name: '기존 경력에 공문 연결' });
  await link.getByRole('combobox').selectOption(secondCareer.id);
  await link.getByRole('button', { name: '연결하기', exact: true }).click();
  await expect(link).toHaveCount(0);
  current = await data(page); expect(current.careers.find((career: { id: string }) => career.id === secondCareer.id).documentIds).toHaveLength(2);

  // Evidence export contains only the selected career and the originals it references.
  await navigate(page, '이력서·증빙 만들기');
  await page.getByRole('textbox', { name: '이력서 경력 검색', exact: true }).fill(firstTitle);
  await page.locator('.resume-career').getByRole('checkbox').check();
  await expect(page.locator('.resume-paper')).toContainText(firstTitle);
  const evidenceDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '증빙 ZIP 받기', exact: true }).click();
  const evidence = await archive(await evidenceDownload);
  const selected = JSON.parse(await evidence.file('manifest.json')!.async('string'));
  expect(selected.careers).toHaveLength(1); expect(selected.careers[0].id).toBe(firstCareer.id); expect(selected.documents).toHaveLength(1);
  expect(await evidence.file(selected.documents[0].filePath)!.async('string')).toContain(firstTitle);

  // Arbitrary HWPX table cells can be inspected and filled without rebuilding the other entries.
  const templateZip = new JSZip(); templateZip.file('mimetype', 'application/hwp+zip');
  templateZip.file('Contents/header.xml', '<header keep="yes"/>');
  templateZip.file('Contents/section0.xml', '<?xml version="1.0"?><hs:sec xmlns:hs="urn:hs" xmlns:hp="urn:hp"><hp:tbl><hp:tr><hp:tc><hp:p><hp:run><hp:t>활동명</hp:t></hp:run></hp:p></hp:tc><hp:tc><hp:p><hp:run><hp:t/></hp:run></hp:p></hp:tc></hp:tr></hp:tbl></hs:sec>');
  const template = await templateZip.generateAsync({ type: 'nodebuffer' });
  await page.getByRole('button', { name: '내 양식에 입력', exact: true }).click();
  await page.getByLabel('이력서 양식 선택', { exact: true }).setInputFiles({ name: '검증 이력서.hwpx', mimeType: 'application/zip', buffer: template });
  await expect(page.getByRole('textbox', { name: '칸 2 입력 내용', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: '칸 2 내용 선택', exact: true }).selectOption('summary');
  await expect(page.getByRole('textbox', { name: '칸 2 입력 내용', exact: true })).toHaveValue(new RegExp(firstTitle));
  const templateDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '작성한 HWPX 받기', exact: true }).click();
  const filled = await archive(await templateDownload);
  expect(await filled.file('Contents/header.xml')!.async('string')).toBe('<header keep="yes"/>');
  const filledXml = await filled.file('Contents/section0.xml')!.async('string'); expect(filledXml).toContain(firstTitle); expect(filledXml).toContain('<hp:t>활동명</hp:t>');

  // Download a complete backup, unlink evidence and remove originals, then confirm replacement restore.
  await navigate(page, '백업 및 설정');
  const backupDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '백업 ZIP 받기', exact: true }).click();
  const downloadedBackup = await backupDownload; const backupPath = await downloadedBackup.path();
  const backup = await archive(downloadedBackup); const manifest = JSON.parse(await backup.file('manifest.json')!.async('string'));
  expect(manifest.careers).toHaveLength(initialCount + 2); expect(manifest.documents).toHaveLength(2);
  row = await findCareer(page, firstTitle); await row.click();
  await detail.getByRole('button', { name: '경력 수정하기', exact: true }).click();
  editor = page.getByRole('dialog', { name: '경력 수정하기' });
  await editor.getByRole('checkbox', { name: firstFile.name, exact: true }).uncheck();
  await editor.getByRole('button', { name: '확인하고 저장', exact: true }).click();
  await expect(editor).toHaveCount(0); await expect(detail).toContainText('증빙 미첨부');
  await detail.getByRole('button', { name: '상세 닫기', exact: true }).click();
  await navigate(page, '공문 보관함');
  await removeDocument(page, firstFile.name); await removeDocument(page, secondFile.name);
  expect((await data(page)).documents).toHaveLength(0);
  await navigate(page, '백업 및 설정');
  await page.getByLabel('복원할 백업 선택', { exact: true }).setInputFiles(backupPath!);
  const restore = page.getByRole('dialog', { name: '백업으로 전체 기록을 복원할까요?' });
  await expect(restore).toContainText('현재 경력과 공문');
  await restore.getByRole('button', { name: '전체 기록 복원', exact: true }).click();
  await expect(restore).toHaveCount(0);
  current = await data(page); expect(current.careers).toHaveLength(initialCount + 2); expect(current.documents).toHaveLength(2);
  expect(current.careers.find((career: { id: string }) => career.id === firstCareer.id).documentIds).toHaveLength(1);
  await navigate(page, '공문 보관함');
  await expect(page.locator('.document-row')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('mobile navigation works at 375px without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 }); await page.goto('/');
  await expect(page.getByRole('heading', { name: '나의 경력.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.getByRole('button', { name: '메뉴 열기', exact: true }).click();
  await expect(page.locator('.sidebar')).toHaveClass(/is-open/);
  await navigate(page, '공문 보관함');
  await expect(page.getByRole('heading', { name: '공문 보관함.', exact: true })).toBeVisible();
  await expect(page.locator('.sidebar')).not.toHaveClass(/is-open/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});
