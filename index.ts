#!/usr/bin/env bun

import { Command } from "commander";
import { configCommand } from "./src/commands/config.ts";
import { httpCommand } from "./src/commands/http.ts";
import { renderBrandIntro } from "./src/shared/brand.ts";
import { serveCommand } from "./src/commands/serve.ts";
import { updateCommand } from "./src/commands/update.ts";
import { renderUpdateNotice } from "./src/shared/update-notice.ts";
import { VERSION } from "./src/shared/version.ts";

function printVersion(): void {
  renderBrandIntro(VERSION);
}

async function main(): Promise<void> {
  if (process.argv.includes("--version") || process.argv.includes("-V")) {
    printVersion();
    await renderUpdateNotice(VERSION);
    process.exit(0);
  }

  const program = new Command();

  program
    .name("w")
    .description("Lightweight HTTP tunnel for local sites");

  program
    .command("version")
    .description("Show the installed w version")
    .action(async () => {
      printVersion();
      await renderUpdateNotice(VERSION);
    });

  program.addCommand(serveCommand());
  program.addCommand(httpCommand());
  program.addCommand(configCommand());
  program.addCommand(updateCommand());

  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
