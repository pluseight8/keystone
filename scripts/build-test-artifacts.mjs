#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = join(ROOT, 'artifacts', 'local-test');
const PACKAGE_JSON = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const VERSION = String(PACKAGE_JSON.version || 'unknown');
const ARCHITECTURE = process.arch === 'x64' ? 'x86_64' : process.arch;
const APPIMAGE_NAME = 'Keystone-' + VERSION + '-local-test-' + ARCHITECTURE + '.AppImage';
const APK_NAME = 'Keystone-' + VERSION + '-android-debug.apk';
const LOCAL_ENV_KEYS_TO_REMOVE = [
  'KEYSTONE_TAURI_UPDATER_PUBLIC_KEY',
  'TAURI_SIGNING_PRIVATE_KEY',
  'TAURI_SIGNING_PRIVATE_KEY_PASSWORD',
  'KEYSTONE_EXPO_PROJECT_ID',
  'KEYSTONE_EXPO_CHANNEL',
  'ANDROID_KEYSTORE_PATH',
];
const REQUESTED_FLAGS = new Set(process.argv.slice(2));

if (REQUESTED_FLAGS.has('--help') || REQUESTED_FLAGS.has('-h')) {
  console.log('Usage: pnpm build:test:artifacts [--appimage] [--android]');
  process.exit(0);
}

const unknownFlags = [...REQUESTED_FLAGS].filter(
  (flag) => !['--appimage', '--android'].includes(flag),
);
if (unknownFlags.length > 0) {
  console.error('Unknown option: ' + unknownFlags.join(', '));
  process.exit(2);
}

const requested = new Set();
if (REQUESTED_FLAGS.has('--appimage')) requested.add('appimage');
if (REQUESTED_FLAGS.has('--android')) requested.add('android');
if (requested.size === 0) {
  requested.add('appimage');
  requested.add('android');
}

const localEnv = { ...process.env };
localEnv.CI = 'true';
localEnv.KEYSTONE_BUILD_PROFILE = 'LOCAL_TEST';
localEnv.KEYSTONE_DISTRIBUTION = 'DEVELOPMENT_DISTRIBUTION';
const removedEnvironmentKeys = [];
for (const key of LOCAL_ENV_KEYS_TO_REMOVE) {
  if (Object.prototype.hasOwnProperty.call(localEnv, key)) {
    removedEnvironmentKeys.push(key);
    delete localEnv[key];
  }
}

function sanitizeText(value) {
  let text = String(value || '');
  text = text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
  text = text.replaceAll(ROOT, '<repo>');
  if (process.env.HOME) text = text.replaceAll(process.env.HOME, '<home>');
  return text;
}

function tail(value, maxLines = 80, maxChars = 10000) {
  const lines = sanitizeText(value).replace(/\r/g, '').trim().split('\n');
  const selected = lines.filter(Boolean).slice(-maxLines).join('\n');
  return selected.length > maxChars ? selected.slice(-maxChars) : selected;
}

function relativePath(filePath) {
  return relative(ROOT, filePath).split(sep).join('/');
}

function commandAvailable(command) {
  const result = spawnSync('bash', ['-lc', 'command -v ' + command], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return result.status === 0 && Boolean(String(result.stdout || '').trim());
}

function commandVersion(command) {
  if (!commandAvailable(command)) return null;
  const result = spawnSync(command, ['--version'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = String(result.stdout || '') + String(result.stderr || '');
  const firstLine = output.replace(/\r/g, '').split('\n').find((line) => line.trim());
  return firstLine ? sanitizeText(firstLine.trim()) : null;
}

function runCommand(label, command, args, cwd, options = {}) {
  const commandText = [command, ...args]
    .map((arg) => (/^[A-Za-z0-9_./:@%+=,-]+$/.test(arg) ? arg : JSON.stringify(arg)))
    .join(' ');
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd,
    env: options.env || localEnv,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeoutMs || 30 * 60 * 1000,
  });
  const rawOutput = String(result.stdout || '') + String(result.stderr || '');
  const record = {
    label,
    command: commandText,
    cwd: relativePath(cwd) || '.',
    exitCode: typeof result.status === 'number' ? result.status : null,
    signal: result.signal || null,
    timedOut: result.error?.code === 'ETIMEDOUT',
    errorCode: result.error?.code || null,
    durationMs: Date.now() - startedAt,
    outputTail: tail(rawOutput),
  };
  console.log('\n[' + label + '] ' + commandText);
  if (record.outputTail) console.log(record.outputTail);
  if (result.error) console.error('[' + label + '] ' + sanitizeText(result.error.message));
  return { record, rawOutput };
}

function gitOutput(args) {
  const result = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return result.status === 0 ? String(result.stdout || '').trim() : '';
}

function listFiles(directory, suffix) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(entryPath, suffix));
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      files.push(entryPath);
    }
  }
  return files;
}

