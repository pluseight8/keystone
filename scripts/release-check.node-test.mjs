import assert from 'node:assert/strict';
import test from 'node:test';
import { Status, credentialStatus, findSecret, parseJsonText, platformAvailability } from './release-check.mjs';

test('placeholder credential is blocked in development without failing the model', () => {
  const result = credentialStatus('REPLACE_WITH_TAURI_UPDATER_PUBLIC_KEY', 'KEYSTONE_TAURI_UPDATER_PUBLIC_KEY');
  assert.equal(result.status, Status.BLOCKED);
  assert.equal(result.fatal, false);
});

test('missing production credential is fatal in release mode', () => {
  const result = credentialStatus('', 'KEYSTONE_EXPO_PROJECT_ID', true);
  assert.equal(result.status, Status.BLOCKED);
  assert.equal(result.fatal, true);
});

test('secret scanner detects a fixture and honors an allowlisted path', () => {
  assert.match(String(findSecret('token=sk_example_abcdefghijklmnop', 'fixture.txt')), /sk/);
  assert.equal(findSecret('token=sk_example_abcdefghijklmnop', 'test/fixture.txt', ['test/fixture']), null);
});

test('corrupted configuration is rejected', () => {
  assert.ok(parseJsonText('{not json').error);
  assert.deepEqual(parseJsonText('{"ok":true}').value, { ok: true });
});

test('platform-specific work is skipped on a different host', () => {
  const result = platformAvailability('win32', 'linux');
  assert.equal(result.status, Status.SKIP);
});
