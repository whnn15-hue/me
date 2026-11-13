import { test, expect } from '@playwright/test';

test('proof availability toggles persist without editing the career, update home, preserve concurrent fields and yield to new proof', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1050 });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const data = async () => (await (await page.request.get('/api/data')).json());
  const before = await data(), originalWorkspace = await (await page.request.get('/api/workspace')).json();
  const countMissing = (snapshot: typeof before) => snapshot.careers.filter((career: { documentIds: string[]; evidenceStatus: string }) => !career.documentIds.some(id => snapshot.documents.some((document: { id: string }) => document.id === id)) && !['unneeded', 'unavailable'].includes(career.evidenceStatus)).length;
  const ids: string[] = []; let documentId = '';
  const title = '증빙표시 검증 학교 활동';
  try {
    for (const career of [
      { title, category: '위원회·지원단', role: '보존할 역할', description: '원래 메모', tags: ['보존할 태그'] },
      { title: '몽당분필 회원 활동', category: '집필·콘텐츠', role: '회원' },
      { title: '몽당분필 수업 영상 제작', category: '집필·콘텐츠', role: '영상 제작' },
      { title: '증빙표시 검증 현장 교사 파견', category: '근무·파견', role: '파견 교사' },
    ]) {
      const response = await page.request.post('/api/careers', { data: { startDate: '2024', datePrecision: 'year', evidenceStatus: 'later', organization: '가상 기관', ...career } });
      expect(response.ok()).toBeTruthy(); ids.push((await response.json()).id);
    }
    await page.goto('/#home');
    const menu = page.getByRole('navigation', { name: '주 메뉴', exact: true });
    const initialMissing = countMissing(await data());
    await expect(page.getByRole('button', { name: `증빙 보완할 경력 ${initialMissing}건`, exact: true })).toBeVisible();
    await menu.getByRole('button', { name: '경력 아카이브', exact: true }).click();
    const category = page.getByRole('combobox', { name: '이력 분류', exact: true });
    const entry = (id: string) => page.locator(`.career-entry[data-career-id="${id}"]`);
    await category.selectOption('활동 경력');
    await expect(entry(ids[1])).toBeVisible(); await expect(entry(ids[3])).toBeVisible(); await expect(entry(ids[2])).toHaveCount(0);
    await category.selectOption('콘텐츠 제작');
    await expect(entry(ids[2])).toBeVisible(); await expect(entry(ids[1])).toHaveCount(0); await expect(entry(ids[3])).toHaveCount(0);
    await category.selectOption('전체');
    await page.getByRole('textbox', { name: '경력 검색', exact: true }).fill(title);
    // A second session changes notes while this screen is stale. The quick action
    // must patch only evidenceStatus instead of overwriting this latest content.
    await page.request.put(`/api/careers/${ids[0]}`, { data: { description: '다른 창에서 바꾼 최신 메모' } });
    const mark = entry(ids[0]).getByRole('button', { name: `${title} 증빙 확보 어려움 표시`, exact: true });
    const request = page.waitForRequest(request => request.method() === 'PUT' && request.url().endsWith(`/careers/${ids[0]}`));
    await mark.click();
    expect((await request).postDataJSON()).toEqual({ evidenceStatus: 'unavailable' });
    await expect(entry(ids[0]).getByRole('button', { name: `${title} 증빙 확보 어려움 해제`, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    let saved = (await data()).careers.find((career: { id: string }) => career.id === ids[0]);
    expect(saved.evidenceStatus).toBe('unavailable'); expect(saved.description).toBe('다른 창에서 바꾼 최신 메모');
    expect(saved.role).toBe('보존할 역할'); expect(saved.tags).toEqual(['보존할 태그']); expect(saved.documentIds).toEqual([]);
    await page.reload();
    await page.getByRole('textbox', { name: '경력 검색', exact: true }).fill(title);
    await expect(entry(ids[0]).locator('.evidence')).toHaveText('확보 어려움');
    await page.screenshot({ path: '/tmp/evidence-unavailable-list.png', animations: 'disabled' });
    await menu.getByRole('button', { name: '홈', exact: true }).click();
    await expect(page.getByRole('button', { name: `증빙 보완할 경력 ${initialMissing - 1}건`, exact: true })).toBeVisible();
    await menu.getByRole('button', { name: '경력 아카이브', exact: true }).click();
    await page.locator('.career-extra-filters > summary').click();
    await page.getByRole('combobox', { name: '증빙 필터', exact: true }).selectOption('증빙 확보 어려움');
    await page.locator('.career-extra-filters > summary').click();
    await expect(entry(ids[0])).toBeVisible();
    await entry(ids[0]).locator('.career-row').click();
    const detail = page.getByRole('dialog', { name: '경력 상세', exact: true });
    await detail.getByRole('button', { name: '경력 수정하기', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '경력 수정하기', exact: true });
    await expect(editor.getByRole('radio', { name: '증빙 확보 어려움', exact: true })).toBeChecked();
    await editor.getByRole('button', { name: '취소', exact: true }).click();
    await detail.getByRole('button', { name: '증빙 확보 어려움 해제', exact: true }).click();
    await expect(detail.getByRole('button', { name: '증빙 확보 어려움', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await page.getByRole('button', { name: '상세 닫기', exact: true }).click();
    await expect(entry(ids[0])).toHaveCount(0);
    await menu.getByRole('button', { name: '홈', exact: true }).click();
    await expect(page.getByRole('button', { name: `증빙 보완할 경력 ${initialMissing}건`, exact: true })).toBeVisible();
    await menu.getByRole('button', { name: '경력 아카이브', exact: true }).click();
    await page.getByRole('textbox', { name: '경력 검색', exact: true }).fill(title);
    await page.route(`**/api/careers/${ids[0]}`, route => route.request().method() === 'PUT' ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '테스트 저장 실패' }) }) : route.continue());
    await entry(ids[0]).getByRole('button', { name: `${title} 증빙 확보 어려움 표시`, exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('테스트 저장 실패');
    expect((await data()).careers.find((career: { id: string }) => career.id === ids[0]).evidenceStatus).toBe('later');
    await expect(entry(ids[0]).getByRole('button', { name: `${title} 증빙 확보 어려움 표시`, exact: true })).toHaveAttribute('aria-pressed', 'false');
    await page.unroute(`**/api/careers/${ids[0]}`);
    await page.getByRole('button', { name: '오류 닫기', exact: true }).click();
    // New proof arrives while the UI is stale; the backend gives it precedence.
    const uploaded = await page.request.post('/api/documents', { multipart: { files: { name: '증빙표시 검증.txt', mimeType: 'text/plain', buffer: Buffer.from('증빙표시 검증, 합성 문서') } } });
    expect(uploaded.ok()).toBeTruthy(); documentId = (await uploaded.json()).documents[0].id;
    await page.request.post(`/api/documents/${documentId}/link`, { data: { careerId: ids[0] } });
    await entry(ids[0]).getByRole('button', { name: `${title} 증빙 확보 어려움 표시`, exact: true }).click();
    await expect(entry(ids[0]).locator('.evidence')).toHaveText('증빙 있음');
    await expect(entry(ids[0]).locator('.evidence-quick-toggle')).toHaveCount(0);
    saved = (await data()).careers.find((career: { id: string }) => career.id === ids[0]);
    expect(saved.evidenceStatus).toBe('attached'); expect(saved.documentIds).toEqual([documentId]); expect(saved.description).toBe('다른 창에서 바꾼 최신 메모');
    expect(saved.role).toBe('보존할 역할'); expect(saved.category).toBe('위원회·지원단');
    expect(errors).toEqual([]);
  } finally {
    await page.unrouteAll();
    for (const id of ids) await page.request.delete(`/api/careers/${id}`);
    if (documentId) await page.request.delete(`/api/documents/${documentId}`);
    expect((await data()).careers).toEqual(before.careers);
    expect((await data()).documents).toEqual(before.documents);
    const workspace = await (await page.request.get('/api/workspace')).json();
    expect(workspace.items).toEqual(originalWorkspace.items); expect(workspace.links).toEqual(originalWorkspace.links);
  }
});
