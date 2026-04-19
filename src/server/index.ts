import chalk from "chalk";
import type { Server, ServerWebSocket } from "bun";
import { DEFAULT_SERVER_PORT, MAX_HTTP_BODY_BYTES, WS_PATH } from "../shared/constants.ts";
import { decodeMessage, encodeMessage } from "../shared/protocol.ts";
import type { AuthCheckMessage, RegisterMessage, ResponseMessage } from "../shared/types.ts";
import { base64ToUint8Array, bodyToBase64, getSubdomainFromHost, randomId, sanitizeHeaders } from "../shared/utils.ts";
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
  registered: boolean;
  subdomain?: string;
  registeredAt?: number;
};

export function startServer(options: StartServerOptions): ServerHandle {
  const port = options.port ?? DEFAULT_SERVER_PORT;
  const registry = new Registry();

  const server = Bun.serve<SocketSessionData>({
    port,
    idleTimeout: 60,
    fetch(request, server) {
      const url = new URL(request.url);

      if (url.pathname === WS_PATH) {
        const upgraded = server.upgrade(request, {
          data: {
            registered: false,
          },
        });

        if (upgraded) {
          return undefined;
        }

        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      const host = request.headers.get("host") ?? "";
      const subdomain = getSubdomainFromHost(host, options.domain);

      if (!subdomain) {
        return Response.json({
          ok: true,
          message: "w-share server is running",
          websocket: WS_PATH,
          domain: options.domain,
        });
      }

      const socket = registry.getClient(subdomain);

      if (!socket) {
        return new Response("Not found", { status: 404 });
      }

      const contentLength = Number(request.headers.get("content-length") ?? "0");
      if (Number.isFinite(contentLength) && contentLength > MAX_HTTP_BODY_BYTES) {
        return new Response("Payload too large", { status: 413 });
      }

      const requestId = randomId(12);
      const path = `${url.pathname}${url.search}` || "/";

      return (async () => {
        const bodyBuffer = await request.arrayBuffer();

        if (bodyBuffer.byteLength > MAX_HTTP_BODY_BYTES) {
          return new Response("Payload too large", { status: 413 });
        }

        const payload = {
          type: "request",
          id: requestId,
          method: request.method,
          path,
          headers: sanitizeHeaders(request.headers),
          bodyBase64: bodyToBase64(bodyBuffer),
        };

        const pending = registry.createPendingRequest(requestId);
        socket.send(encodeMessage(payload));
        return pending;
      })();
    },
    websocket: {
      open(socket) {
        socket.subscribe("clients");
      },
      message(socket, rawMessage) {
        const message = decodeMessage(rawMessage);

        if (!message) {
          socket.send(encodeMessage({ type: "error", message: "Invalid message" }));
          return;
        }

        if (message.type === "register") {
          handleRegister(asTunnelSocket(socket), message, registry, options);
          return;
        }

        if (message.type === "auth-check") {
          handleAuthCheck(asTunnelSocket(socket), message, options);
          return;
        }

        if (message.type === "response") {
          handleResponse(message, registry);
          return;
        }

        if (message.type === "ping") {
          socket.send(encodeMessage({ type: "pong" }));
        }
      },
      close(socket) {
        registry.unregisterClient(asTunnelSocket(socket));
      },
    },
  });

  console.log(chalk.green(`Server listening on http://0.0.0.0:${port}`));
  console.log(chalk.gray(`Wildcard domain: *.${options.domain}`));

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

  console.log(chalk.cyan(`Registered ${subdomain}.${options.domain}`));
}

function handleAuthCheck(socket: TunnelWebSocket, message: AuthCheckMessage, options: StartServerOptions): void {
  if (!authenticateSocket(socket, message.token, options)) {
    return;
  }

  socket.send(encodeMessage({ type: "auth-ok" }));
  socket.close();
}

function authenticateSocket(socket: TunnelWebSocket, token: string, options: StartServerOptions): boolean {
  if (token !== options.token) {
    socket.send(encodeMessage({ type: "error", code: "AUTH_FAILED", message: "Invalid token" }));
    socket.close();
    return false;
  }

  return true;
}

export function asTunnelSocket(socket: ServerWebSocket<SocketSessionData>): TunnelWebSocket {
  return socket as unknown as TunnelWebSocket;
}

function handleResponse(message: ResponseMessage, registry: Registry): void {
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
