import { openWorkspace, type Workspace } from '@urw/core';
import type { ParsedArgs } from './args.js';
import type { OutputOptions } from './output.js';
import { flagString } from './args.js';

export interface CommandContext {
  args: ParsedArgs;
  out: OutputOptions;
  workspace: () => Promise<Workspace>;
  close: () => void;
}

export interface CommandSpec {
  summary: string;
  usage: string;
  handler: (ctx: CommandContext) => Promise<void>;
}

export function createContext(args: ParsedArgs, out: OutputOptions): CommandContext {
  let cached: Workspace | undefined;
  return {
    args,
    out,
    workspace: async () => {
      if (!cached) {
        cached = await openWorkspace({
          root: flagString(args, 'root'),
          driver: flagString(args, 'driver') as 'better-sqlite3' | 'node:sqlite' | undefined,
        });
      }
      return cached;
    },
    close: () => {
      cached?.close();
      cached = undefined;
    },
  };
}
