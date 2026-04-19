# w

A self-hosted alternative to ngrok to tunnel local HTTP to the web.

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
