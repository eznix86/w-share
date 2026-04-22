import type { Server, ServerWebSocket } from "bun";
import {
  DEFAULT_SERVER_PORT,
  MAX_HTTP_BODY_BYTES,
  WS_AUTH_FAILURE_LIMIT_MAX,
  WS_AUTH_FAILURE_LIMIT_WINDOW_MS,
  WS_PATH,
  WS_UPGRADE_RATE_LIMIT_MAX,
  WS_UPGRADE_RATE_LIMIT_WINDOW_MS,
} from "../shared/constants.ts";
import { decodeMessage, encodeMessage } from "../shared/protocol.ts";
import type { AuthCheckMessage, RegisterMessage, ResponseMessage } from "../shared/types.ts";
import { base64ToUint8Array, bodyToBase64, getSubdomainFromHost, randomId, sanitizeHeaders } from "../shared/utils.ts";
import { logger } from "./logger.ts";
import { Registry, type ClientData, type TunnelWebSocket } from "./registry.ts";

type StartServerOptions = {
  token: string;
  domain: string;
  port?: number;
};

type ServerHandle = {
  server: Server<SocketSessionData>;
};

type SocketSessionData = {
  basicAuth?: {
    username: string;
    password: string;
  };
  ipAddress: string;
  registered: boolean;
  subdomain?: string;
  registeredAt?: number;
};

class FixedWindowRateLimiter {
  private readonly entries = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string): boolean {
    const now = Date.now();
    const current = this.entries.get(key);

    if (!current || current.resetAt <= now) {
      this.entries.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }

    if (current.count >= this.limit) {
      return false;
    }

    current.count += 1;
    return true;
  }

  reset(key: string): void {
    this.entries.delete(key);
  }
}

