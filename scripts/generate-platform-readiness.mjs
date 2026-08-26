import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fields = ['architecture', 'typecheck', 'unitTests', 'integrationTests', 'compile', 'package', 'install', 'launch', 'network', 'webrtc', 'secureStorage', 'permissions', 'updater', 'signing', 'physicalDevice', 'releaseReady'];
const english = ['Architecture', 'Typecheck', 'Unit tests', 'Integration tests', 'Compile', 'Package', 'Install', 'Launch', 'Network/P2P', 'WebRTC', 'Secure storage', 'Permissions', 'Updater', 'Signing', 'Physical device', 'Release ready'];
const russian = ['Архитектура', 'Проверка типов', 'Модульные тесты', 'Интеграционные тесты', 'Компиляция', 'Пакет', 'Установка', 'Запуск', 'Сеть/P2P', 'WebRTC', 'Защищённое хранилище', 'Разрешения', 'Обновления', 'Подпись', 'Физическое устройство', 'Готовность релиза'];
const ruStatus = { 'NOT TESTED': 'НЕ ТЕСТИРОВАЛОСЬ', 'NOT IMPLEMENTED': 'НЕ РЕАЛИЗОВАНО', 'BLOCKED': 'БЛОКЕР', 'PARTIAL': 'ЧАСТИЧНО', 'PASS': 'ПРОЙДЕНО' };
const translate = (value) => Object.entries(ruStatus).reduce((text, [from, to]) => text.replace(from, to), value);

function table(platforms, headers, transform = (value) => value) {
  return `| Platform | ${headers.join(' | ')} |\n| --- | ${headers.map(() => '---').join(' | ')} |\n${platforms.map((item) => `| ${item.name} | ${fields.map((field) => transform(item[field])).join(' | ')} |`).join('\n')}\n`;
}

const data = JSON.parse(await readFile(resolve(root, 'docs/platform-readiness.json'), 'utf8'));
const intro = '# Platform readiness evidence\n\nThis generated matrix is derived from [`docs/platform-readiness.json`](platform-readiness.json). `PASS` is evidence from the current repository checks; `PARTIAL`, `BLOCKED`, `NOT TESTED`, and `NOT IMPLEMENTED` are deliberately not release claims. The Linux (Flatpak) row describes a packaging target, not the current development distribution.\n\n';
const en = `${intro}${table(data.platforms, english)}\n## Release credential model\n\nDevelopment builds keep the Tauri updater and Expo OTA disabled unless configured. A production release requires KEYSTONE_TAURI_UPDATER_PUBLIC_KEY; signed desktop release also requires TAURI_SIGNING_PRIVATE_KEY, while Android signing requires an owner-provided keystore. See [Release and evidence](release.md).\n\n## Security boundary\n\nDesktop IPC has no arbitrary JavaScript execution, shell passthrough, or generic OS input. The typed automation contract is documented in [OS_AUTOMATION.md](../apps/desktop/src-tauri/OS_AUTOMATION.md).\n`;
const ru = `# Доказательства готовности платформ\n\nДокумент генерируется из [docs/platform-readiness.json](../platform-readiness.json). Статус «ПРОЙДЕНО» имеет подтверждение в текущих проверках; остальные статусы намеренно не являются заявлением готовности к релизу. Строка Linux (Flatpak) описывает packaging target, а не текущую development distribution.\n\n${table(data.platforms, russian, translate)}\n## Модель release credentials\n\nВ development Tauri updater и Expo OTA отключены, пока не настроены. Для production нужны KEYSTONE_TAURI_UPDATER_PUBLIC_KEY, для desktop signing — TAURI_SIGNING_PRIVATE_KEY, для Android — keystore владельца. См. [Релиз и доказательства](../release.md).\n\n## Security boundary\n\nВ desktop IPC нет arbitrary JavaScript, shell passthrough и generic OS input. Typed contract автоматизации описан в [OS_AUTOMATION.md](../../apps/desktop/src-tauri/OS_AUTOMATION.md).\n`;
await writeFile(resolve(root, 'docs/PLATFORM_READINESS.md'), en);
await writeFile(resolve(root, 'docs/ru/platform-readiness.md'), ru);
