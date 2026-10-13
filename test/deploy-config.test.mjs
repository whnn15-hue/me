import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, access, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cloudConfiguration, writeCloudConfiguration } from '../scripts/prepare-cloud-config.mjs';

const options = { project: 'career-test-project', site: 'https://career-test.netlify.app', owner: 'owner@example.com' };
const sdk = { apiKey: 'public-browser-key', authDomain: 'career-test-project.firebaseapp.com', projectId: options.project, storageBucket: 'career-test-project.firebasestorage.app', appId: '1:123:web:example', messagingSenderId: '123' };
const paidOptions = { ...options, mode: 'paid', bucket: sdk.storageBucket };

test('cloud configuration rejects unsafe origins and accidental service-account JSON', () => {
  for (const site of ['http://career-test.netlify.app', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'https://career-test.netlify.app/private', 'https://user:password@career-test.netlify.app', 'https://career-test.netlify.app/?token=private']) {
    assert.throws(() => cloudConfiguration({ ...options, site }, sdk), /HTTPS/);
  }
  assert.throws(() => cloudConfiguration(options, { ...sdk, private_key: 'do-not-output-this' }), error => /서비스 계정/.test(error.message) && !error.message.includes('do-not-output-this'));
});

test('cloud configuration cannot silently cross projects or buckets', () => {
  assert.throws(() => cloudConfiguration(options, { ...sdk, projectId: 'other-project' }), /projectId/);
  assert.throws(() => cloudConfiguration(paidOptions, { ...sdk, storageBucket: 'other-bucket.appspot.com' }), /storageBucket/);
  assert.throws(() => cloudConfiguration({ ...paidOptions, apiUrl: 'https://api.example.com/api' }, sdk), /\/api/);
  assert.throws(() => cloudConfiguration({ ...options, drive: true }, sdk), /google-client-id/);
});

test('free is the default and cannot silently activate paid runtime or publish owner identity', () => {
  const { storageBucket, ...withoutBucket } = sdk;
  const config = cloudConfiguration(options, withoutBucket);
  assert.equal(config.mode, 'free');
  assert.ok(config.frontend.includes('VITE_DEPLOYMENT_MODE="free"'));
  assert.doesNotMatch(config.frontend, /VITE_API_ORIGIN|STORAGE_BUCKET/);
  assert.doesNotMatch(config.server, /APP_API_URL|STORAGE_BUCKET|FUNCTION_REGION|SERVICE_ACCOUNT/);
  assert.equal(config.cors, undefined);
  assert.ok(!config.frontend.includes(options.owner));
  assert.ok(config.server.includes('APP_FIREBASE_WEB_API_KEY="public-browser-key"'));
  assert.throws(() => cloudConfiguration({ ...options, bucket: storageBucket }, sdk), /--mode paid/);
  assert.throws(() => cloudConfiguration({ ...options, mode: 'unknown' }, sdk), /free 또는 paid/);
});

test('paid configuration scopes CORS to the site and leaves secrets out of deploy files', () => {
  const config = cloudConfiguration({ ...paidOptions, ai: true, drive: true, googleClientId: 'public-client.apps.googleusercontent.com' }, sdk);
  const cors = JSON.parse(config.cors);
  assert.deepEqual(cors[0].origin, [options.site]);
  assert.ok(config.server.includes('APP_API_URL="https://asia-northeast3-career-test-project.cloudfunctions.net/careerApi"'));
  assert.ok(config.frontend.includes('VITE_API_ORIGIN="https://asia-northeast3-career-test-project.cloudfunctions.net/careerApi"'));
  assert.ok(config.server.includes('APP_AI_ENABLED="true"'));
  assert.ok(config.server.includes('APP_DRIVE_ENABLED="true"'));
  assert.doesNotMatch(config.server, /^(?:FIREBASE_|APP_AI_KEY|GOOGLE_CLIENT_SECRET|APP_ENCRYPTION_KEY)/m);
  assert.doesNotMatch(config.frontend, /SECRET|ENCRYPTION|AI_KEY/);
  assert.ok(!config.frontend.includes(options.owner));
});

test('free configuration writes preserve existing credentials and roll back partial output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'career-deploy-'));
  try {
    const config = cloudConfiguration(options, sdk);
    await mkdir(join(root, '.cloud-local'));
    const existing = join(root, '.cloud-local', 'netlify-server.env');
    await writeFile(existing, 'EXISTING_SECRET=preserve-local-value\n');
    await assert.rejects(writeCloudConfiguration(root, config), /이미 있습니다/);
    assert.equal(await readFile(existing, 'utf8'), 'EXISTING_SECRET=preserve-local-value\n');
    await assert.rejects(access(join(root, '.env.production.local')), { code: 'ENOENT' });
    await rm(existing);
    const created = await writeCloudConfiguration(root, config);
    assert.equal(created.length, 3);
    await assert.rejects(writeCloudConfiguration(root, config), /이미 있습니다/);
    assert.equal(await readFile(join(root, '.env.production.local'), 'utf8'), config.frontend);
    assert.equal(await readFile(existing, 'utf8'), config.server);
    assert.equal((await stat(existing)).mode & 0o777, 0o600);
    assert.equal(await readFile(join(root, '.cloud-local', 'firestore.rules'), 'utf8'), config.rules);
    await assert.rejects(access(join(root, 'functions')), { code: 'ENOENT' });
    await assert.rejects(access(join(root, '.cloud-local', 'storage-cors.json')), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('paid opt-in writes its separate backend configuration without adding free server files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'career-paid-'));
  try {
    const config = cloudConfiguration(paidOptions, sdk);
    await writeCloudConfiguration(root, config);
    assert.equal(await readFile(join(root, 'functions', `.env.${options.project}`), 'utf8'), config.server);
    await assert.rejects(access(join(root, '.cloud-local', 'netlify-server.env')), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
