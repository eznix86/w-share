#!/usr/bin/env sh

set -eu

OWNER_REPO="eznix86/w-share"
ASSET_BINARY_NAME="w"
INSTALL_DIR="${W_INSTALL_DIR:-$HOME/.local/bin}"
VERSION="${1:-${W_VERSION:-}}"
INSTALL_COMPLETIONS="${W_INSTALL_COMPLETIONS:-1}"

if [ -t 2 ] && [ -z "${NO_COLOR:-}" ]; then
  USE_TUI=1
  GREEN='\033[32m'
  RED='\033[31m'
  BLUE='\033[34m'
  RESET='\033[0m'
  CLEAR_LINE='\033[2K'
else
  USE_TUI=0
  GREEN=''
  RED=''
  BLUE=''
  RESET=''
  CLEAR_LINE=''
fi

usage() {
  printf 'Usage: %s [tag]\n' "$0" >&2
  printf 'Example: %s v1.0.1-alpha.0\n' "$0" >&2
  printf 'If no tag is provided, the latest release is installed.\n' >&2
  printf 'You can also set W_VERSION, W_INSTALL_DIR, W_BINARY_NAME, and W_INSTALL_COMPLETIONS=0.\n' >&2
}

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'error: required command not found: %s\n' "$1" >&2
    exit 1
  fi
}

step() {
  printf '%b==>%b %s\n' "$BLUE" "$RESET" "$1" >&2
}

success() {
  printf '%b✓%b %s\n' "$GREEN" "$RESET" "$1" >&2
}

fail() {
  printf '%b✗%b %s\n' "$RED" "$RESET" "$1" >&2
}

spinner_frame() {
  case "$1" in
    0) printf '⠋' ;;
    1) printf '⠙' ;;
    2) printf '⠹' ;;
    3) printf '⠸' ;;
    4) printf '⠼' ;;
    5) printf '⠴' ;;
    6) printf '⠦' ;;
    7) printf '⠧' ;;
    8) printf '⠇' ;;
    *) printf '⠏' ;;
  esac
}

run_with_spinner() {
  MESSAGE="$1"
  shift

  if [ "$USE_TUI" -ne 1 ]; then
    step "$MESSAGE"
    "$@"
    return
  fi

  "$@" &
  PID="$!"
  FRAME=0

  while kill -0 "$PID" >/dev/null 2>&1; do
    printf '\r%b%s%b %s' "$BLUE" "$(spinner_frame "$FRAME")" "$RESET" "$MESSAGE" >&2
    FRAME=$(( (FRAME + 1) % 10 ))
    sleep 0.08
  done

  if wait "$PID"; then
    printf '\r%b%b✓%b %s\n' "$CLEAR_LINE" "$GREEN" "$RESET" "$MESSAGE" >&2
    return 0
  fi

  printf '\r%b%b✗%b %s\n' "$CLEAR_LINE" "$RED" "$RESET" "$MESSAGE" >&2
  return 1
}

download() {
  MESSAGE="$1"
  URL="$2"
  OUTPUT="$3"

  if [ "$USE_TUI" -ne 1 ]; then
    step "$MESSAGE"
    curl -fL "$URL" -o "$OUTPUT"
    return
  fi

  printf '%b↓%b %s\n' "$BLUE" "$RESET" "$MESSAGE" >&2
  if curl -fL --progress-bar "$URL" -o "$OUTPUT"; then
    success "$MESSAGE"
    return 0
  fi

  fail "$MESSAGE"
  return 1
}

is_w_share_binary() {
  [ -f "$1" ] || [ -L "$1" ] || return 1
  [ -x "$1" ] || return 1

  HELP_OUTPUT="$("$1" --help 2>/dev/null || true)"

  printf '%s' "$HELP_OUTPUT" | grep -Fq 'Lightweight HTTP tunnel for local sites' \
    || printf '%s' "$HELP_OUTPUT" | grep -Fq 'Show the installed w version' \
    || printf '%s' "$HELP_OUTPUT" | grep -Fq 'Usage: w '
}

remove_legacy_binary() {
  if [ "$BINARY_NAME" = "w" ]; then
    return
  fi

  LEGACY_BINARY_PATH="$INSTALL_DIR/w"

  if is_w_share_binary "$LEGACY_BINARY_PATH"; then
    run_with_spinner "Removing legacy command at $LEGACY_BINARY_PATH" rm -f "$LEGACY_BINARY_PATH"
  fi
}

append_once() {
  FILE="$1"
  MARKER="$2"
  CONTENT="$3"

  touch "$FILE"

  if grep -Fq "$MARKER" "$FILE"; then
    return
  fi

  printf '\n%s\n' "$CONTENT" >> "$FILE"
}

current_shell_is() {
  case "${SHELL:-}" in
    */"$1"|"$1")
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

install_bash_completion() {
  BASH_COMPLETION_DIR="$HOME/.local/share/bash-completion/completions"
  run_with_spinner "Installing bash completion" mkdir -p "$BASH_COMPLETION_DIR"
  "$INSTALL_DIR/$BINARY_NAME" completion bash > "$BASH_COMPLETION_DIR/$BINARY_NAME"
}

install_zsh_completion() {
  ZSH_COMPLETION_DIR="$HOME/.zsh/completions"
  ZSHRC="$HOME/.zshrc"
  ZSH_MARKER="# w-share completions"
  ZSH_BLOCK="# w-share completions
fpath=(\$HOME/.zsh/completions \$fpath)
autoload -Uz compinit
compinit
# end w-share completions"

  run_with_spinner "Installing zsh completion" mkdir -p "$ZSH_COMPLETION_DIR"
  "$INSTALL_DIR/$BINARY_NAME" completion zsh > "$ZSH_COMPLETION_DIR/_$BINARY_NAME"
  append_once "$ZSHRC" "$ZSH_MARKER" "$ZSH_BLOCK"
}

