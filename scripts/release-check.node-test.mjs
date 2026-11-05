import assert from 'node:assert/strict';
import test from 'node:test';
import { Status, credentialStatus, failureSummary, unexpectedTrackedArtifacts, findSecret, parseJsonText, platformAvailability } from './release-check.mjs';

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

test('failure summary reports the first cargo error, not the trailing generic line', () => {
  const output = [
    '   Compiling pkg-config v0.3.33',
    'error: failed to run custom build command for `webkit2gtk-sys v2.0.2`',
    '  The system library `webkit2gtk-4.1` required by crate `webkit2gtk-sys` was not found.',
    'warning: build failed, waiting for other jobs to finish...',
  ].join('\n');
  const summary = failureSummary(output);
  assert.equal(summary.headline, 'error: failed to run custom build command for `webkit2gtk-sys v2.0.2`');
  assert.match(summary.excerpt, /webkit2gtk-4\.1/);
});

test('failure summary falls back to the last non-empty line', () => {
  assert.equal(failureSummary('ok\nsomething went wrong\n\n').headline, 'something went wrong');
});

test('tracked build outputs are reported while the committed Android project is allowed', () => {
  assert.deepEqual(unexpectedTrackedArtifacts(['apps/desktop/src-tauri/target/.rustc_info.json', 'apps/mobile/android/app/build.gradle', '']), ['apps/desktop/src-tauri/target/.rustc_info.json']);
});

test('failure summary prefers the failing test over the pnpm wrapper error', () => {
  const output = [
    'packages/core test:  ✓ src/a.test.ts (3 tests)',
    'packages/core test:  FAIL  src/shared-vaults.test.ts > replicates notes',
    'packages/core test: AssertionError: expected undefined to be defined',
    ' ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @keystone/core@0.1.0 test: `vitest run`',
  ].join('\n');
  assert.equal(failureSummary(output).headline, 'packages/core test:  FAIL  src/shared-vaults.test.ts > replicates notes');
});
