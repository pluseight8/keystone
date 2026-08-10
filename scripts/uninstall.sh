#!/usr/bin/env bash
set -Eeuo pipefail

COMMAND_NAME="${KEYSTONE_COMMAND_NAME:-keystone}"
APP_NAME="${KEYSTONE_APP_NAME:-Keystone}"
INSTALL_DIR="${KEYSTONE_INSTALL_DIR:-${HOME}/.local/bin}"
DESKTOP_FILE="${XDG_DATA_HOME:-$HOME/.local/share}/applications/org.keystone.app.desktop"

if [[ "$(uname -s)" != Linux && "$(uname -s)" != Darwin ]]; then
  printf 'Поддерживаются только Linux и macOS.\n' >&2; exit 1
fi
printf 'Будут удалены Keystone, ярлык и локальные данные (кэш и настройки). Продолжить? [y/N] '
read -r answer
[[ "$answer" =~ ^[YyДд]([EeАаSsАа]|[Yy])?$ ]] || { echo 'Отменено.'; exit 0; }

rm -f "$INSTALL_DIR/$COMMAND_NAME" "$DESKTOP_FILE"
if [[ "$(uname -s)" == Darwin ]]; then rm -rf "/Applications/$APP_NAME.app" "$HOME/Library/Application Support/$APP_NAME" "$HOME/Library/Caches/$APP_NAME"; else rm -rf "$HOME/.config/keystone" "$HOME/.cache/keystone"; fi
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "${XDG_DATA_HOME:-$HOME/.local/share}/applications" >/dev/null 2>&1 || true
echo 'Keystone удалён. Идентификационные ключи, если они хранились в системном keychain, удалите отдельно.'