install_fish_completion() {
  FISH_COMPLETION_DIR="$HOME/.config/fish/completions"
  run_with_spinner "Installing fish completion" mkdir -p "$FISH_COMPLETION_DIR"
  "$INSTALL_DIR/$BINARY_NAME" completion fish > "$FISH_COMPLETION_DIR/$BINARY_NAME.fish"
}

install_completions() {
  if [ "$INSTALL_COMPLETIONS" = "0" ] || [ "$BINARY_NAME" != "w-share" ]; then
    return
  fi

  if ! "$INSTALL_DIR/$BINARY_NAME" completion zsh >/dev/null 2>&1; then
    return
  fi

  if current_shell_is bash; then
    install_bash_completion || true
  fi

  if current_shell_is zsh; then
    install_zsh_completion || true
  fi

  if current_shell_is fish; then
    install_fish_completion || true
  fi
}

installed_version() {
  if [ ! -x "$INSTALL_DIR/$BINARY_NAME" ]; then
    return
  fi

  "$INSTALL_DIR/$BINARY_NAME" version --text 2>/dev/null || true
}

install_binary() {
  DESTINATION="$INSTALL_DIR/$BINARY_NAME"
  TEMP_DESTINATION="$INSTALL_DIR/.$BINARY_NAME.tmp.$$"

  cp "$ASSET_PATH" "$TEMP_DESTINATION"
  chmod 755 "$TEMP_DESTINATION"
  mv -f "$TEMP_DESTINATION" "$DESTINATION"
}

need_cmd curl
need_cmd awk
need_cmd grep

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin)
    PLATFORM="darwin"
    ;;
  Linux)
    PLATFORM="linux"
    ;;
  *)
    printf 'error: unsupported operating system: %s\n' "$OS" >&2
    exit 1
    ;;
esac

case "$ARCH" in
  x86_64|amd64)
    TARGET_ARCH="x64"
    ;;
  arm64|aarch64)
    TARGET_ARCH="arm64"
    ;;
  *)
    printf 'error: unsupported architecture: %s\n' "$ARCH" >&2
    exit 1
    ;;
esac

BINARY_NAME="${W_BINARY_NAME:-w-share}"

ASSET="$ASSET_BINARY_NAME-$PLATFORM-$TARGET_ARCH"
CHECKSUMS_ASSET="checksums-sha256.txt"
if [ -n "$VERSION" ]; then
  DOWNLOAD_BASE="https://github.com/$OWNER_REPO/releases/download/$VERSION"
else
  DOWNLOAD_BASE="https://github.com/$OWNER_REPO/releases/latest/download"
fi
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
  rm -f "$INSTALL_DIR/.$BINARY_NAME.tmp.$$"
}

trap cleanup EXIT INT TERM

run_with_spinner "Preparing install directory" mkdir -p "$INSTALL_DIR"
remove_legacy_binary

ASSET_PATH="$TMP_DIR/$ASSET"
CHECKSUMS_PATH="$TMP_DIR/$CHECKSUMS_ASSET"

download "Downloading $ASSET from $OWNER_REPO" "$DOWNLOAD_BASE/$ASSET" "$ASSET_PATH"

download "Downloading $CHECKSUMS_ASSET" "$DOWNLOAD_BASE/$CHECKSUMS_ASSET" "$CHECKSUMS_PATH"

EXPECTED_SHA="$(awk -v asset="$ASSET" '$2 == asset { print $1 }' "$CHECKSUMS_PATH")"

if [ -z "$EXPECTED_SHA" ]; then
  printf 'error: could not find checksum for %s in %s\n' "$ASSET" "$CHECKSUMS_ASSET" >&2
  exit 1
fi

if command -v shasum >/dev/null 2>&1; then
  step "Verifying checksum"
  ACTUAL_SHA="$(shasum -a 256 "$ASSET_PATH" | awk '{ print $1 }')"
elif command -v sha256sum >/dev/null 2>&1; then
  step "Verifying checksum"
  ACTUAL_SHA="$(sha256sum "$ASSET_PATH" | awk '{ print $1 }')"
else
  printf 'error: no SHA-256 tool found (expected shasum or sha256sum)\n' >&2
  exit 1
fi

if [ "$EXPECTED_SHA" != "$ACTUAL_SHA" ]; then
  printf 'error: checksum mismatch for %s\n' "$ASSET" >&2
  exit 1
fi

success "Checksum verified"

run_with_spinner "Installing $BINARY_NAME to $INSTALL_DIR" install_binary
install_completions

INSTALLED_VERSION="$(installed_version)"

if [ -n "$INSTALLED_VERSION" ]; then
  printf '\n%bInstalled%b %s %s to %s\n' "$GREEN" "$RESET" "$BINARY_NAME" "$INSTALLED_VERSION" "$INSTALL_DIR/$BINARY_NAME"
else
  printf '\n%bInstalled%b %s to %s\n' "$GREEN" "$RESET" "$BINARY_NAME" "$INSTALL_DIR/$BINARY_NAME"
fi

case ":$PATH:" in
  *":$INSTALL_DIR:"*)
    ;;
  *)
    printf 'warning: %s is not in PATH\n' "$INSTALL_DIR" >&2
    printf 'Add this to your shell profile: export PATH="%s:$PATH"\n' "$INSTALL_DIR" >&2
    ;;
esac
