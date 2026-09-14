#!/usr/bin/env node
import { parseArgs, flagBool } from './args.js';
import { createContext, type CommandSpec } from './context.js';
import { fail } from './output.js';
import { workspaceCommands } from './commands/workspace.js';
import { researchCommands } from './commands/research.js';
import { outreachCommands } from './commands/outreach.js';
import { applicantCommands } from './commands/applicant.js';

const COMMANDS: Record<string, CommandSpec> = {
  ...workspaceCommands,
  ...researchCommands,
  ...outreachCommands,
  ...applicantCommands,
};

function usage(): string {
  const groups = new Map<string, { name: string; spec: CommandSpec }[]>();
  for (const [name, spec] of Object.entries(COMMANDS)) {
    const group = name.includes(' ') ? (name.split(' ')[0] as string) : 'workspace';
    groups.set(group, [...(groups.get(group) ?? []), { name, spec }]);
  }
  const lines = [
    'University Research Workspace CLI',
    '',
    'Usage: npm run research -- <command> [options]',
    '',
    'Global options:',
    '  --json            Emit structured JSON and use exit codes for errors',
    '  --root <dir>      Workspace root (defaults to the nearest project directory)',
    '  --driver <name>   Force better-sqlite3 or node:sqlite',
    '',
  ];
  for (const [group, entries] of [...groups.entries()].sort()) {
    lines.push(`${group}:`);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`  ${entry.name.padEnd(22)} ${entry.spec.summary}`);
    }
    lines.push('');
  }
  lines.push('Run a command with --help to see its options.');
  return lines.join('\n');
}

function resolveCommand(command: string[]): { key: string; spec: CommandSpec } | undefined {
  for (const length of [2, 1]) {
    const key = command.slice(0, length).join(' ');
    const spec = COMMANDS[key];
    if (spec) return { key, spec };
  }
  return undefined;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const out = { json: flagBool(args, 'json') };

  if (args.command.length === 0 || flagBool(args, 'help') || args.command[0] === 'help') {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const resolved = resolveCommand(args.command);
  if (!resolved) {
    fail(out, new Error(`Unknown command: ${args.command.join(' ')}\n\n${usage()}`));
    return;
  }
  if (flagBool(args, 'help')) {
    process.stdout.write(`${resolved.key}: ${resolved.spec.summary}\n\nUsage: npm run research -- ${resolved.spec.usage}\n`);
    return;
  }

  const ctx = createContext(args, out);
  try {
    await resolved.spec.handler(ctx);
  } catch (error) {
    ctx.close();
    fail(out, error);
    return;
  }
  ctx.close();
}

main().catch((error) => {
  process.stderr.write(`Unexpected failure: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
