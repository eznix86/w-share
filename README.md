# w

A self-hosted alternative to ngrok to tunnel local HTTP to the web.

## Install

The release installer downloads the matching macOS or Linux binary for your machine, verifies it with `checksums-sha256.txt`, and installs it to `~/.local/bin/w` by default.

```bash
curl -fsSL https://raw.githubusercontent.com/eznix86/w-share/main/install.sh | sh
```

Pin a specific release by passing the tag explicitly.

```bash
curl -fsSL https://raw.githubusercontent.com/eznix86/w-share/main/install.sh | sh -s -- v1.0.1-alpha.0
```

Override the install directory with `W_INSTALL_DIR` if you want a different target path.

```bash
curl -fsSL https://raw.githubusercontent.com/eznix86/w-share/main/install.sh | W_INSTALL_DIR=/usr/local/bin sh -s -- v1.0.1-alpha.0
```

If `~/.local/bin` is not already in your `PATH`, add it in your shell profile:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

## Run the server

```bash
W_SHARE_TOKEN=dev-token w serve --domain share.domain.tld --port 8080
```

## Expose a local target

```bash
w http :8000
w http https://awesome-local-website.localhost
```

The client prompts for the server URL and shared token on first run and stores them in `~/.config/w-share/config.json`.

To update the saved client configuration later:

```bash
w config
```
