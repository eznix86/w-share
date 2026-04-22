import { Command } from "commander";
import { isCancel, password, text } from "@clack/prompts";
import { startClient } from "../client/index.ts";
import { renderBrandIntro } from "../shared/brand.ts";
import { loadOrPromptClientServer, loadOrPromptClientToken } from "../shared/config.ts";
import { renderUpdateNotice } from "../shared/update-notice.ts";
import { validateRequestedSubdomain } from "../shared/utils.ts";
import { VERSION } from "../shared/version.ts";

export function httpCommand(): Command {
  const command = new Command("http");

  command
    .alias("share")
    .description("Expose a local HTTP target")
    .argument("<target>", "Local target, e.g. :8000 or https://whatever.test")
    .option("--auth [credentials]", "Protect the public URL with Basic Auth")
    .option("--name <name>", "Request a custom public name, e.g. docs")
    .option("--qr", "Show a terminal QR code for the public URL")
    .option("--server <server>", "Server URL, e.g. https://share.example.com")
    .action(async (target, options) => {
      renderBrandIntro(VERSION);
      await renderUpdateNotice(VERSION);

      const server = await loadOrPromptClientServer(typeof options.server === "string" ? options.server : undefined);
      const token = await loadOrPromptClientToken();
      const basicAuth = await resolveBasicAuthOption(options.auth);
      const subdomain = resolveRequestedName(options.name);

      await startClient({
        basicAuth,
        qr: Boolean(options.qr),
        subdomain,
        target: String(target),
        server,
        token,
      });
    });

  return command;
}

async function resolveBasicAuthOption(value: unknown): Promise<{ username: string; password: string } | undefined> {
  if (value === undefined || value === false) {
    return undefined;
  }

  if (typeof value === "string" && value.length > 0) {
    return parseBasicAuth(value);
  }

  const username = await text({
    message: "Basic Auth username",
    placeholder: "username",
    validate(input) {
      if (typeof input !== "string" || input.trim().length === 0) {
        return "Username is required";
      }
    },
  });

  if (isCancel(username)) {
    throw new Error("Cancelled");
  }

  const pass = await password({
    message: "Basic Auth password",
    validate(input) {
      if (typeof input !== "string" || input.length === 0) {
        return "Password is required";
      }
    },
  });

  if (isCancel(pass)) {
    throw new Error("Cancelled");
  }

  return {
    username: username.trim(),
    password: pass,
  };
}

function parseBasicAuth(value: string): { username: string; password: string } {
  const separatorIndex = value.indexOf(":");

  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    throw new Error("--auth must be in the format username:password");
  }

  return {
    username: value.slice(0, separatorIndex),
    password: value.slice(separatorIndex + 1),
  };
}

function resolveRequestedName(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const requested = value.trim().toLowerCase();
  if (!requested) {
    return undefined;
  }

  const validationError = validateRequestedSubdomain(requested);
  if (validationError) {
    throw new Error(validationError);
  }

  return requested;
}
