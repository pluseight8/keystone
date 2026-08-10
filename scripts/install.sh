#!/usr/bin/env bash
set -Eeuo pipefail

# Keystone installer. Override these for forks or private mirrors:
#   KEYSTONE_REPOSITORY=owner/repository KEYSTONE_VERSION=v1.2.3 ./scripts/install.sh

REPOSITORY="${KEYSTONE_REPOSITORY:-}"
VERSION="${KEYSTONE_VERSION:-latest}"
APP_NAME="${KEYSTONE_APP_NAME:-Keystone}"
COMMAND_NAME="${KEYSTONE_COMMAND_NAME:-keystone}"
INSTALL_DIR="${KEYSTONE_INSTALL_DIR:-${HOME}/.local/bin}"
API="https://api.github.com"

die() { printf 'Ошибка: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "Не найдено '$1'. Установите его и повторите."; }
cleanup() { [[ -n "${TMP_DIR:-}" && -d "$TMP_DIR" ]] && rm -rf "$TMP_DIR"; }
trap cleanup EXIT

[[ "$(uname -s)" == "Linux" || "$(uname -s)" == "Darwin" ]] || die "Поддерживаются только Linux и macOS."
need curl; need python3

if [[ -z "$REPOSITORY" ]]; then
  remote="$(git config --get remote.origin.url 2>/dev/null || true)"
  REPOSITORY="$(python3 - "$remote" <<'PY'
import re, sys
value = sys.argv[1]
m = re.search(r'github\.com[/:]([^/ :]+/[^/ :]+?)(?:\.git)?$', value)
print(m.group(1) if m else "pluseight8/keystone")
PY
)"
fi

TMP_DIR="$(mktemp -d)"
if [[ "$VERSION" == latest ]]; then
  release_url="$API/repos/$REPOSITORY/releases/latest"
else
  release_url="$API/repos/$REPOSITORY/releases/tags/$VERSION"
fi
printf 'Получаю последний релиз %s…\n' "$REPOSITORY"
curl --fail --location --retry 3 --silent --show-error \
  -H 'Accept: application/vnd.github+json' -H 'User-Agent: Keystone-installer' \
  "$release_url" > "$TMP_DIR/release.json" || die "Не удалось получить релиз GitHub."

release_data="$(python3 - "$TMP_DIR/release.json" <<'PY'
import json, sys
d=json.load(open(sys.argv[1]))
assets=d.get("assets", [])
system = "linux" if sys.platform.startswith("linux") else "darwin"
arch = {"x86_64":"x86_64", "amd64":"x86_64", "aarch64":"aarch64", "arm64":"aarch64"}.get(__import__("platform").machine().lower(), __import__("platform").machine().lower())
names = [a.get("name", "") for a in assets]
preferred = [a for a in assets if not a.get("name", "").endswith(".sig") and (a.get("name", "").endswith(".AppImage") if system == "linux" else a.get("name", "").endswith(".dmg")) and arch in a.get("name", "").lower()]
preferred += [a for a in assets if not a.get("name", "").endswith(".sig") and (a.get("name", "").endswith(".AppImage") if system == "linux" else a.get("name", "").endswith(".dmg"))]
if not preferred:
    preferred = [a for a in assets if not a.get("name", "").endswith(".sig") and "keystone" in a.get("name", "").lower()]
if not preferred: raise SystemExit("В релизе нет AppImage/DMG/бинарника Keystone")
a = preferred[0]
print(a["name"]); print(a["browser_download_url"])
print(d.get("tag_name", ""))
PY
)" || die "В релизе нет подходящего артефакта (нужен AppImage, DMG или бинарник)."
mapfile -t release_lines <<< "$release_data"
ASSET_NAME="${release_lines[0]}"; ASSET_URL="${release_lines[1]}"; RELEASE_TAG="${release_lines[2]}"

download() { curl --fail --location --retry 3 --silent --show-error -H 'User-Agent: Keystone-installer' "$1" -o "$2"; }
verify_checksum() {
  local file="$1" asset_name="${2:-$(basename "$file")}" sums="$TMP_DIR/SHA256SUMS"
  download "https://github.com/$REPOSITORY/releases/download/$RELEASE_TAG/SHA256SUMS" "$sums" || die "В релизе отсутствует SHA256SUMS"
  local expected actual
  expected="$(awk -v name="$asset_name" '$2 == name { print $1; exit }' "$sums")"
  [[ "$expected" =~ ^[0-9a-fA-F]{64}$ ]] || die "Для $asset_name нет SHA-256 в релизе"
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$file" | awk '{print $1}')"
  else
    actual="$(shasum -a 256 "$file" | awk '{print $1}')"
  fi
  [[ "$actual" == "$expected" ]] || die "Проверка SHA-256 не пройдена для $asset_name"
}

if [[ "$(uname -s)" == Linux ]]; then
  mkdir -p "$INSTALL_DIR"
  target="$INSTALL_DIR/$COMMAND_NAME"
  if [[ "$ASSET_NAME" == *.tar.gz ]]; then
    archive="$TMP_DIR/Keystone.tar.gz"; download "$ASSET_URL" "$archive"; verify_checksum "$archive" "$ASSET_NAME"
    mkdir -p "$TMP_DIR/extracted"
    tar -xzf "$archive" -C "$TMP_DIR/extracted"
    binary="$(find "$TMP_DIR/extracted" -type f -perm -u+x | head -n 1)"
    [[ -n "$binary" ]] || die "В архиве нет исполняемого файла"
    cp "$binary" "$target"
  else
    download "$ASSET_URL" "$target"; verify_checksum "$target" "$ASSET_NAME"
  fi
  chmod 0755 "$target"
  mkdir -p "${XDG_DATA_HOME:-$HOME/.local/share}/applications"
  cat > "${XDG_DATA_HOME:-$HOME/.local/share}/applications/org.keystone.app.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Keystone
Comment=Privacy-first peer-to-peer AI workspace
Exec=$target %U
Terminal=false
Categories=Utility;Network;
StartupWMClass=Keystone
MimeType=x-scheme-handler/keystone;
EOF
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "${XDG_DATA_HOME:-$HOME/.local/share}/applications" >/dev/null 2>&1 || true
  printf 'Keystone %s установлен в %s\n' "$RELEASE_TAG" "$target"
else
  if [[ "$ASSET_NAME" != *.dmg ]]; then
    mkdir -p "$INSTALL_DIR"
    target="$INSTALL_DIR/$COMMAND_NAME"
    download "$ASSET_URL" "$target"; verify_checksum "$target" "$ASSET_NAME"; chmod 0755 "$target"
    printf 'Keystone %s установлен в %s\n' "$RELEASE_TAG" "$target"
  else
    need hdiutil; need ditto
    dmg="$TMP_DIR/Keystone.dmg"; mount="$TMP_DIR/mount"
    download "$ASSET_URL" "$dmg"; verify_checksum "$dmg" "$ASSET_NAME"; mkdir -p "$mount"
    device="$(hdiutil attach "$dmg" -nobrowse -readonly -mountpoint "$mount" | awk 'END{print $1}')"
    trap 'hdiutil detach "$device" >/dev/null 2>&1 || true; cleanup' EXIT
    [[ -d "$mount/$APP_NAME.app" ]] || die "В DMG нет $APP_NAME.app"
    ditto "$mount/$APP_NAME.app" "/Applications/$APP_NAME.app"
    hdiutil detach "$device" >/dev/null 2>&1 || true
    printf 'Keystone %s установлен в /Applications/%s.app\n' "$RELEASE_TAG" "$APP_NAME"
  fi
fi
