import { Command } from "commander";

const SUPPORTED_SHELLS = ["bash", "zsh", "fish"] as const;

type SupportedShell = (typeof SUPPORTED_SHELLS)[number];

export function completionCommand(): Command {
  const command = new Command("completion");

  command
    .description("Generate shell completion script")
    .argument("<shell>", "Shell to generate completions for: bash, zsh, or fish")
    .action((shell: string) => {
      if (!isSupportedShell(shell)) {
        throw new Error("Unsupported shell. Expected one of: bash, zsh, fish");
      }

      process.stdout.write(completionScript(shell));
    });

  return command;
}

function isSupportedShell(shell: string): shell is SupportedShell {
  return SUPPORTED_SHELLS.includes(shell as SupportedShell);
}

function completionScript(shell: SupportedShell): string {
  switch (shell) {
    case "bash":
      return bashCompletionScript();
    case "zsh":
      return zshCompletionScript();
    case "fish":
      return fishCompletionScript();
  }
}

function bashCompletionScript(): string {
  return [
    "# bash completion for w-share",
    "_w_share_completion() {",
    "  local cur prev command commands options",
    "",
    "  COMPREPLY=()",
    '  cur="${COMP_WORDS[COMP_CWORD]}"',
    '  prev="${COMP_WORDS[COMP_CWORD-1]}"',
    '  command="${COMP_WORDS[1]}"',
    '  commands="version serve http share config update completion help"',
    "",
    '  case "$prev" in',
    "    --auth|--domain|--name|--port|--server)",
    "      return 0",
    "      ;;",
    "  esac",
    "",
    '  case "$command" in',
    "    serve)",
    '      options="--domain --port --help"',
    "      ;;",
    "    http|share)",
    '      options="--auth --name --qr --server --help"',
    "      ;;",
    "    completion)",
    '      options="bash zsh fish --help"',
    "      ;;",
    "    *)",
    '      options="$commands --help"',
    "      ;;",
    "  esac",
    "",
    '  COMPREPLY=( $(compgen -W "$options" -- "$cur") )',
    "}",
    "",
    "complete -F _w_share_completion w-share",
    "",
  ].join("\n");
}

function zshCompletionScript(): string {
  return String.raw`#compdef w-share

_w_share() {
  local -a commands

  commands=(
    'version:Show the installed w-share version'
    'serve:Start the public tunnel server'
    'http:Expose a local HTTP target'
    'share:Expose a local HTTP target'
    'config:Configure the saved client server URL and token'
    'update:Update w-share using the release installer'
    'completion:Generate shell completion script'
    'help:Display help for command'
  )

  case $words[2] in
    serve)
      _arguments \
        '--domain[Public wildcard domain]:domain:' \
        '--port[Local listen port]:port:' \
        '--help[Display help]'
      ;;
    http|share)
      _arguments \
        '--auth[Protect the public URL with Basic Auth]:credentials:' \
        '--name[Request a custom public name]:name:' \
        '--qr[Show a terminal QR code]' \
        '--server[Server URL]:server:' \
        '--help[Display help]' \
        '*:target:'
      ;;
    completion)
      _arguments '1:shell:(bash zsh fish)' '--help[Display help]'
      ;;
    *)
      _arguments '1:command:->command' '--help[Display help]'
      if [[ $state == command ]]; then
        _describe 'command' commands
      fi
      ;;
  esac
}

_w_share "$@"
`;
}

function fishCompletionScript(): string {
  return String.raw`# fish completion for w-share
complete -c w-share -f -n '__fish_use_subcommand' -a 'version' -d 'Show the installed w-share version'
complete -c w-share -f -n '__fish_use_subcommand' -a 'serve' -d 'Start the public tunnel server'
complete -c w-share -f -n '__fish_use_subcommand' -a 'http' -d 'Expose a local HTTP target'
complete -c w-share -f -n '__fish_use_subcommand' -a 'share' -d 'Expose a local HTTP target'
complete -c w-share -f -n '__fish_use_subcommand' -a 'config' -d 'Configure the saved client server URL and token'
complete -c w-share -f -n '__fish_use_subcommand' -a 'update' -d 'Update w-share using the release installer'
complete -c w-share -f -n '__fish_use_subcommand' -a 'completion' -d 'Generate shell completion script'

complete -c w-share -n '__fish_seen_subcommand_from serve' -l domain -r -d 'Public wildcard domain'
complete -c w-share -n '__fish_seen_subcommand_from serve' -l port -r -d 'Local listen port'

complete -c w-share -n '__fish_seen_subcommand_from http share' -l auth -r -d 'Protect the public URL with Basic Auth'
complete -c w-share -n '__fish_seen_subcommand_from http share' -l name -r -d 'Request a custom public name'
complete -c w-share -n '__fish_seen_subcommand_from http share' -l qr -d 'Show a terminal QR code'
complete -c w-share -n '__fish_seen_subcommand_from http share' -l server -r -d 'Server URL'

complete -c w-share -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish'
`;
}
