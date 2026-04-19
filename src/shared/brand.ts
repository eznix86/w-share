import { intro } from "@clack/prompts";
import chalk from "chalk";

const INTRO_GRADIENTS = [
  [213, 177, 141, 105],
  [214, 208, 202, 196],
  [51, 50, 49, 48],
  [227, 221, 215, 209],
] as const;

const BRAND_LINES = [
  "             ",
  "    ██     ██",
  "    ██     ██",
  "    ██  █  ██  A self-hosted gateway to tunnel local dev to the internet.",
  "    ██ ███ ██",
  "     ███ ███   v{version}",
  "             ",
];

type RenderBrandIntroOptions = {
  version?: string;
};

function pickStop(gradient: readonly number[], index: number, total: number) {
  const t = total <= 1 ? 0 : index / (total - 1);
  return gradient[Math.round(t * (gradient.length - 1))] ?? gradient[0] ?? 255;
}

export function renderBrandIntro(options?: RenderBrandIntroOptions): void {
  const lines = BRAND_LINES
    .filter((line) => options?.version || !line.includes("{version}"))
    .map((line) => line.replace("{version}", options?.version ?? ""));
  const gradient = INTRO_GRADIENTS[Math.floor(Math.random() * INTRO_GRADIENTS.length)] ?? INTRO_GRADIENTS[0];

  intro("");

  lines.forEach((line, i) => {
    const color = chalk.ansi256(pickStop(gradient, i, lines.length));
    const versionPrefix = options?.version ? `v${options.version}` : undefined;

    if (versionPrefix && line.includes(versionPrefix)) {
      const [prefix, suffix = ""] = line.split(versionPrefix);
      console.log(`${color(prefix)}${chalk.gray(versionPrefix)}${color(suffix)}`);
      return;
    }

    console.log(color(line));
  });
}
