import { isCancel, outro, password, spinner, text } from "@clack/prompts";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WS_PATH } from "./constants.ts";
import { decodeMessage, encodeMessage } from "./protocol.ts";
import { httpUrlPattern, websocketUrlPattern } from "./regexp.ts";
import { renderBrandIntro } from "./brand.ts";
import { clientConfigSchema } from "./types.ts";
import { renderUpdateNotice } from "./update-notice.ts";
import { VERSION } from "./version.ts";

type ClientConfig = {
  token?: string;
  server?: string;
};

const CONFIG_DIR = path.join(os.homedir(), ".config", "w-share");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

export async function loadOrPromptClientToken(): Promise<string> {
  const config = await readClientConfig();

  if (config.token) {
    return config.token;
  }

  return (await promptAndSaveClientConfig(config)).token;
}

export async function loadOrPromptClientServer(explicitServer?: string): Promise<string> {
  const config = await readClientConfig();

  if (explicitServer?.trim()) {
    const server = explicitServer.trim();
    await writeClientConfig({ ...config, server });
    return server;
  }

  if (config.server) {
    return config.server;
  }

  return (await promptAndSaveClientConfig(config)).server;
}

export async function promptAndSaveClientConfig(currentConfig?: ClientConfig): Promise<Required<ClientConfig>> {
  const config = currentConfig ?? await readClientConfig();

  renderBrandIntro(VERSION);
  await renderUpdateNotice(VERSION);

  const serverValue = await text({
    message: "Your w-share server URL",
    placeholder: "https://share.domain.tld",
    defaultValue: config.server,
    validate(input) {
      if (typeof input !== "string" || input.trim().length === 0) {
        return "Server URL is required";
      }

      try {
        const url = new URL(input.trim());
        return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "ws:" || url.protocol === "wss:"
          ? undefined
          : "Use an http(s) or ws(s) URL";
      } catch {
        return "Enter a valid server URL";
      }
    },
  });

  if (isCancel(serverValue)) {
    outro("Cancelled");
    process.exit(1);
  }

  const server = serverValue.trim();
  await validateServer(server);

  const tokenValue = await password({
    message: "Your Auth token",
    validate(input) {
      return typeof input === "string" && input.trim().length > 0 ? undefined : "Token is required";
    },
  });

  if (isCancel(tokenValue)) {
    outro("Cancelled");
    process.exit(1);
  }

  const token = tokenValue.trim();
  await validateToken(server, token);

  const nextConfig = {
    server,
    token,
  };

  await writeClientConfig(nextConfig);
  outro(`Saved config to ${CONFIG_PATH}`);
  return nextConfig;
}

async function readClientConfig(): Promise<ClientConfig> {
  try {
    const file = Bun.file(CONFIG_PATH);

    if (!(await file.exists())) {
      return {};
    }

    return clientConfigSchema.parse(JSON.parse(await file.text()));
  } catch {
    return {};
  }
}

async function writeClientConfig(config: ClientConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await chmod(CONFIG_DIR, 0o700);
  await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(CONFIG_PATH, 0o600);
}

async function validateServer(server: string): Promise<void> {
  const spin = spinner();
  spin.start("Checking server reachability");

  try {
    const response = await fetch(server, { redirect: "manual" });

    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status}`);
    }

    spin.stop("Server is reachable");
  } catch (error) {
    spin.error("Server is not reachable");
    throw new Error(error instanceof Error ? error.message : "Unable to reach server");
  }
}

async function validateToken(server: string, token: string): Promise<void> {
  const wsUrl = buildWebSocketUrl(server);
  const spin = spinner();
  spin.start("Checking token authentication");

  const socket = new WebSocket(wsUrl);

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Authentication timed out"));
      }, 10_000);

      const cleanup = () => {
        clearTimeout(timeout);
        socket.removeEventListener("open", handleOpen);
        socket.removeEventListener("message", handleMessage);
        socket.removeEventListener("close", handleClose);
        socket.removeEventListener("error", handleError);
      };

      const handleOpen = () => {
        socket.send(encodeMessage({ type: "auth-check", token }));
      };

      const handleMessage = (event: MessageEvent) => {
        const message = decodeMessage(String(event.data));

        if (!message) {
          cleanup();
          reject(new Error("Server returned an invalid response"));
          socket.close();
          return;
        }

        if (message.type === "auth-ok") {
          cleanup();
          resolve();
          socket.close();
          return;
        }

        if (message.type === "error") {
          cleanup();
          reject(new Error(message.message));
          socket.close();
        }
      };

      const handleClose = () => {
        cleanup();
        reject(new Error("Connection closed before authentication completed"));
      };

      const handleError = () => {
        cleanup();
        reject(new Error("WebSocket error during authentication"));
      };

      socket.addEventListener("open", handleOpen);
      socket.addEventListener("message", handleMessage);
      socket.addEventListener("close", handleClose);
      socket.addEventListener("error", handleError);
    });

    spin.stop("Token is valid");
  } catch (error) {
    spin.error("Token authentication failed");
    throw new Error(error instanceof Error ? error.message : "Authentication failed");
  }
}

function buildWebSocketUrl(server: string): URL {
  const input = server.trim();

  if (websocketUrlPattern.test(input)) {
    const url = new URL(input);
    url.pathname = WS_PATH;
    return url;
  }

  if (httpUrlPattern.test(input)) {
    const url = new URL(input);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = WS_PATH;
    return url;
  }

  const url = new URL(`wss://${input}`);
  url.pathname = WS_PATH;
  return url;
}