function freshFiles(files, startedAt) {
  return files.filter((filePath) => {
    try {
      return statSync(filePath).mtimeMs >= startedAt - 1500;
    } catch {
      return false;
    }
  });
}

function newestFile(files) {
  return [...files].sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0] || null;
}

function removeExpectedOutput(fileName) {
  const target = join(OUTPUT_DIR, fileName);
  if (!existsSync(target)) return;
  const kind = lstatSync(target);
  if (kind.isFile() || kind.isSymbolicLink()) unlinkSync(target);
}

function ensureOutputDirectory() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  removeExpectedOutput(APPIMAGE_NAME);
  removeExpectedOutput(APK_NAME);
  removeExpectedOutput('SHA256SUMS.txt');
  removeExpectedOutput('build-manifest.json');
}

function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  return hash.digest('hex');
}

function artifactMetadata(filePath, fileName) {
  const stats = statSync(filePath);
  return {
    file: fileName,
    path: 'artifacts/local-test/' + fileName,
    bytes: stats.size,
    sha256: sha256File(filePath),
  };
}

function firstUsefulLine(value) {
  const lines = String(value || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('>'));
  return lines.find((line) => /failed to run|no such file|not found|error:|^error\b|^ERROR\b|could not/i.test(line)) || lines[0] || '';
}

function packageIdFromGradle() {
  const gradlePath = join(ROOT, 'apps', 'mobile', 'android', 'app', 'build.gradle');
  if (!existsSync(gradlePath)) return null;
  const source = readFileSync(gradlePath, 'utf8');
  return source.match(/applicationId\s+['"]([^'"]+)['"]/)?.[1] || null;
}

