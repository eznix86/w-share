import { afterAll, beforeAll, expect, test } from "bun:test";
import { startServer } from "./index.ts";
import { startClient } from "../client/index.ts";

const TOKEN = "test-token";
const DOMAIN = "test.local";
const SERVER_PORT = 18081;
const UPSTREAM_PORT = 18082;

let server: ReturnType<typeof startServer>;
let upstream: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
  upstream = Bun.serve<undefined, never>({
    port: UPSTREAM_PORT,
    fetch(request, bunServer): Response | undefined {
      if (bunServer.upgrade(request)) {
        return undefined;
      }

      return new Response("not a websocket", { status: 400 });
    },
    websocket: {
      open(socket) {
        socket.send(JSON.stringify({ event: "server-speaks-first" }));
      },
      message(socket, data) {
        socket.send(`echo:${String(data)}`);
      },
    },
  });

  server = startServer({ token: TOKEN, domain: DOMAIN, port: SERVER_PORT });

  void startClient({
    target: `:${UPSTREAM_PORT}`,
    server: `http://127.0.0.1:${SERVER_PORT}`,
    token: TOKEN,
    subdomain: "probe",
    qr: false,
  });

  await waitForTunnelRegistration();
});

afterAll(() => {
  server.server.stop(true);
  upstream.stop(true);
});

async function waitForTunnelRegistration(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${SERVER_PORT}/health`, {
      headers: { host: `probe.${DOMAIN}` },
    }).catch(() => null);

    if (response && response.status !== 404) {
      return;
    }

    await Bun.sleep(50);
  }

  throw new Error("Tunnel client did not register in time");
}

function connectThroughTunnel(): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${SERVER_PORT}/`, {
    headers: { host: `probe.${DOMAIN}` },
  } as unknown as string[]);
}

function nextFrame(socket: WebSocket, timeoutMs = 5_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("No frame received before timeout")), timeoutMs);

    socket.addEventListener("message", (event) => {
      clearTimeout(timer);
      resolve(String(event.data));
    }, { once: true });

    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("WebSocket error"));
    }, { once: true });
  });
}

test("relays a server-initiated frame to a browser that never sends anything", async () => {
  const socket = connectThroughTunnel();

  try {
    const frame = await nextFrame(socket);

    expect(JSON.parse(frame)).toEqual({ event: "server-speaks-first" });
  } finally {
    socket.close();
  }
});

test("relays frames in both directions", async () => {
  const socket = connectThroughTunnel();

  try {
    await nextFrame(socket);

    const echoed = nextFrame(socket);
    socket.send("ping");

    expect(await echoed).toBe("echo:ping");
  } finally {
    socket.close();
  }
});
