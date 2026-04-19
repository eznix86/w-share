import { Command } from "commander";
import { promptAndSaveClientConfig } from "../shared/config.ts";

export function configCommand(): Command {
  const command = new Command("config");

  command
    .description("Configure the saved client server URL and token")
    .action(async () => {
      await promptAndSaveClientConfig();
    });

  return command;
}
