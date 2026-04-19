#!/usr/bin/env bun

import { Command } from "commander";
import packageJson from "./package.json";
import { configCommand } from "./src/commands/config.ts";
import { httpCommand } from "./src/commands/http.ts";
import { renderBrandIntro } from "./src/shared/brand.ts";
import { serveCommand } from "./src/commands/serve.ts";

const VERSION = packageJson.version;

function printVersion(): void {
  renderBrandIntro({ version: VERSION });
}

if (process.argv.includes("--version") || process.argv.includes("-V")) {
  printVersion();
  process.exit(0);
}

const program = new Command();

program
  .name("w")
  .description("Lightweight HTTP tunnel for local sites");

program
  .command("version")
  .description("Show the installed w version")
  .action(() => {
    printVersion();
  });

program.addCommand(serveCommand());
program.addCommand(httpCommand());
program.addCommand(configCommand());

await program.parseAsync(process.argv);
