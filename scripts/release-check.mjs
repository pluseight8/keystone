import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const releaseMode = process.argv.includes('--release') || process.env.KEYSTONE_RELEASE === '1';
const results = [];
export const Status = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL', SKIP: 'SKIP', BLOCKED: 'BLOCKED' });

export function parseJsonText(text) {
  try { return { value: JSON.parse(text) }; }
  catch (error) { return { error }; }
}

export function platformAvailability(targetPlatform, hostPlatform = process.platform) {
  return targetPlatform === hostPlatform
    ? { status: Status.PASS }
    : { status: Status.SKIP, detail: `current host is ${hostPlatform}` };
}

function record(status, name, detail = '') {
  results.push({ status, name, detail });
  console.log(`${status.padEnd(7)} ${name}${detail ? ` — ${detail}` : ''}`);
}

export function credentialStatus(value, variable, release = false) {
  if (value && !/REPLACE_WITH|YOUR_|example/i.test(value)) return { status: Status.PASS, detail: `${variable} is configured` };
  return {
    status: Status.BLOCKED,
    detail: `Production ${variable} is not configured. Development builds are unaffected. Release build requires ${variable}.`,
    fatal: release,
  };
}

export function findSecret(text, file, allowlist = []) {
  if (allowlist.some((entry) => entry && file.includes(entry))) return null;
  const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/i,
    /(?:TAURI_SIGNING_PRIVATE_KEY|KEYSTONE_[A-Z_]*SECRET|AWS_SECRET_ACCESS_KEY|GITHUB_TOKEN)\s*[:=]\s*[^\s"']{12,}/,
    /(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{16,}/,
    /Authorization\s*[:=]\s*Bearer\s+[A-Za-z0-9._-]{16,}/i,
  ];
  return patterns.find((pattern) => pattern.test(text)) || null;
}

/**
 * Pick the primary error from a failed command's output. Tools such as cargo
 * end with a generic line ("build failed, waiting for other jobs"), so the
 * first error line and its context are what explain the failure.
 */
export function failureSummary(output, { contextLines = 40 } = {}) {
  const lines = output.replace(/\r/g, '').split('\n');
  // Specific failures (a failing test, a compiler error) beat wrapper noise such as pnpm's ERR_PNPM_* lines.
  // `pnpm -r` prefixes lines with "<package> <script>: ", so markers are matched after optional text.
  const primary = lines.findIndex((line) => /(?:^|\s)(?:FAIL\s+\S|×\s|error(?:\[[A-Z0-9]+\])?:)/.test(line));
  const first = primary >= 0 ? primary : lines.findIndex((line) => /(?:^|\s)(?:ERR!|ERR_|Error:)/.test(line));
  const start = first >= 0 ? first : Math.max(0, lines.length - contextLines);
  const excerpt = lines.slice(start, start + contextLines).join('\n').trim();
  const headline = (first >= 0 ? lines[first] : lines.filter((line) => line.trim()).at(-1) ?? '').trim();
  return { headline, excerpt };
}

function command(name, args, label) {
  const result = spawnSync(name, args, { cwd: root, encoding: 'utf8', stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) return record(Status.FAIL, label, result.error.message);
  if (result.status === 0) return record(Status.PASS, label);
  const { headline, excerpt } = failureSummary(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  record(Status.FAIL, label, headline || `exit ${result.status}`);
  // Keep the evidence in the CI log instead of only the last line.
  console.log(process.env.GITHUB_ACTIONS ? `::group::${label} output` : `--- ${label} output ---`);
  console.log(excerpt);
  console.log(process.env.GITHUB_ACTIONS ? '::endgroup::' : `--- end ${label} output ---`);
}

// The Expo native Android project is ignored for prebuild output but its committed sources are intentional.
const TRACKED_IGNORED_ALLOWLIST = ['apps/mobile/android/'];

export function unexpectedTrackedArtifacts(files, allowlist = TRACKED_IGNORED_ALLOWLIST) {
  return files.filter((file) => file && !allowlist.some((prefix) => file.startsWith(prefix)));
}

function trackedIgnoredFiles() {
  const listed = spawnSync('git', ['ls-files', '-ci', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return listed.status === 0 ? unexpectedTrackedArtifacts(listed.stdout.split('\n')) : [];
}

function json(path) {
  try {
    const parsed = parseJsonText(readFileSync(resolve(root, path), 'utf8'));
    if (parsed.error) throw parsed.error;
    return parsed.value;
  } catch (error) { record(Status.FAIL, `JSON ${path}`, error.message); return null; }
}

function configChecks() {
  const rootPackage = json('package.json');
  const tauri = json('apps/desktop/src-tauri/tauri.conf.json');
  const capability = json('apps/desktop/src-tauri/capabilities/main.json');
  const mobile = json('apps/mobile/app.json');
  const androidManifestPath = resolve(root, 'apps/mobile/android/app/src/main/AndroidManifest.xml');
  const eas = json('apps/mobile/eas.json');
  const chromium = json('apps/extension/public/manifest.json');
  const firefox = json('apps/extension/manifest.firefox.json');
  const gitignore = readFileSync(resolve(root, '.gitignore'), 'utf8');
  if (rootPackage && rootPackage.packageManager === 'pnpm@9.15.0' && rootPackage.engines?.node === '>=22 <23') record(Status.PASS, 'Toolchain metadata');
  else record(Status.FAIL, 'Toolchain metadata', 'packageManager or Node engine is missing');
  if (tauri && tauri.identifier === 'org.keystone.app' && tauri.bundle?.createUpdaterArtifacts === false && !tauri.plugins?.updater) record(Status.PASS, 'Tauri development configuration');
  else record(Status.FAIL, 'Tauri development configuration', 'development config must keep the production updater disabled');
  if (capability && !capability.permissions?.some((item) => item.startsWith('updater:'))) record(Status.PASS, 'Tauri updater capability boundary');
  else record(Status.FAIL, 'Tauri updater capability boundary', 'updater permission must not be exposed in development');
  if (mobile && !JSON.stringify(mobile).includes('YOUR_EXPO_PROJECT_ID') && !mobile.expo?.updates && existsSync(resolve(root, 'apps/mobile/app.config.cjs'))) record(Status.PASS, 'Expo development configuration');
  else record(Status.FAIL, 'Expo development configuration', 'OTA config must be generated only when configured');
  const androidManifest = existsSync(androidManifestPath) ? readFileSync(androidManifestPath, 'utf8') : '';
  if (androidManifest && !androidManifest.includes('YOUR_EXPO_PROJECT_ID') && androidManifest.includes('expo.modules.updates.ENABLED" android:value="false"')) record(Status.PASS, 'Android development manifest');
  else record(Status.FAIL, 'Android development manifest', 'stale OTA placeholder or enabled OTA found');
  if (eas?.cli?.version && chromium?.manifest_version === 3 && firefox?.manifest_version === 3) record(Status.PASS, 'Mobile and extension metadata');
  else record(Status.FAIL, 'Mobile and extension metadata', 'invalid EAS or extension manifest');
  const ignoredArtifacts = ['dist', 'coverage', 'apps/mobile/android', 'apps/mobile/ios', 'apps/desktop/src-tauri/target', '*.apk', '*.dmg', '*.msi'];
  const trackedArtifacts = trackedIgnoredFiles();
  if (!ignoredArtifacts.every((entry) => gitignore.includes(entry))) record(Status.FAIL, 'Generated artifact policy', 'missing build artifact ignore rule');
  else if (trackedArtifacts.length) record(Status.FAIL, 'Generated artifact policy', `${trackedArtifacts.length} ignored build artifacts are still tracked, e.g. ${trackedArtifacts.slice(0, 3).join(', ')}`);
  else record(Status.PASS, 'Generated artifact policy');
}

function flatpakChecks() {
  const path = 'apps/desktop/flatpak/org.keystone.app.yml';
  if (!existsSync(resolve(root, path))) return record(Status.FAIL, 'Flatpak manifest', 'missing manifest');
  const text = readFileSync(resolve(root, path), 'utf8');
  const required = ['app-id: org.keystone.app', 'command: keystone', 'install -Dm755 keystone-desktop /app/bin/keystone', 'path: ../src-tauri/target/release/keystone-desktop'];
  const extraPermission = /--filesystem=host|--talk-name=org\.freedesktop\.Flatpak|--socket=system-bus/.test(text);
  if (required.every((item) => text.includes(item)) && !extraPermission) record(Status.PASS, 'Flatpak static manifest and permissions');
  else record(Status.FAIL, 'Flatpak static manifest and permissions', 'binary path/command mismatch or overly broad permission');
  const binary = resolve(root, 'apps/desktop/src-tauri/target/release/keystone-desktop');
  if (existsSync(binary) && statSync(binary).isFile()) record(Status.PASS, 'Flatpak staged binary');
  else record(Status.SKIP, 'Flatpak staged binary', 'created by a Linux Tauri release build');
  if (process.platform !== 'linux') record(Status.SKIP, 'Flatpak builder', `current host is ${process.platform}`);
  else if (!hasCommand('flatpak-builder')) record(Status.SKIP, 'Flatpak builder', 'flatpak-builder is not installed');
  else record(Status.PASS, 'Flatpak builder available');
}

function hasCommand(name) {
  return spawnSync(name, ['--version'], { cwd: root, stdio: 'ignore' }).status === 0;
}

function secretChecks() {
  const allowlist = existsSync(resolve(root, '.keystone-secret-scan-allowlist'))
    ? readFileSync(resolve(root, '.keystone-secret-scan-allowlist'), 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [];
  let files = [];
  try { files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean); }
  catch (error) { return record(Status.FAIL, 'Secret scan', error.message); }
  const findings = [];
  for (const file of files) {
    if (/^(node_modules|\.git|apps\/desktop\/src-tauri\/target)\//.test(file) || /\.(png|jpg|jpeg|gif|ico|pdf|lock)$/.test(file)) continue;
    if (basename(file).startsWith('.env')) findings.push(`${file} (environment file)`);
    else {
      try { if (findSecret(readFileSync(resolve(root, file), 'utf8'), file, allowlist)) findings.push(file); } catch { /* non-text files are ignored */ }
    }
  }
  if (findings.length) record(Status.FAIL, 'Secret scan', findings.slice(0, 5).join(', '));
  else record(Status.PASS, 'Secret scan');
}

function safetyChecks() {
  const source = readFileSync(resolve(root, 'apps/desktop/src-tauri/src/lib.rs'), 'utf8');
  const browserContract = readFileSync(resolve(root, 'packages/browser-engine/src/tauri.ts'), 'utf8');
  const forbidden = ['evaluate_browser', 'ui_action', 'Enigo', 'execute_shell', 'run_javascript'];
  const present = forbidden.filter((item) => source.includes(item) || browserContract.includes(item));
  if (present.length) record(Status.FAIL, 'Desktop IPC regression guard', present.join(', '));
  else record(Status.PASS, 'Desktop IPC regression guard');
}

function platformChecks() {
  if (hasCommand('cargo')) command('cargo', ['check', '--manifest-path', 'apps/desktop/src-tauri/Cargo.toml'], 'Rust/Tauri compile');
  else record(Status.SKIP, 'Rust/Tauri compile', 'Cargo is not installed');
  if (process.platform === 'win32') record(Status.SKIP, 'Windows installer', 'requires a signed/release workflow');
  else record(Status.SKIP, 'Windows installer', `current host is ${process.platform}`);
  if (process.platform === 'darwin') record(Status.SKIP, 'macOS notarization', 'owner Apple credentials are required');
  else record(Status.SKIP, 'macOS notarization', `current host is ${process.platform}`);
  record(Status.SKIP, 'Android physical-device test', 'requires an owner-controlled device or emulator');
  record(Status.SKIP, 'iOS physical-device test', 'experimental and requires macOS/Xcode plus Apple credentials');
}

function releaseCredentials() {
  for (const [value, variable] of [[process.env.KEYSTONE_TAURI_UPDATER_PUBLIC_KEY, 'KEYSTONE_TAURI_UPDATER_PUBLIC_KEY'], [process.env.KEYSTONE_EXPO_PROJECT_ID, 'KEYSTONE_EXPO_PROJECT_ID']]) {
    const result = credentialStatus(value, variable, releaseMode);
    record(result.status, `${variable} release credential`, result.detail);
  }
  if (releaseMode && (!process.env.TAURI_SIGNING_PRIVATE_KEY || !process.env.ANDROID_KEYSTORE_PATH)) {
    record(Status.BLOCKED, 'Release signing credentials', 'TAURI_SIGNING_PRIVATE_KEY and ANDROID_KEYSTORE_PATH are required for a signed production release');
  } else if (releaseMode) record(Status.PASS, 'Release signing credentials');
  else record(Status.SKIP, 'Release signing credentials', 'not required for development preflight');
}

function main() {
  console.log(`Keystone release preflight (${releaseMode ? 'release' : 'development'} mode, ${process.platform})`);
  command('git', ['diff', '--check'], 'Git whitespace check');
  configChecks(); safetyChecks(); flatpakChecks(); secretChecks(); releaseCredentials();
  command('pnpm', ['tsc'], 'TypeScript');
  command('pnpm', ['test'], 'Unit tests');
  command('pnpm', ['test:release-tools'], 'Release tooling tests');
  command('pnpm', ['build'], 'Production workspace builds');
  platformChecks();
  const fatal = results.some((item) => item.status === Status.FAIL) || (releaseMode && results.some((item) => item.status === Status.BLOCKED));
  console.log(`\nResult: ${fatal ? 'FAIL' : 'PASS'} (${results.filter((item) => item.status === Status.PASS).length} pass, ${results.filter((item) => item.status === Status.SKIP).length} skip, ${results.filter((item) => item.status === Status.BLOCKED).length} blocked)`);
  if (fatal) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
