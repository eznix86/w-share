#!/usr/bin/env bun

import { Command } from "commander";
import { configCommand } from "./src/commands/config.ts";
import { serveCommand } from "./src/commands/serve.ts";
import { httpCommand } from "./src/commands/http.ts";

const program = new Command();

program
  .name("w")
  .description("Lightweight HTTP tunnel for local sites")
  .version("0.1.0");

program.addCommand(serveCommand());
program.addCommand(httpCommand());
program.addCommand(configCommand());

await program.parseAsync(process.argv);