export function startServer(options: StartServerOptions): ServerHandle {
  const port = options.port ?? DEFAULT_SERVER_PORT;
  const registry = new Registry();
  const wsUpgradeRateLimiter = new FixedWindowRateLimiter(WS_UPGRADE_RATE_LIMIT_MAX, WS_UPGRADE_RATE_LIMIT_WINDOW_MS);
  const wsAuthFailureRateLimiter = new FixedWindowRateLimiter(WS_AUTH_FAILURE_LIMIT_MAX, WS_AUTH_FAILURE_LIMIT_WINDOW_MS);

  const server = Bun.serve<SocketSessionData>({
    port,
    idleTimeout: 60,
    fetch(request, server) {
      const url = new URL(request.url);
      const clientIp = getClientIp(server, request);

      if (url.pathname === WS_PATH) {
        if (!wsUpgradeRateLimiter.allow(clientIp)) {
          logger.warn({ event: "ws_upgrade_rate_limited", client_ip: clientIp }, "WebSocket upgrade rate limited");
          return new Response("Too many WebSocket upgrade attempts", { status: 429 });
        }

        if (!isAllowedWebSocketOrigin(request, options.domain)) {
          logger.warn({
            event: "ws_origin_rejected",
            client_ip: clientIp,
            origin: request.headers.get("origin"),
          }, "WebSocket origin rejected");
          return new Response("WebSocket origin not allowed", { status: 403 });
        }

        const upgraded = server.upgrade(request, {
          data: {
            ipAddress: clientIp,
            registered: false,
          },
        });

        if (upgraded) {
          logger.info({ event: "ws_upgrade_accepted", client_ip: clientIp }, "WebSocket upgraded");
          return undefined;
        }

        logger.warn({ event: "ws_upgrade_failed", client_ip: clientIp }, "WebSocket upgrade failed");
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      const host = request.headers.get("host") ?? "";
      const subdomain = getSubdomainFromHost(host, options.domain);

      if (!subdomain) {
        if (url.pathname === "/" || url.pathname === "/health") {
          return Response.json({
            ok: true,
            message: "w-share server is running",
            websocket: WS_PATH,
            domain: options.domain,
          });
        }

        logger.info({ event: "root_not_found", client_ip: clientIp, path: url.pathname }, "Root path not found");
        return new Response("Not found", { status: 404 });
      }

      const socket = registry.getClient(subdomain);

      if (!socket) {
        logger.info({ event: "subdomain_not_found", client_ip: clientIp, subdomain, path: url.pathname }, "Tunnel subdomain not found");
        return new Response("Not found", { status: 404 });
      }

      const authResponse = authenticateTunnelRequest(request, socket);
      if (authResponse) {
        return authResponse;
      }

      const contentLength = Number(request.headers.get("content-length") ?? "0");
      if (Number.isFinite(contentLength) && contentLength > MAX_HTTP_BODY_BYTES) {
        return new Response("Payload too large", { status: 413 });
      }

      const requestId = randomId(12);
      const path = `${url.pathname}${url.search}` || "/";
      const startedAt = Date.now();

      return (async () => {
        const bodyBuffer = await request.arrayBuffer();

        if (bodyBuffer.byteLength > MAX_HTTP_BODY_BYTES) {
          return new Response("Payload too large", { status: 413 });
        }

        const headers = sanitizeHeaders(request.headers);
        headers["x-forwarded-host"] = host;
        headers["x-forwarded-proto"] = url.protocol.replace(/:$/, "");
        headers["x-forwarded-port"] = url.port || (url.protocol === "https:" ? "443" : "80");

        const payload = {
          type: "request",
          id: requestId,
          method: request.method,
          path,
          headers,
          bodyBase64: bodyToBase64(bodyBuffer),
        };

        const pending = registry.createPendingRequest(requestId, socket);
        socket.send(encodeMessage(payload));
        logger.info({
          event: "request_forwarded",
          client_ip: clientIp,
          subdomain,
          request_id: requestId,
          method: request.method,
          path,
        }, "Request forwarded to tunnel client");

        return pending.then((response) => {
          logger.info({
            event: "request_completed",
            client_ip: clientIp,
            subdomain,
            request_id: requestId,
            method: request.method,
            path,
            status: response.status,
            duration_ms: Date.now() - startedAt,
          }, "Request completed");
          return response;
        });
      })();
    },
    websocket: {
      open(socket) {
        socket.subscribe("clients");
      },
      message(socket, rawMessage) {
        const message = decodeMessage(rawMessage);

        if (!message) {
          logger.warn({ event: "ws_invalid_message", client_ip: socket.data.ipAddress }, "Invalid WebSocket message");
          socket.send(encodeMessage({ type: "error", message: "Invalid message" }));
          return;
        }

        if (message.type === "register") {
          handleRegister(asTunnelSocket(socket), message, registry, options, wsAuthFailureRateLimiter);
          return;
        }

        if (message.type === "auth-check") {
          handleAuthCheck(asTunnelSocket(socket), message, options, wsAuthFailureRateLimiter);
          return;
        }

        if (message.type === "response") {
          handleResponse(asTunnelSocket(socket), message, registry);
          return;
        }

        if (message.type === "ping") {
          socket.send(encodeMessage({ type: "pong" }));
        }
      },
      close(socket) {
        const tunnelSocket = asTunnelSocket(socket);
        logger.info({
          event: "tunnel_disconnected",
          client_ip: tunnelSocket.data.ipAddress,
          subdomain: tunnelSocket.data.subdomain,
        }, "Tunnel disconnected");
        registry.unregisterClient(tunnelSocket);
        registry.failPendingRequestsForClient(tunnelSocket);
      },
    },
  });

  logger.info({ event: "server_started", port, domain: options.domain }, "Server started");

  return { server };
}

function handleRegister(
  socket: TunnelWebSocket,
  message: RegisterMessage,
  registry: Registry,
  options: StartServerOptions,
): void {
  if (!authenticateSocket(socket, message.token, options)) {
    return;
  }

  if (socket.data?.registered) {
    socket.send(encodeMessage({ type: "error", code: "ALREADY_REGISTERED", message: "Client already registered" }));
    return;
  }

  const { subdomain } = registry.registerClient(socket);
  socket.data = {
    registered: true,
    subdomain,
    registeredAt: Date.now(),
  };

  socket.send(encodeMessage({
    type: "registered",
    subdomain,
    url: `https://${subdomain}.${options.domain}`,
  }));

  logger.info({
    event: "tunnel_registered",
    client_ip: socket.data.ipAddress,
    subdomain,
    url: `https://${subdomain}.${options.domain}`,
  }, "Tunnel registered");
}

function handleAuthCheck(
  socket: TunnelWebSocket,
  message: AuthCheckMessage,
  options: StartServerOptions,
  authFailureRateLimiter: FixedWindowRateLimiter,
): void {
  if (!authenticateSocket(socket, message.token, options, authFailureRateLimiter)) {
    return;
  }

  authFailureRateLimiter.reset(socket.data.ipAddress);

  logger.info({ event: "auth_check_succeeded", client_ip: socket.data.ipAddress }, "Tunnel auth check succeeded");
  socket.send(encodeMessage({ type: "auth-ok" }));
  socket.close();
}

function authenticateSocket(
  socket: TunnelWebSocket,
  token: string,
  options: StartServerOptions,
  authFailureRateLimiter: FixedWindowRateLimiter,
): boolean {
  const clientIp = socket.data.ipAddress;

  if (!authFailureRateLimiter.allow(clientIp)) {
    logger.warn({ event: "ws_auth_rate_limited", client_ip: clientIp }, "WebSocket auth rate limited");
    socket.send(encodeMessage({ type: "error", code: "RATE_LIMITED", message: "Too many authentication failures" }));
    socket.close();
    return false;
  }

  if (token !== options.token) {
    logger.warn({ event: "ws_auth_failed", client_ip: clientIp }, "WebSocket auth failed");
    socket.send(encodeMessage({ type: "error", code: "AUTH_FAILED", message: "Invalid token" }));
    socket.close();
    return false;
  }

  return true;
}

function isAllowedWebSocketOrigin(request: Request, domain: string): boolean {
  const origin = request.headers.get("origin");

  if (!origin) {
    return true;
  }

  try {
    const originUrl = new URL(origin);
    return originUrl.host.toLowerCase() === domain.toLowerCase();
  } catch {
    return false;
  }
}

function getClientIp(server: Server<SocketSessionData>, request: Request): string {
  const peerIp = normalizeIpAddress(server.requestIP(request)?.address);

  if (!peerIp) {
    return "unknown";
  }

  if (!isTrustedProxyIp(peerIp)) {
    return peerIp;
  }

  return getTrustedForwardedClientIp(request) ?? peerIp;
}

function getTrustedForwardedClientIp(request: Request): string | null {
  const directHeaderCandidates = [
    request.headers.get("cf-connecting-ip"),
    request.headers.get("true-client-ip"),
    request.headers.get("x-real-ip"),
  ];

  for (const candidate of directHeaderCandidates) {
    const normalized = normalizeIpAddress(candidate);

    if (normalized) {
      return normalized;
    }
  }

  const forwardedIp = getForwardedClientIp(request.headers.get("x-forwarded-for"));
  if (forwardedIp) {
    return forwardedIp;
  }

  return getForwardedHeaderClientIp(request.headers.get("forwarded"));
}

function getForwardedClientIp(forwardedFor: string | null): string | null {
  if (!forwardedFor) {
    return null;
  }

  const candidates = forwardedFor
    .split(",")
    .map((value) => normalizeIpAddress(value.trim()))
    .filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (!isTrustedProxyIp(candidate)) {
      return candidate;
    }
  }

  return candidates[0] ?? null;
}

