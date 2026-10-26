import { test, expect, type Page } from '@playwright/test';

async function state(page: Page) {
  const response = await page.request.get('/api/workspace');
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function openTab(page: Page, name: string) {
  await page.getByRole('navigation', { name: '주 메뉴', exact: true }).getByRole('button', { name, exact: true }).click();
}

for (const record of [
  { kind: 'project', tab: '수업', title: '동시 편집 프로젝트', detail: ' 자세히 보기', edit: '수정', input: '예: 우리 동네를 바꾸는 작은 실천', save: '수업 저장' },
  { kind: 'material', tab: '강의 자료', title: '동시 편집 강의 자료', detail: ' 상세보기', edit: '수정하기', input: '다시 찾기 쉬운 자료 제목', save: '자료 저장' },
]) {
  test(`${record.tab} keeps the editor revision after a conflict and does not open search over a draft`, async ({ page }) => {
    const initial = await state(page);
    const created = await page.request.post('/api/workspace/items', { data: { item: { kind: record.kind, title: record.title }, links: [], expectedRevision: initial.revision } });
    expect(created.ok()).toBeTruthy();
    const base = await created.json();
    const item = base.items.find((entry: { title: string }) => entry.title === record.title);
    await page.goto('/');
    await openTab(page, record.tab);
    if (record.kind === 'course') {
      await page.getByRole('button', { name: `${record.title} 수정`, exact: true }).click();
    } else {
      await page.getByRole('button', { name: record.title + record.detail, exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: record.edit, exact: true }).click();
    }
    const editor = page.getByRole('dialog');
    const title = record.input ? editor.getByPlaceholder(record.input) : editor.getByLabel('강좌명 *', { exact: true });
    await title.fill('저장되지 않은 내 초안');
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(page.getByRole('dialog', { name: '모든 기록 검색', exact: true })).toHaveCount(0);
    await expect(title).toHaveValue('저장되지 않은 내 초안');

    const latestTitle = `${record.title} 다른 기기에서 저장`;
    const external = await page.request.put(`/api/workspace/items/${item.id}`, { data: { item: { ...item, title: latestTitle }, links: [], expectedRevision: base.revision } });
    expect(external.ok()).toBeTruthy();
    const sentRevisions: number[] = [];
    page.on('request', request => {
      if (request.method() === 'PUT' && request.url().endsWith(`/api/workspace/items/${item.id}`)) sentRevisions.push(request.postDataJSON().expectedRevision);
    });
    const save = editor.getByRole('button', { name: record.save, exact: true });
    const conflict = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith(`/api/workspace/items/${item.id}`));
    await save.click();
    expect((await conflict).status()).toBe(409);
    await expect(editor.getByRole('alert')).toBeVisible();
    await expect(title).toHaveValue('저장되지 않은 내 초안');
    // A second click must keep the original revision, even after App refreshes its data.
    if (await save.isEnabled()) {
      const repeated = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith(`/api/workspace/items/${item.id}`));
      await save.click();
      expect((await repeated).status()).toBe(409);
    }
    expect(sentRevisions.length).toBeGreaterThan(0);
    expect(sentRevisions.every(revision => revision === base.revision)).toBeTruthy();
    const after = await state(page);
    expect(after.items.find((entry: { id: string }) => entry.id === item.id).title).toBe(latestTitle);
    await expect(title).toHaveValue('저장되지 않은 내 초안');
  });
}

test('a stale delete confirmation cannot delete a record changed on another device', async ({ page }) => {
  const initial = await state(page);
  const created = await page.request.post('/api/workspace/items', { data: { item: { kind: 'project', title: '동시 삭제 보호 프로젝트' }, links: [], expectedRevision: initial.revision } });
  expect(created.ok()).toBeTruthy();
  const base = await created.json();
  const item = base.items.find((entry: { title: string }) => entry.title === '동시 삭제 보호 프로젝트');
  await page.goto('/');
  await openTab(page, '수업');
  await page.getByRole('button', { name: `${item.title} 자세히 보기`, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '수업 삭제', exact: true }).click();
  const confirmation = page.getByRole('dialog');
  const external = await page.request.put(`/api/workspace/items/${item.id}`, { data: { item: { ...item, title: '수정되어 삭제하면 안 되는 프로젝트' }, links: [], expectedRevision: base.revision } });
  expect(external.ok()).toBeTruthy();
  const remove = confirmation.getByRole('button', { name: '수업 삭제', exact: true });
  const conflict = page.waitForResponse(response => response.request().method() === 'DELETE' && response.url().endsWith(`/api/workspace/items/${item.id}`));
  await remove.click();
  expect((await conflict).status()).toBe(409);
  await expect(confirmation.getByRole('alert')).toBeVisible();
  if (await remove.isEnabled()) {
    const repeated = page.waitForResponse(response => response.request().method() === 'DELETE' && response.url().endsWith(`/api/workspace/items/${item.id}`));
    await remove.click();
    expect((await repeated).status()).toBe(409);
  }
  expect((await state(page)).items.find((entry: { id: string }) => entry.id === item.id).title).toBe('수정되어 삭제하면 안 되는 프로젝트');
});
