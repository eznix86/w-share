import type { ServerWebSocket } from "bun";
import { DEFAULT_REQUEST_TIMEOUT_MS, MAX_PENDING_REQUESTS } from "../shared/constants.ts";
import { generateSecureSubdomain } from "../shared/utils.ts";

export type ClientData = {
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

  createPendingRequest(requestId: string): Promise<Response> {
    if (this.pending.size >= MAX_PENDING_REQUESTS) {
      return Promise.resolve(new Response("Server is busy", { status: 503 }));
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        resolve(new Response("Upstream timeout", { status: 504 }));
      }, DEFAULT_REQUEST_TIMEOUT_MS);

      this.pending.set(requestId, { resolve, timeout });
    });
  }

  resolvePendingRequest(requestId: string, response: Response): void {
    const pending = this.pending.get(requestId);

    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(requestId);
    pending.resolve(response);
  }

  failPendingRequestsForClient(_socket: TunnelWebSocket): void {
    // MVP: requests are correlated only by id, so we only fail on timeout.
  }
}
