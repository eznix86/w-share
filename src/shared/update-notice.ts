import semver from "semver";
import { log } from "@clack/prompts";
import chalk from "chalk";
import { leadingVersionPrefixPattern } from "./regexp.ts";

const RELEASES_LATEST_URL = "https://github.com/eznix86/w-share/releases/latest";

function normalizeVersion(value: string): string | null {
  return semver.valid(value.replace(leadingVersionPrefixPattern, ""));
}

function shouldShowUpdate(currentVersion: string, latestVersion: string): boolean {
  const current = normalizeVersion(currentVersion);
  const latest = normalizeVersion(latestVersion);

  if (!current || !latest) {
    return false;
  }

  const currentPrerelease = semver.prerelease(current);
  const latestPrerelease = semver.prerelease(latest);

  if (!currentPrerelease && latestPrerelease) {
    return false;
  }

  return semver.gt(latest, current);
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const response = await fetch(RELEASES_LATEST_URL, { redirect: "follow" });
    const latestUrl = response.url;
    const tag = latestUrl.split("/").pop();
    return tag && tag.startsWith("v") ? tag : null;
  } catch {
    return null;
  }
}

export async function renderUpdateNotice(currentVersion: string): Promise<void> {
  const latestVersion = await fetchLatestVersion();

  if (!latestVersion || !shouldShowUpdate(currentVersion, latestVersion)) {
    return;
  }

  log.warn(`Update available: ${latestVersion}. Run ${chalk.cyan("w-share update")} to update it.`);
}