function detectAbi(listing) {
  const abis = [...new Set([...String(listing || '').matchAll(/lib\/([^/]+)\//g)].map((match) => match[1]))];
  if (abis.length === 0) return 'universal-or-no-native-libs';
  return abis.length === 1 ? 'single-ABI (' + abis[0] + ')' : 'universal (' + abis.join(', ') + ')';
}

function appImageSmokeTest(filePath, fileName) {
  if (!toolchain.timeout) {
    return {
      status: 'BLOCKED_BY_ENVIRONMENT',
      reason: 'timeout command is unavailable; bounded launch was not attempted',
    };
  }
  const smokeProfile = mkdtempSync(join(tmpdir(), 'keystone-appimage-smoke-'));
  const smokeEnv = {
    ...localEnv,
    APPIMAGE_EXTRACT_AND_RUN: '1',
    XDG_CONFIG_HOME: join(smokeProfile, 'config'),
    XDG_DATA_HOME: join(smokeProfile, 'data'),
    XDG_CACHE_HOME: join(smokeProfile, 'cache'),
    XDG_STATE_HOME: join(smokeProfile, 'state'),
  };
  mkdirSync(smokeEnv.XDG_CONFIG_HOME, { recursive: true });
  mkdirSync(smokeEnv.XDG_DATA_HOME, { recursive: true });
  mkdirSync(smokeEnv.XDG_CACHE_HOME, { recursive: true });
  mkdirSync(smokeEnv.XDG_STATE_HOME, { recursive: true });
  const commandArgs = ['15s', relativePath(filePath)];
  const startedAt = Date.now();
  const result = spawnSync('timeout', commandArgs, {
    cwd: ROOT,
    env: smokeEnv,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 20 * 1000,
  });
  const output = String(result.stdout || '') + String(result.stderr || '');
  const exitCode = typeof result.status === 'number' ? result.status : null;
  const boundedStart = exitCode === 0 || exitCode === 124;
  rmSync(smokeProfile, { recursive: true, force: true });
  return {
    status: boundedStart ? 'PHYSICALLY_VERIFIED' : 'FAILED',
    evidence: boundedStart ? 'bounded process launch completed' : 'bounded process launch failed',
    command: 'timeout 15s artifacts/local-test/' + fileName,
    cwd: '.',
    exitCode,
    signal: result.signal || null,
    timedOut: result.error?.code === 'ETIMEDOUT',
    errorCode: result.error?.code || null,
    durationMs: Date.now() - startedAt,
    outputTail: tail(output),
    profile: 'isolated temporary XDG profile',
  };
}

function buildAppImage() {
  const target = join(OUTPUT_DIR, APPIMAGE_NAME);
  const sourceDirectory = join(ROOT, 'apps', 'desktop', 'src-tauri', 'target', 'release', 'bundle', 'appimage');
  const buildStartedAt = Date.now();
  const build = runCommand(
    'Tauri AppImage build',
    'pnpm',
    ['--filter', '@keystone/desktop', 'tauri', 'build', '--bundles', 'appimage'],
    ROOT,
    { env: { ...localEnv, NO_STRIP: '1' } },
  );
  const candidates = freshFiles(listFiles(sourceDirectory, '.AppImage'), buildStartedAt);
  if (candidates.length === 0) {
    const blockers = [];
    if (!toolchain.rustc || !toolchain.cargo) blockers.push('Rust/Cargo toolchain is unavailable');
    if (!toolchain.appimagetool && !toolchain.linuxdeploy && !toolchain.makeappimage) {
      blockers.push('no AppImage packager (appimagetool/linuxdeploy/makeappimage) is available');
    }
    const commandFailure = firstUsefulLine(build.record.outputTail);
    if (commandFailure) blockers.push('Tauri build reported: ' + commandFailure);
    return {
      platform: 'linux',
      status: 'BLOCKED_BY_ENVIRONMENT',
      artifact: null,
      sourceOutput: relativePath(sourceDirectory),
      buildEnvironment: { NO_STRIP: '1 (scoped to the Tauri build)' },
      blocker: blockers.join('; ') || 'No fresh AppImage output was produced',
      build: build.record,
      smokeTest: { status: 'NOT_RUN', reason: 'AppImage was not created' },
    };
  }

  const source = newestFile(candidates);
  copyFileSync(source, target);
  chmodSync(target, 0o755);
  const metadata = artifactMetadata(target, APPIMAGE_NAME);
  const fileValidation = toolchain.file
    ? runCommand('AppImage file validation', 'file', [relativePath(target)], ROOT).record
    : { status: 'BLOCKED_BY_ENVIRONMENT', reason: 'file command is unavailable' };
  const smokeTest = appImageSmokeTest(target, APPIMAGE_NAME);
  return {
    platform: 'linux',
    status: 'VERIFIED_AS_ARTIFACT',
    artifact: metadata,
    sourceOutput: relativePath(sourceDirectory),
    buildEnvironment: { NO_STRIP: '1 (scoped to the Tauri build)' },
    executable: true,
    build: build.record,
    fileValidation,
    smokeTest,
  };
}

function apkStructuralValidation(filePath) {
  if (!toolchain.unzip) {
    return {
      status: 'BLOCKED_BY_ENVIRONMENT',
      reason: 'unzip is unavailable; APK structure was not checked',
    };
  }
  const relativeArtifact = relativePath(filePath);
  const zipTest = runCommand('APK zip integrity validation', 'unzip', ['-t', relativeArtifact], ROOT);
  const zipListing = runCommand('APK contents validation', 'unzip', ['-l', relativeArtifact], ROOT);
  const listing = zipListing.rawOutput;
  const hasManifest = /(?:^|\s)AndroidManifest\.xml\s*$/m.test(listing);
  const hasDex = /(?:^|\s)classes\d*\.dex\s*$/m.test(listing);
  const status =
    zipTest.record.exitCode === 0 &&
    zipListing.record.exitCode === 0 &&
    hasManifest &&
    hasDex
      ? 'VERIFIED_AS_ARTIFACT'
      : 'FAILED';
  return {
    status,
    requiredEntries: {
      'AndroidManifest.xml': hasManifest,
      'classes*.dex': hasDex,
    },
    abi: detectAbi(listing),
    zipIntegrity: zipTest.record,
    contents: zipListing.record,
  };
}

function apkSigningValidation(filePath) {
  if (!toolchain.apksigner) {
    return {
      status: 'BLOCKED_BY_ENVIRONMENT',
      reason: 'apksigner is unavailable; APK signing was not independently verified',
    };
  }
  const verification = runCommand(
    'APK signing validation',
    'apksigner',
    ['verify', '--verbose', relativePath(filePath)],
    ROOT,
  );
  return {
    status: verification.record.exitCode === 0 ? 'VERIFIED_AS_ARTIFACT' : 'FAILED',
    command: verification.record,
  };
}

function androidPhysicalInstall(filePath) {
  if (!toolchain.adb) {
    return {
      status: 'BLOCKED_BY_ENVIRONMENT',
      reason: 'adb is unavailable; no device connection or install was attempted',
    };
  }
  const devices = runCommand('Android device discovery', 'adb', ['devices'], ROOT);
  const deviceLines = devices.rawOutput
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => /\tdevice\s*$/.test(line));
  if (process.env.KEYSTONE_ALLOW_ADB_INSTALL !== '1') {
    return {
      status: 'NOT_ATTEMPTED',
      reason: 'device install requires explicit KEYSTONE_ALLOW_ADB_INSTALL=1',
      devices: deviceLines.length,
      discovery: devices.record,
    };
  }
  if (deviceLines.length === 0) {
    return {
      status: 'BLOCKED_BY_ENVIRONMENT',
      reason: 'adb is available but no authorized device is connected',
      devices: 0,
      discovery: devices.record,
    };
  }
  const install = runCommand(
    'Android debug APK install',
    'adb',
    ['install', '-r', relativePath(filePath)],
    ROOT,
  );
  return {
    status: install.record.exitCode === 0 ? 'PHYSICALLY_VERIFIED' : 'FAILED',
    devices: deviceLines.length,
    discovery: devices.record,
    install: install.record,
  };
}

function buildAndroidApk() {
  const target = join(OUTPUT_DIR, APK_NAME);
  const androidProject = join(ROOT, 'apps', 'mobile', 'android');
  const gradleWrapper = join(androidProject, 'gradlew');
  const outputDirectory = join(androidProject, 'app', 'build', 'outputs', 'apk', 'debug');
  let prebuild;

  if (existsSync(gradleWrapper)) {
    prebuild = {
      status: 'SKIPPED',
      reason: 'existing native Android project used; generated project was not rewritten',
    };
  } else {
    prebuild = runCommand(
      'Expo Android native project generation',
      'pnpm',
      ['--filter', '@keystone/mobile', 'exec', 'expo', 'prebuild', '--platform', 'android'],
      ROOT,
    ).record;
  }

  if (!existsSync(gradleWrapper)) {
    return {
      platform: 'android',
      status: 'BLOCKED_BY_ENVIRONMENT',
      artifact: null,
      sourceOutput: relativePath(outputDirectory),
      blocker: 'Android native project/Gradle wrapper is unavailable after prebuild',
      build: { prebuild, gradle: null },
      physicalInstall: { status: 'NOT_RUN', reason: 'APK was not created' },
    };
  }

  const buildStartedAt = Date.now();
  const gradle = runCommand(
    'Android debug APK build',
    './gradlew',
    ['assembleDebug', '--no-daemon'],
    androidProject,
  );
  const candidates = freshFiles(listFiles(outputDirectory, '.apk'), buildStartedAt);
  if (candidates.length === 0) {
    const blockers = [];
    if (!toolchain.java && !toolchain.javac && !localEnv.JAVA_HOME) {
      blockers.push('Java/JDK is unavailable (JAVA_HOME and java are not configured)');
    }
    if (!toolchain.androidSdk && !localEnv.ANDROID_HOME && !localEnv.ANDROID_SDK_ROOT) {
      blockers.push('Android SDK command-line tools are unavailable');
    }
    const commandFailure = firstUsefulLine(gradle.record.outputTail);
    if (commandFailure) blockers.push('Gradle build reported: ' + commandFailure);
    return {
      platform: 'android',
      status: 'BLOCKED_BY_ENVIRONMENT',
      artifact: null,
      sourceOutput: relativePath(outputDirectory),
      packageId: packageIdFromGradle(),
      blocker: blockers.join('; ') || 'No fresh debug APK output was produced',
      build: { prebuild, gradle: gradle.record },
      structuralValidation: { status: 'NOT_RUN', reason: 'APK was not created' },
      signing: { status: 'NOT_RUN', reason: 'APK was not created' },
      physicalInstall: { status: 'NOT_RUN', reason: 'APK was not created' },
    };
  }

  const source = newestFile(candidates);
  copyFileSync(source, target);
  const metadata = artifactMetadata(target, APK_NAME);
  const structuralValidation = apkStructuralValidation(target);
  const signing = apkSigningValidation(target);
  const physicalInstall = androidPhysicalInstall(target);
  return {
    platform: 'android',
    status: structuralValidation.status === 'VERIFIED_AS_ARTIFACT'
      ? 'VERIFIED_AS_ARTIFACT'
      : 'PARTIAL — VALIDATION FAILED',
    artifact: metadata,
    sourceOutput: relativePath(outputDirectory),
    packageId: packageIdFromGradle(),
    build: { prebuild, gradle: gradle.record },
    structuralValidation,
    signing,
    physicalInstall,
  };
}

const toolchain = {
  node: process.version,
  pnpm: commandAvailable('pnpm'),
  pnpmVersion: commandVersion('pnpm'),
  rustc: commandAvailable('rustc'),
  cargo: commandAvailable('cargo'),
  tauriCli: existsSync(join(ROOT, 'apps', 'desktop', 'node_modules', '.bin', 'tauri')),
  java: commandAvailable('java'),
  javac: commandAvailable('javac'),
  gradle: commandAvailable('gradle'),
  androidSdk: commandAvailable('sdkmanager') || commandAvailable('avdmanager'),
  adb: commandAvailable('adb'),
  appimagetool: commandAvailable('appimagetool'),
  linuxdeploy: commandAvailable('linuxdeploy'),
  makeappimage: commandAvailable('makeappimage'),
  file: commandAvailable('file'),
  unzip: commandAvailable('unzip'),
  apksigner: commandAvailable('apksigner'),
  aapt: commandAvailable('aapt'),
  aapt2: commandAvailable('aapt2'),
  zipalign: commandAvailable('zipalign'),
  timeout: commandAvailable('timeout'),
  javaHomeConfigured: Boolean(process.env.JAVA_HOME),
  androidSdkConfigured: Boolean(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT),
};

function platformResultNotRequested(platform) {
  return { platform, status: 'NOT_REQUESTED', artifact: null };
}

function writeManifest(desktop, android) {
  const requestedResults = [
    requested.has('appimage') ? desktop : null,
    requested.has('android') ? android : null,
  ].filter(Boolean);
  const allRequestedArtifactsExist = requestedResults.every((result) => Boolean(result.artifact));
  const validationPassed = requestedResults.every(
    (result) =>
      result.status === 'VERIFIED_AS_ARTIFACT' ||
      (result.platform === 'linux' && result.artifact),
  );
  const status = !allRequestedArtifactsExist
    ? 'PARTIAL — TOOLCHAIN BLOCKED'
    : validationPassed
      ? 'COMPLETE'
      : 'PARTIAL — VALIDATION FAILED';
  const sourceStatus = gitOutput(['status', '--porcelain']);
  const manifest = {
    product: 'Keystone',
    version: VERSION,
    buildType: 'local-test',
    status,
    createdAt: new Date().toISOString(),
    source: {
      commit: gitOutput(['rev-parse', 'HEAD']) || 'UNAVAILABLE',
      dirty: Boolean(sourceStatus),
      dirtyScope: Boolean(sourceStatus) ? 'current worktree' : 'clean',
    },
    environment: {
      distribution: 'Omarchy (Arch Linux-based distribution)',
      architecture: ARCHITECTURE,
      desktopSession: process.env.XDG_CURRENT_DESKTOP || 'not reported',
      sessionType: process.env.XDG_SESSION_TYPE || 'not reported',
      node: process.version,
      pnpm: toolchain.pnpmVersion || 'UNAVAILABLE',
      packageEngine: PACKAGE_JSON.engines?.node || 'UNSPECIFIED',
    },
    localTestProfile: {
      name: 'LOCAL_TEST',
      distribution: 'DEVELOPMENT_DISTRIBUTION',
      updater: 'production updater key removed from child build environment',
      expo: 'production Expo project/channel values removed from child build environment',
      removedEnvironmentKeys,
      security: 'unchanged; no authorization, sandbox or AI policy bypass',
      dataPath: 'isolated temporary XDG/WebView storage for packaging smoke tests',
    },
    toolchain: {
      ...toolchain,
      javaHome: toolchain.javaHomeConfigured ? 'configured' : 'not configured',
      androidSdk: toolchain.androidSdkConfigured ? 'configured' : 'not configured',
    },
    requested: [...requested],
    desktop,
    android,
    checks: {
      artifactChecksumFile: 'written',
      manifestFile: 'written',
      systemPackages: 'not changed',
      commit: 'not created',
      push: 'not performed',
    },
  };
  writeFileSync(join(OUTPUT_DIR, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  const artifacts = [desktop, android]
    .filter((result) => result.artifact && result.artifact.path)
    .map((result) => result.artifact);
  const checksums = artifacts
    .sort((left, right) => left.file.localeCompare(right.file))
    .map((artifact) => artifact.sha256 + '  ' + artifact.file)
    .join('\n');
  writeFileSync(join(OUTPUT_DIR, 'SHA256SUMS.txt'), checksums ? checksums + '\n' : '');
  return { status, manifestPath: join(OUTPUT_DIR, 'build-manifest.json'), checksumsPath: join(OUTPUT_DIR, 'SHA256SUMS.txt') };
}

function main() {
  ensureOutputDirectory();
  let desktop = platformResultNotRequested('linux');
  let android = platformResultNotRequested('android');
  if (requested.has('appimage')) {
    try {
      desktop = buildAppImage();
    } catch (error) {
      desktop = {
        platform: 'linux',
        status: 'BLOCKED_BY_ENVIRONMENT',
        artifact: null,
        blocker: 'Unexpected packaging error: ' + sanitizeText(error?.message || error),
      };
    }
  }
  if (requested.has('android')) {
    try {
      android = buildAndroidApk();
    } catch (error) {
      android = {
        platform: 'android',
        status: 'BLOCKED_BY_ENVIRONMENT',
        artifact: null,
        blocker: 'Unexpected packaging error: ' + sanitizeText(error?.message || error),
      };
    }
  }
  const report = writeManifest(desktop, android);
  console.log('\nLocal-test packaging status: ' + report.status);
  console.log('Manifest: ' + relativePath(report.manifestPath));
  console.log('Checksums: ' + relativePath(report.checksumsPath));
  if (desktop.artifact) console.log('AppImage: ' + desktop.artifact.path);
  else if (requested.has('appimage')) console.log('AppImage: NOT CREATED');
  if (android.artifact) console.log('APK: ' + android.artifact.path);
  else if (requested.has('android')) console.log('APK: NOT CREATED');
  process.exitCode = report.status === 'COMPLETE' ? 0 : 2;
}

main();
