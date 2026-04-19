import { z } from "zod";

export type RegisterMessage = {
  type: "register";
  token: string;
};

export type AuthCheckMessage = {
  type: "auth-check";
  token: string;
};

export type AuthOkMessage = {
  type: "auth-ok";
};

export type RegisteredMessage = {
  type: "registered";
  subdomain: string;
  url: string;
};

export type RequestMessage = {
  type: "request";
  id: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  bodyBase64?: string;
};

export type ResponseMessage = {
  type: "response";
  id: string;
  status: number;
  headers: Record<string, string>;
  bodyBase64?: string;
};

export type ErrorMessage = {
  type: "error";
  message: string;
  code?: string;
};

export type PingMessage = {
  type: "ping" | "pong";
};

export type ClientToServerMessage = AuthCheckMessage | RegisterMessage | ResponseMessage | PingMessage;
export type ServerToClientMessage = AuthOkMessage | RegisteredMessage | RequestMessage | ErrorMessage | PingMessage;

export type ParsedIncomingMessage = ClientToServerMessage | ServerToClientMessage;

const headersSchema = z.record(z.string(), z.string());

export const authCheckMessageSchema = z.object({
  type: z.literal("auth-check"),
  token: z.string().min(1),
});

export const registerMessageSchema = z.object({
  type: z.literal("register"),
  token: z.string().min(1),
});

export const authOkMessageSchema = z.object({
  type: z.literal("auth-ok"),
});

export const registeredMessageSchema = z.object({
  type: z.literal("registered"),
  subdomain: z.string().min(1),
  url: z.string().url(),
});

export const requestMessageSchema = z.object({
  type: z.literal("request"),
  id: z.string().min(1),
  method: z.string().min(1),
  path: z.string().min(1),
  headers: headersSchema,
  bodyBase64: z.string().optional(),
});

export const responseMessageSchema = z.object({
  type: z.literal("response"),
  id: z.string().min(1),
  status: z.number().int().min(100).max(599),
  headers: headersSchema,
  bodyBase64: z.string().optional(),
});

export const errorMessageSchema = z.object({
  type: z.literal("error"),
  message: z.string().min(1),
  code: z.string().min(1).optional(),
});

export const pingMessageSchema = z.object({
  type: z.union([z.literal("ping"), z.literal("pong")]),
});

export const parsedIncomingMessageSchema = z.union([
  authCheckMessageSchema,
  authOkMessageSchema,
  registerMessageSchema,
  registeredMessageSchema,
  requestMessageSchema,
  responseMessageSchema,
  errorMessageSchema,
  pingMessageSchema,
]);

export const clientConfigSchema = z.object({
  token: z.string().min(1).optional(),
  server: z.string().min(1).optional(),
});
