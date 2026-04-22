import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: {
    paths: [
      "token",
      "headers.authorization",
      "headers.cookie",
      "headers.set-cookie",
    ],
    remove: true,
  },
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});
