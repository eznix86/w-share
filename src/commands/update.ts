import { Command } from "commander";
import os from "node:os";
import { VERSION } from "../shared/version.ts";

const INSTALL_SCRIPT_URL = "https://raw.githubusercontent.com/eznix86/w-share/main/install.sh";

export function updateCommand(): Command {
  const command = new Command("update");

  command
    .description("Update w-share using the release installer")
    .argument("[tag]", "Release tag to install, e.g. v1.0.4")
    .action(async (tag?: string) => {
      ensureSupportedPlatform();

      const script = await downloadInstallScript();
      await runInstallScript(script, tag);

      const installedVersion = installedVersionText();
      if (installedVersion) {
        console.log(`Updated w-share from ${VERSION} to ${installedVersion}`);
      }
    });

  return command;
}

function installedVersionText(): string | undefined {
  const result = Bun.spawnSync(["sh", "-c", "command -v w-share >/dev/null 2>&1 && w-share version --text"], {
    stdout: "pipe",
    stderr: "ignore",
  });

  if (result.exitCode !== 0) {
    return undefined;
  }

  return result.stdout.toString().trim() || undefined;
}

function ensureSupportedPlatform(): void {
  const platform = os.platform();

  if (platform !== "darwin" && platform !== "linux") {
    throw new Error("Self-update is only supported on macOS and Linux");
  }
}

async function downloadInstallScript(): Promise<string> {
  const response = await fetch(INSTALL_SCRIPT_URL);

  if (!response.ok) {
    throw new Error(`Could not download installer: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function runInstallScript(script: string, tag?: string): Promise<void> {
  const args = ["sh", "-s", "--"];

  if (tag) {
    args.push(tag);
  }

  const installer = Bun.spawn(args, {
    stdin: "pipe",
    stdout: "inherit",
    stderr: "inherit",
    env: Bun.env,
  });

  installer.stdin.write(script);
  installer.stdin.end();

  const exitCode = await installer.exited;

  if (exitCode !== 0) {
    throw new Error(`Installer exited with code ${exitCode}`);
  }
}
