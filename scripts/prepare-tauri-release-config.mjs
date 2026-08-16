import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const UPDATER_KEY_ENV = 'KEYSTONE_TAURI_UPDATER_PUBLIC_KEY';

export function releaseTauriConfig(publicKey) {
  if (!publicKey || /REPLACE_WITH|YOUR_|example/i.test(publicKey)) {
    throw new Error(`Production updater is not configured. Development builds are unaffected. Release build requires ${UPDATER_KEY_ENV}.`);
  }
  return {
    bundle: { createUpdaterArtifacts: true },
    plugins: {
      updater: {
        pubkey: publicKey,
        endpoints: ['https://github.com/pluseight8/keystone/releases/latest/download/updater.json'],
        windows: { installMode: 'passive' },
      },
    },
  };
}

export async function writeReleaseTauriConfig({ publicKey = process.env[UPDATER_KEY_ENV], output } = {}) {
  const destination = resolve(output || fileURLToPath(new URL('../apps/desktop/src-tauri/tauri.release.conf.json', import.meta.url)));
  const config = releaseTauriConfig(publicKey);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return destination;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(`Generated ${await writeReleaseTauriConfig()}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
