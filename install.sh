#!/usr/bin/env sh

set -eu

OWNER_REPO="eznix86/w-share"
BINARY_NAME="w"
INSTALL_DIR="${W_INSTALL_DIR:-$HOME/.local/bin}"
VERSION="${1:-${W_VERSION:-}}"

usage() {
  printf 'Usage: %s [tag]\n' "$0" >&2
  printf 'Example: %s v1.0.1-alpha.0\n' "$0" >&2
  printf 'If no tag is provided, the latest release is installed.\n' >&2
  printf 'You can also set W_VERSION and optionally W_INSTALL_DIR.\n' >&2
}

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'error: required command not found: %s\n' "$1" >&2
    exit 1
  fi
}

step() {
  printf '==> %s\n' "$1" >&2
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

ASSET="$BINARY_NAME-$PLATFORM-$TARGET_ARCH"
CHECKSUMS_ASSET="checksums-sha256.txt"
if [ -n "$VERSION" ]; then
  DOWNLOAD_BASE="https://github.com/$OWNER_REPO/releases/download/$VERSION"
else
  DOWNLOAD_BASE="https://github.com/$OWNER_REPO/releases/latest/download"
fi
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT INT TERM

mkdir -p "$INSTALL_DIR"

ASSET_PATH="$TMP_DIR/$ASSET"
CHECKSUMS_PATH="$TMP_DIR/$CHECKSUMS_ASSET"

step "Downloading $ASSET from $OWNER_REPO"
curl -fL "$DOWNLOAD_BASE/$ASSET" -o "$ASSET_PATH"

step "Downloading $CHECKSUMS_ASSET"
curl -fL "$DOWNLOAD_BASE/$CHECKSUMS_ASSET" -o "$CHECKSUMS_PATH"

EXPECTED_SHA="$(grep "  $ASSET$" "$CHECKSUMS_PATH" | awk '{ print $1 }')"

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

chmod 755 "$ASSET_PATH"
step "Installing $BINARY_NAME to $INSTALL_DIR"
cp "$ASSET_PATH" "$INSTALL_DIR/$BINARY_NAME"
chmod 755 "$INSTALL_DIR/$BINARY_NAME"

printf 'Installed %s to %s\n' "$BINARY_NAME" "$INSTALL_DIR/$BINARY_NAME"

case ":$PATH:" in
  *":$INSTALL_DIR:"*)
    ;;
  *)
    printf 'warning: %s is not in PATH\n' "$INSTALL_DIR" >&2
    printf 'Add this to your shell profile: export PATH="%s:$PATH"\n' "$INSTALL_DIR" >&2
    ;;
esac
