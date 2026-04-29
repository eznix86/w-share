import crypto from "node:crypto";
import { hostWithPortPattern, httpUrlPattern, uuidHyphenPattern, validSubdomainPattern } from "./regexp.ts";

export function randomId(length = 8): string {
  return crypto.randomBytes(length).toString("hex").slice(0, length);
}

export function generateSecureSubdomain(existing: Set<string>): string {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = crypto.randomBytes(16).toString("base64url").toLowerCase();

    if (!existing.has(candidate)) {
      return candidate;
    }
  }

  return crypto.randomUUID().replace(uuidHyphenPattern, "");
}

export function validateRequestedSubdomain(value: string): string | null {
  if (value.length < 3 || value.length > 63) {
    return "--name must be between 3 and 63 characters";
  }

  if (!validSubdomainPattern.test(value)) {
    return "--name must contain only lowercase letters, numbers, and hyphens";
  }

  if (value.startsWith("-") || value.endsWith("-")) {
    return "--name cannot start or end with a hyphen";
  }

  return null;
}

export function normalizeTarget(target: string): URL {
  const trimmed = target.trim();

  if (trimmed.startsWith(":")) {
    return new URL(`http://127.0.0.1${trimmed}`);
  }

  if (httpUrlPattern.test(trimmed)) {
    return new URL(trimmed);
  }

  if (hostWithPortPattern.test(trimmed)) {
    return new URL(`http://${trimmed}`);
  }

  return new URL(`http://${trimmed}`);
}

export function getSubdomainFromHost(host: string, domain: string): string | null {
  const normalizedHost = host.split(":")[0]?.toLowerCase();
  const normalizedDomain = domain.toLowerCase();

  if (!normalizedHost) {
    return null;
  }

  if (normalizedHost === normalizedDomain) {
    return null;
  }

  if (!normalizedHost.endsWith(`.${normalizedDomain}`)) {
    return null;
  }

  const suffixIndex = normalizedHost.length - normalizedDomain.length - 1;
  const subdomain = normalizedHost.slice(0, suffixIndex);

  return subdomain || null;
}

export function sanitizeHeaders(headers: Headers): Record<string, string> {
  return sanitizeHeadersWithMode(headers, "generic");
}

export function sanitizeResponseHeaders(headers: Headers): Record<string, string> {
  return sanitizeHeadersWithMode(headers, "response");
}

function sanitizeHeadersWithMode(headers: Headers, mode: "generic" | "response"): Record<string, string> {
  const blocked = new Set([
    "connection",
    "content-length",
    "content-encoding",
    "cf-connecting-ip",
    "forwarded",
    "host",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "true-client-ip",
    "transfer-encoding",
    "upgrade",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-port",
    "x-forwarded-proto",
    "x-real-ip",
  ]);

  const result: Record<string, string> = {};

  for (const [key, value] of headers.entries()) {
    const lower = key.toLowerCase();

    if (!blocked.has(lower)) {
      result[key] = value;
      continue;
    }

    if (mode === "response") {
      continue;
    }
  }

  return result;
}

export function bodyToBase64(buffer: ArrayBuffer): string | undefined {
  if (buffer.byteLength === 0) {
    return undefined;
  }

  return Buffer.from(buffer).toString("base64");
}

export function base64ToUint8Array(value?: string): Uint8Array | undefined {
  if (!value) {
    return undefined;
  }

  return Uint8Array.from(Buffer.from(value, "base64"));
}
