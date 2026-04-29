#!/usr/bin/env bun

import { Command } from "commander";
import { completionCommand } from "./src/commands/completion.ts";
import { configCommand } from "./src/commands/config.ts";
import { httpCommand } from "./src/commands/http.ts";
import { renderBrandIntro } from "./src/shared/brand.ts";
import { serveCommand } from "./src/commands/serve.ts";
import { uninstallCommand } from "./src/commands/uninstall.ts";
import { updateCommand } from "./src/commands/update.ts";
import { renderUpdateNotice } from "./src/shared/update-notice.ts";
import { VERSION } from "./src/shared/version.ts";

function printVersion(options?: { json?: boolean; text?: boolean }): void {
  if (options?.json) {
    console.log(JSON.stringify({ version: VERSION }));
    return;
  }

  if (options?.text) {
    console.log(VERSION);
    return;
  }

  renderBrandIntro(VERSION);
}

function shouldSkipVersionNotice(): boolean {
  return process.argv.includes("--json") || process.argv.includes("--text");
}

async function main(): Promise<void> {
  if (process.argv.includes("--version") || process.argv.includes("-V")) {
    printVersion({
      json: process.argv.includes("--json"),
      text: process.argv.includes("--text"),
    });

    if (!shouldSkipVersionNotice()) {
      await renderUpdateNotice(VERSION);
    }

    process.exit(0);
  }

  const program = new Command();

  program
    .name("w-share")
    .description("Lightweight HTTP tunnel for local sites");

  program
    .command("version")
    .description("Show the installed w-share version")
    .option("--json", "Print version information as JSON")
    .option("--text", "Print only the version number")
    .action(async (options: { json?: boolean; text?: boolean }) => {
      printVersion({ json: Boolean(options.json), text: Boolean(options.text) });

      if (!options.json && !options.text) {
        await renderUpdateNotice(VERSION);
      }
    });

  program.addCommand(serveCommand());
  program.addCommand(httpCommand());
  program.addCommand(configCommand());
  program.addCommand(updateCommand());
  program.addCommand(uninstallCommand());
  program.addCommand(completionCommand());

  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
