import chalk from "chalk";
import { log, outro, spinner, taskLog } from "@clack/prompts";
import { renderUnicodeCompact } from "uqr";
import { CLIENT_RECONNECT_DELAY_MS, MAX_HTTP_BODY_BYTES, PING_INTERVAL_MS, WS_PATH } from "../shared/constants.ts";
import { decodeMessage, encodeMessage } from "../shared/protocol.ts";
import { httpUrlPattern, websocketUrlPattern } from "../shared/regexp.ts";
import type { RegisteredMessage, RequestMessage } from "../shared/types.ts";
import { base64ToUint8Array, bodyToBase64, normalizeTarget, sanitizeResponseHeaders, validateRequestedSubdomain } from "../shared/utils.ts";

type StartClientOptions = {
  basicAuth?: {
    username: string;
    password: string;
  };
  subdomain?: string;
  qr: boolean;
  server: string;
  token: string;
  target: string;
};

type RequestLog = ReturnType<typeof taskLog>;

export async function startClient(options: StartClientOptions): Promise<void> {
  if (options.subdomain) {
    const validationError = validateRequestedSubdomain(options.subdomain);

    if (validationError) {
      throw new Error(validationError);
    }
  }

  const targetUrl = normalizeTarget(options.target);
  const wsUrl = buildWebSocketUrl(options.server);
  let activeRequestLog: RequestLog | undefined;
  const spin = spinner({
    onCancel: () => {
      activeRequestLog?.success("Tunnel stopped", { showLog: true });
      console.log("");
      outro("Disconnected");
    },
    cancelMessage: "Tunnel stopped",
  });

  spin.start(`Connecting to ${wsUrl.host}`);
  await connectLoop(wsUrl, options.token, targetUrl, options.basicAuth, options.subdomain, options.qr, spin, (requestLog) => {
    activeRequestLog = requestLog;
  });
}

async function connectLoop(
  wsUrl: URL,
  token: string,
  targetUrl: URL,
  basicAuth: StartClientOptions["basicAuth"],
  subdomain: StartClientOptions["subdomain"],
  showQr: boolean,
  spin: ReturnType<typeof spinner>,
  onRequestLog: (requestLog: RequestLog | undefined) => void,
): Promise<void> {
  let requestLog: RequestLog | undefined;

  while (true) {
    try {
      requestLog = await runSession(wsUrl, token, targetUrl, basicAuth, subdomain, showQr, spin, requestLog);
      onRequestLog(requestLog);
      return;
    } catch (error) {
      onRequestLog(requestLog);
      const message = error instanceof Error ? error.message : String(error);
      spin.error(message);
      await Bun.sleep(CLIENT_RECONNECT_DELAY_MS);
      spin.start(`Reconnecting to ${wsUrl.host}`);
    }
  }
}

async function runSession(
  wsUrl: URL,
  token: string,
  targetUrl: URL,
  basicAuth: StartClientOptions["basicAuth"],
  subdomain: StartClientOptions["subdomain"],
  showQr: boolean,
  spin: ReturnType<typeof spinner>,
  requestLog: RequestLog | undefined,
): Promise<RequestLog | undefined> {
  const socket = new WebSocket(wsUrl);

  await new Promise<void>((resolve, reject) => {
    let heartbeat: Timer | undefined;

    socket.addEventListener("open", () => {
      socket.send(encodeMessage({ type: "register", token, basicAuth, subdomain }));
      heartbeat = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(encodeMessage({ type: "ping" }));
        }
      }, PING_INTERVAL_MS);
    });

    socket.addEventListener("message", async (event) => {
      const message = decodeMessage(String(event.data));

      if (!message) {
        return;
      }

      if (message.type === "registered") {
        requestLog = handleRegistered(message, targetUrl, spin, showQr);
        return;
      }

      if (message.type === "request") {
        if (!requestLog) {
          requestLog = createRequestLog();
        }

        const startedAt = Date.now();
        const response = await forwardRequest(targetUrl, message);
        logForwardedRequest(requestLog, message, response, Date.now() - startedAt);
        socket.send(encodeMessage(response));
        return;
      }

      if (message.type === "error") {
        clearInterval(heartbeat);
        reject(new Error(message.message));
        socket.close();
      }
    });

    socket.addEventListener("close", () => {
      clearInterval(heartbeat);
      reject(new Error("Connection closed"));
    });

    socket.addEventListener("error", () => {
      clearInterval(heartbeat);
      reject(new Error("WebSocket error"));
    });
  });

  return requestLog;
}

function handleRegistered(
  message: RegisteredMessage,
  targetUrl: URL,
  spin: ReturnType<typeof spinner>,
  showQr: boolean,
): RequestLog {
  spin.clear();
  log.success(`Assigned URL ${chalk.cyan(message.url)}`);

  if (showQr) {
    log.message(renderQrCode(message.url));
  }

  log.info(chalk.dim(`Forwarding to ${targetUrl.toString()}`));
  return createRequestLog();
}

