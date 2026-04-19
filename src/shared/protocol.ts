import type { ParsedIncomingMessage } from "./types.ts";
import { parsedIncomingMessageSchema } from "./types.ts";

export function encodeMessage(message: unknown): string {
  return JSON.stringify(message);
}

export function decodeMessage(raw: string | Buffer | ArrayBufferLike | Uint8Array): ParsedIncomingMessage | null {
  try {
    const text = typeof raw === "string" ? raw : Buffer.from(raw as ArrayBufferLike).toString("utf8");
    return parsedIncomingMessageSchema.parse(JSON.parse(text));
  } catch {
    return null;
  }
}
