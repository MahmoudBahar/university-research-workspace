export interface ParsedArgs {
  command: string[];
  flags: Record<string, string | boolean | string[]>;
  positionals: string[];
  raw: string[];
}

/**
 * Minimal, dependency-free argument parser.
 *
 * Values are only ever treated as data: nothing parsed here is interpolated
 * into a shell command anywhere in the codebase.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const command: string[] = [];
  const positionals: string[] = [];
  const flags: Record<string, string | boolean | string[]> = {};
  let seenFlag = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] as string;
    if (token === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (token.startsWith('--')) {
      seenFlag = true;
      const body = token.slice(2);
      const eq = body.indexOf('=');
      if (eq !== -1) {
        addFlag(flags, body.slice(0, eq), body.slice(eq + 1));
        continue;
      }
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        addFlag(flags, body, true);
      } else {
        addFlag(flags, body, next);
        i += 1;
      }
      continue;
    }
    if (!seenFlag && command.length < 2 && /^[a-z][a-z0-9-]*$/.test(token)) {
      command.push(token);
    } else {
      positionals.push(token);
    }
  }
  return { command, flags, positionals, raw: argv };
}

function addFlag(flags: Record<string, string | boolean | string[]>, key: string, value: string | boolean): void {
  const normalised = key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  const existing = flags[normalised];
  if (existing === undefined) {
    flags[normalised] = value;
    return;
  }
  const list = Array.isArray(existing) ? existing : [String(existing)];
  flags[normalised] = [...list, String(value)];
}

export function flagString(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  if (value === undefined || value === true) return undefined;
  return Array.isArray(value) ? value[0] : String(value);
}

export function flagList(args: ParsedArgs, name: string): string[] {
  const value = args.flags[name];
  if (value === undefined || value === true) return [];
  return Array.isArray(value) ? value : [String(value)];
}

export function flagBool(args: ParsedArgs, name: string): boolean {
  const value = args.flags[name];
  return value === true || value === 'true' || value === '1';
}

export function flagNumber(args: ParsedArgs, name: string): number | undefined {
  const value = flagString(args, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function requireFlag(args: ParsedArgs, name: string): string {
  const value = flagString(args, name);
  if (value === undefined || value === '') {
    throw new Error(`Missing required option --${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
  }
  return value;
}