function renderQrCode(url: string): string {
  return renderUnicodeCompact(url, {
    border: 1,
  });
}

function createRequestLog(): RequestLog {
  return taskLog({
    title: "Requests",
    retainLog: true,
  });
}

function logForwardedRequest(
  requestLog: RequestLog,
  request: RequestMessage,
  response: { status: number; bodyBase64?: string },
  durationMs: number,
): void {
  const timestamp = chalk.dim(formatTimestamp(new Date()));
  const method = chalk.cyan(request.method.padEnd(6, " "));
  const path = truncatePath(request.path, 48).padEnd(48, " ");
  const status = colorStatus(response.status);
  const duration = chalk.gray(`${String(durationMs).padStart(4, " ")}ms`);
  const size = formatResponseSize(response);

  requestLog.message(`${timestamp} ${method} ${path} ${status} ${duration} ${size}`);
}

function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString("en-GB", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function colorStatus(status: number): string {
  const printable = String(status).padStart(3, " ");

  if (status >= 500) {
    return chalk.red(printable);
  }

  if (status >= 400) {
    return chalk.redBright(printable);
  }

  if (status >= 300) {
    return chalk.yellow(printable);
  }

  return chalk.green(printable);
}

function formatResponseSize(response: { status: number; bodyBase64?: string }): string {
  if (response.status >= 500 && !response.bodyBase64) {
    return chalk.red("error");
  }

  const bytes = response.bodyBase64 ? Buffer.from(response.bodyBase64, "base64").byteLength : 0;

  if (response.status >= 500) {
    return chalk.red(formatBytes(bytes));
  }

  return chalk.gray(formatBytes(bytes));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}b`;
  }

  const kib = bytes / 1024;
  if (kib < 1024) {
    return `${kib.toFixed(1)}kb`;
  }

  const mib = kib / 1024;
  return `${mib.toFixed(1)}mb`;
}

function truncatePath(path: string, maxLength: number): string {
  if (path.length <= maxLength) {
    return path;
  }

  return `${path.slice(0, Math.max(0, maxLength - 1))}…`;
}

async function forwardRequest(targetUrl: URL, message: RequestMessage) {
  const requestUrl = new URL(message.path, targetUrl);
  const headers = new Headers(message.headers);
  headers.set("host", targetUrl.host);

  let response: Response;

  try {
    response = await fetchWithLocalTlsFallback(requestUrl, {
      method: message.method,
      headers,
      body: base64ToUint8Array(message.bodyBase64),
      redirect: "manual",
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Upstream request failed";

    return {
      type: "response" as const,
      id: message.id,
      status: 502,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
      bodyBase64: Buffer.from(messageText).toString("base64"),
    };
  }

  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_HTTP_BODY_BYTES) {
    return {
      type: "response" as const,
      id: message.id,
      status: 502,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
      bodyBase64: Buffer.from("Upstream response too large").toString("base64"),
    };
  }

  const body = await response.arrayBuffer();

  if (body.byteLength > MAX_HTTP_BODY_BYTES) {
    return {
      type: "response" as const,
      id: message.id,
      status: 502,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
      bodyBase64: Buffer.from("Upstream response too large").toString("base64"),
    };
  }

  return {
    type: "response" as const,
    id: message.id,
    status: response.status,
    headers: sanitizeResponseHeaders(response.headers),
    bodyBase64: bodyToBase64(body),
  };
}

async function fetchWithLocalTlsFallback(url: URL, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (!shouldRetryWithInsecureLocalTls(url, error)) {
      throw error;
    }

    return fetch(url, {
      ...init,
      tls: {
        rejectUnauthorized: false,
      },
    });
  }
}

function shouldRetryWithInsecureLocalTls(url: URL, error: unknown): boolean {
  if (url.protocol !== "https:") {
    return false;
  }

  const host = url.hostname.toLowerCase();
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  const looksLikeLocalDevHost = host === "localhost"
    || host.endsWith(".test")
    || host.endsWith(".localhost")
    || host.endsWith(".local");

  const looksLikeTlsVerificationFailure = message.includes("unable to verify the first certificate")
    || message.includes("self-signed certificate")
    || message.includes("self signed certificate")
    || message.includes("certificate has expired")
    || message.includes("unable to get local issuer certificate")
    || message.includes("hostname/ip does not match certificate");

  return looksLikeLocalDevHost && looksLikeTlsVerificationFailure;
}

function buildWebSocketUrl(server: string): URL {
  const input = server.trim();

  if (websocketUrlPattern.test(input)) {
    return new URL(input);
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
