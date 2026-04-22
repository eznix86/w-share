import type { ServerWebSocket } from "bun";
import { DEFAULT_REQUEST_TIMEOUT_MS, MAX_PENDING_REQUESTS } from "../shared/constants.ts";
import { generateSecureSubdomain, validateRequestedSubdomain } from "../shared/utils.ts";

export type ClientData = {
  basicAuth?: {
    username: string;
    password: string;
  registered: boolean;
  subdomain: string;
  registeredAt: number;
};

type PendingRequest = {
  resolve: (response: Response) => void;
  timeout: Timer;
};

export type TunnelWebSocket = ServerWebSocket<ClientData>;

export class Registry {
  private readonly clients = new Map<string, TunnelWebSocket>();
  private readonly pending = new Map<string, PendingRequest>();

  registerClient(socket: TunnelWebSocket): { subdomain: string } {
    const existing = new Set(this.clients.keys());
    const subdomain = generateSecureSubdomain(existing);

    socket.data = {
      registered: true,
      subdomain,
      registeredAt: Date.now(),
    };

    this.clients.set(subdomain, socket);

    return { subdomain };
  }

  unregisterClient(socket: TunnelWebSocket): void {
    const subdomain = socket.data?.subdomain;

    if (subdomain) {
      this.clients.delete(subdomain);
    }
  }

  getClient(subdomain: string): TunnelWebSocket | undefined {
    return this.clients.get(subdomain);
  }

  createPendingRequest(requestId: string, socket: TunnelWebSocket): Promise<Response> {
    if (this.pending.size >= MAX_PENDING_REQUESTS) {
      return Promise.resolve(new Response("Server is busy", { status: 503 }));
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        resolve(new Response("Upstream timeout", { status: 504 }));
      }, DEFAULT_REQUEST_TIMEOUT_MS);

      this.pending.set(requestId, { socket, resolve, timeout });
    });
  }

  resolvePendingRequest(requestId: string, socket: TunnelWebSocket, response: Response): void {
    const pending = this.pending.get(requestId);

    if (!pending) {
      return;
    }

    if (pending.socket !== socket) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(requestId);
    pending.resolve(response);
  }

  failPendingRequestsForClient(socket: TunnelWebSocket): void {
    for (const [requestId, pending] of this.pending.entries()) {
      if (pending.socket !== socket) {
        continue;
      }

      clearTimeout(pending.timeout);
      this.pending.delete(requestId);
      pending.resolve(new Response("Tunnel disconnected", { status: 502 }));
    }
  }
}
