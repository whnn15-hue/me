import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = async entry => { const out = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false }); return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64')); };
const { celebrationStats, celebrationHeadline, pickAchievements, shouldPlayIntro, markIntroPlayed, countAt, easeOut, subjectParticle, INTRO_STORAGE_KEY } = await bundle('src/growth/celebration.ts');
const { growthModel } = await bundle('src/growth/growth-model.ts');
const career = (id, startDate, fields = {}) => ({ id, title: id, category: '강의·연수', organization: '가상 연수원', startDate, endDate: '', role: '강사', description: '', tags: [], documentIds: [], ...fields });
const today = '2026-11-12';

test('counter targets are factual: dated records, distinct years, named institutions and achievements', () => {
  const careers = [
    career('a', '2019-03-02'), career('b', '2019-09-01', { organization: '다른 기관' }), career('c', '2023-05-01', { organization: '' }),
    career('award', '2024-12-01', { category: '표창', title: '교육감 표창' }),
    career('contest', '2025-11-01', { category: '연구대회', title: '현장교육연구대회 1등급', awardGrade: '1등급' }),
    career('future', '2027-01-01', { category: '표창', title: '예정 표창' }), career('undated', ''),
  ];
  const model = growthModel(careers, [], today);
  const stats = celebrationStats(model, []);
  assert.deepEqual(stats, { total: 5, years: 4, institutions: 2, achievements: 2, first: 2019 });
  const headline = celebrationHeadline(stats);
  assert.equal(headline.title, '2019년부터 쌓아 온 나의 발자취');
  assert.equal(headline.sub, '4개의 해, 2곳의 기관, 2번의 수상과 성과가 지금의 나를 만들었어요.');
  assert.match(celebrationHeadline(celebrationStats(growthModel([], [], today), [])).title, /첫 발자취/);
});

test('subject particle follows the final syllable, including digits', () => {
  assert.equal(subjectParticle('2곳의 기관'), '이');
  assert.equal(subjectParticle('4개의 해'), '가');
  assert.equal(subjectParticle('수상과 성과'), '가');
  assert.equal(subjectParticle('기록 3'), '이');
  assert.equal(subjectParticle('기록 2'), '가');
});

test('achievements are real award/competition records, started already, newest first, capped', () => {
  const careers = [
    career('old-award', '2020-01-01', { category: '표창', title: '2020년 장관 표창' }),
    career('lecture', '2026-01-01'),
    career('new-contest', '2025-11-01', { category: '연구대회', title: '현장교육연구대회', awardGrade: '1등급' }),
    career('mid-award', '2023-06-01', { category: '표창', title: '교육장 표창' }),
    career('future-award', '2026-12-31', { category: '표창', title: '예정' }),
    career('contest-2', '2024-02-01', { category: '연구·수상', title: '교육자료전', description: '우수상 수상' }),
  ];
  const all = pickAchievements(careers, [], today, 10);
  assert.deepEqual(all.map(item => item.id), ['new-contest', 'contest-2', 'mid-award', 'old-award'], 'every eligible record, newest first');
  assert.equal(all[0].grade, '1등급'); assert.equal(all[0].year, 2025);
  const three = pickAchievements(careers, [], today);
  assert.equal(three.length, 3, 'three by default');
  assert.ok(three.every(item => all.some(entry => entry.id === item.id)));
  assert.deepEqual(three.map(item => item.year), [...three.map(item => item.year)].sort((a, b) => b - a), 'shown in date order');
  // Different random draws pick different subsets.
  const seq = values => { let i = 0; return () => values[i++ % values.length]; };
  const a = pickAchievements(careers, [], today, 3, seq([0, 0, 0])).map(item => item.id).sort();
  const b = pickAchievements(careers, [], today, 3, seq([.99, .99, .99])).map(item => item.id).sort();
  assert.notDeepEqual(a, b);
  assert.deepEqual(pickAchievements([career('lecture', '2026-01-01')], [], today), []);
});

test('the intro plays once per session, never with reduced motion or without records', () => {
  const store = new Map(); const storage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  assert.equal(shouldPlayIntro(storage, false, true), true);
  markIntroPlayed(storage); assert.equal(store.get(INTRO_STORAGE_KEY), 'played');
  assert.equal(shouldPlayIntro(storage, false, true), false);
  assert.equal(shouldPlayIntro(new Map() && { getItem: () => null, setItem() {} }, true, true), false, 'reduced motion shows the final state');
  assert.equal(shouldPlayIntro({ getItem: () => null, setItem() {} }, false, false), false, 'no records, no celebration');
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(shouldPlayIntro(broken, false, true), true); assert.doesNotThrow(() => markIntroPlayed(broken));
  assert.equal(shouldPlayIntro(null, false, true), true);
});

test('count-up starts at zero, eases out and lands exactly on the target', () => {
  assert.equal(countAt(77, 100, 180, 1500), 0);
  const mid = countAt(77, 180 + 300, 180, 1500);
  assert.ok(mid > 40 && mid < 77, `ease-out front-loads progress (${mid})`);
  assert.equal(countAt(77, 180 + 1500, 180, 1500), 77);
  assert.equal(countAt(77, 99999, 180, 1500), 77);
  assert.equal(easeOut(-1), 0); assert.equal(easeOut(1), 1); assert.equal(easeOut(2), 1);
  let previous = 0; for (let t = 0; t <= 2000; t += 50) { const value = countAt(1234, t, 180, 1500); assert.ok(value >= previous); previous = value; }
});
