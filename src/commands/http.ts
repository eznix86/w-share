import { Command } from "commander";
import { startClient } from "../client/index.ts";
import { loadOrPromptClientServer, loadOrPromptClientToken } from "../shared/config.ts";

export function httpCommand(): Command {
  const command = new Command("http");

  command
    .description("Expose a local HTTP target")
    .argument("<target>", "Local target, e.g. :8000 or https://whatever.test")
    .option("--server <server>", "Server URL, e.g. https://share.example.com")
    .action(async (target, options) => {
      const server = await loadOrPromptClientServer(typeof options.server === "string" ? options.server : undefined);
      const token = await loadOrPromptClientToken();

      await startClient({
        target: String(target),
        server,
        token,
      });
    });

  return command;
}