function getForwardedHeaderClientIp(forwarded: string | null): string | null {
  if (!forwarded) {
    return null;
  }

  const segments = forwarded.split(",");

  for (const segment of segments) {
    const parts = segment.split(";");

    for (const part of parts) {
      const [rawKey, rawValue] = part.split("=", 2);

      if (!rawKey || !rawValue || rawKey.trim().toLowerCase() !== "for") {
        continue;
      }

      const normalized = normalizeForwardedHeaderValue(rawValue);
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}

function normalizeForwardedHeaderValue(value: string): string | null {
  const trimmed = value.trim().replace(/^"|"$/g, "");

  if (!trimmed || trimmed.toLowerCase() === "unknown") {
    return null;
  }

  if (trimmed.startsWith("[")) {
    const closingIndex = trimmed.indexOf("]");
    if (closingIndex === -1) {
      return null;
    }

    return normalizeIpAddress(trimmed.slice(1, closingIndex));
  }

  const colonCount = (trimmed.match(/:/g) ?? []).length;
  if (colonCount === 1 && trimmed.includes(".")) {
    return normalizeIpAddress(trimmed.split(":", 1)[0]);
  }

  return normalizeIpAddress(trimmed);
}

function normalizeIpAddress(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim().toLowerCase();

  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("::ffff:")) {
    return trimmed.slice(7);
  }

  return trimmed;
}

function isTrustedProxyIp(ip: string): boolean {
  return isLoopbackIp(ip) || isPrivateIpv4(ip) || isUniqueLocalIpv6(ip) || isLinkLocalIpv6(ip);
}

function isLoopbackIp(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1";
}

function isPrivateIpv4(ip: string): boolean {
  const octets = ip.split(".").map((value) => Number.parseInt(value, 10));

  if (octets.length !== 4 || octets.some((value) => Number.isNaN(value) || value < 0 || value > 255)) {
    return false;
  }

  if (octets[0] === 10) {
    return true;
  }

  if (octets[0] === 172 && octets[1] !== undefined && octets[1] >= 16 && octets[1] <= 31) {
    return true;
  }

  if (octets[0] === 192 && octets[1] === 168) {
    return true;
  }

  if (octets[0] === 100 && octets[1] !== undefined && octets[1] >= 64 && octets[1] <= 127) {
    return true;
  }

  return false;
}

function isUniqueLocalIpv6(ip: string): boolean {
  return ip.startsWith("fc") || ip.startsWith("fd");
}

function isLinkLocalIpv6(ip: string): boolean {
  return ip.startsWith("fe80:");
}

export function asTunnelSocket(socket: ServerWebSocket<SocketSessionData>): TunnelWebSocket {
  return socket as unknown as TunnelWebSocket;
}

function handleResponse(socket: TunnelWebSocket, message: ResponseMessage, registry: Registry): void {
  if (!socket.data?.registered) {
    logger.warn({ event: "ws_response_from_unregistered_client", client_ip: socket.data.ipAddress }, "Response from unregistered client");
    socket.send(encodeMessage({ type: "error", code: "NOT_REGISTERED", message: "Client is not registered" }));
    socket.close();
    return;
  }

  const headers = new Headers();

  for (const [key, value] of Object.entries(message.headers ?? {})) {
    headers.set(key, value);
  }

  registry.resolvePendingRequest(
    message.id,
    new Response(base64ToUint8Array(message.bodyBase64), {
      status: message.status,
      headers,
    }),
  );
}
