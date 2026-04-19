import { Command } from "commander";
import { DEFAULT_SERVER_PORT } from "../shared/constants.ts";
import { startServer } from "../server/index.ts";

export function serveCommand(): Command {
  const command = new Command("serve");

  command
    .description("Start the public tunnel server")
    .requiredOption("--domain <domain>", "Public wildcard domain, e.g. share.example.com")
    .option("--port <port>", "Local listen port", String(DEFAULT_SERVER_PORT))
    .action((options) => {
      const token = process.env.W_SHARE_TOKEN;

      if (!token) {
        throw new Error("W_SHARE_TOKEN is required");
      }

      startServer({
        token,
        domain: String(options.domain),
        port: Number(options.port),
      });
    });

  return command;
}
