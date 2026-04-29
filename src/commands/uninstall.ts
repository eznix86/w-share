import { Command } from "commander";
import { log } from "@clack/prompts";
import { char, createRegExp, dotAll, exactly, maybe } from "magic-regexp";
import { lstat, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { wShareHelpPattern } from "../shared/regexp.ts";

const BINARY_NAME = "w-share";
const LEGACY_BINARY_NAME = "w";
const CONFIG_DIR = path.join(os.homedir(), ".config", "w-share");
const COMPLETION_PATHS = [
  path.join(os.homedir(), ".local", "share", "bash-completion", "completions", BINARY_NAME),
  path.join(os.homedir(), ".zsh", "completions", `_${BINARY_NAME}`),
  path.join(os.homedir(), ".config", "fish", "completions", `${BINARY_NAME}.fish`),
];

export function uninstallCommand(): Command {
  const command = new Command("uninstall");

  command
    .description("Uninstall w-share from this machine")
    .option("--purge", "Also remove saved client configuration")
    .action(async (options: { purge?: boolean }) => {
      await uninstall(Boolean(options.purge));
    });

  return command;
}

async function uninstall(purge: boolean): Promise<void> {
  const binaryPath = await findCommandPath(BINARY_NAME);

  if (binaryPath && await isWShareBinary(binaryPath)) {
    await removeFile(binaryPath, "Removed binary");
    await removeLegacyBinary(path.dirname(binaryPath));
  } else if (binaryPath) {
    log.warn(`${binaryPath} does not look like a w-share binary; leaving it in place`);
  } else {
    log.warn(`${BINARY_NAME} was not found in PATH`);
  }

  for (const completionPath of COMPLETION_PATHS) {
    await removeFile(completionPath, "Removed completion");
  }

  await removeZshCompletionBlock();

  if (purge) {
    await removeDirectory(CONFIG_DIR, "Removed saved configuration");
  }

  log.success("w-share uninstalled");
}

async function findCommandPath(command: string): Promise<string | undefined> {
  const result = Bun.spawnSync(["sh", "-c", `command -v ${command}`], {
    stdout: "pipe",
    stderr: "ignore",
  });

  if (result.exitCode !== 0) {
    return undefined;
  }

  const commandPath = result.stdout.toString().trim();
  return commandPath || undefined;
}

async function removeLegacyBinary(binaryDir: string): Promise<void> {
  const legacyPath = path.join(binaryDir, LEGACY_BINARY_NAME);

  if (!await isWShareBinary(legacyPath)) {
    return;
  }

  await removeFile(legacyPath, "Removed legacy binary");
}

async function isWShareBinary(binaryPath: string): Promise<boolean> {
  try {
    const result = Bun.spawnSync([binaryPath, "--help"], {
      stdout: "pipe",
      stderr: "ignore",
    });

    if (result.exitCode !== 0) {
      return false;
    }

    return wShareHelpPattern.test(result.stdout.toString());
  } catch {
    return false;
  }
}

async function removeFile(filePath: string, message: string): Promise<void> {
  try {
    if (!await exists(filePath)) {
      return;
    }

    await rm(filePath, { force: true });
    log.success(`${message}: ${filePath}`);
  } catch (error) {
    log.warn(`Could not remove ${filePath}: ${errorMessage(error)}`);
  }
}

async function removeDirectory(directoryPath: string, message: string): Promise<void> {
  try {
    if (!await exists(directoryPath)) {
      return;
    }

    await rm(directoryPath, { force: true, recursive: true });
    log.success(`${message}: ${directoryPath}`);
  } catch (error) {
    log.warn(`Could not remove ${directoryPath}: ${errorMessage(error)}`);
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function removeZshCompletionBlock(): Promise<void> {
  const zshrcPath = path.join(os.homedir(), ".zshrc");
  const startMarker = "# w-share completions";
  const endMarker = "# end w-share completions";

  try {
    const zshrc = await readFile(zshrcPath, "utf8");
    const wShareCompletionBlockPattern = createRegExp(
      maybe("\n"),
      exactly(startMarker),
      char.times.any(),
      exactly(endMarker),
      maybe("\n"),
      [dotAll],
    );
    const updated = zshrc.replace(wShareCompletionBlockPattern, "\n");

    if (updated !== zshrc) {
      await writeFile(zshrcPath, updated);
      log.success(`Removed zsh setup: ${zshrcPath}`);
    }
  } catch {
    // No zsh config to clean up.
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
