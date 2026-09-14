export interface OutputOptions {
  json: boolean;
}

export function emit(options: OutputOptions, humanLines: string[] | string, data: unknown): void {
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ok: true, data }, null, 2)}\n`);
    return;
  }
  const text = Array.isArray(humanLines) ? humanLines.join('\n') : humanLines;
  process.stdout.write(`${text}\n`);
}

export function fail(options: OutputOptions, error: unknown): never {
  const typed = error as { code?: string; message?: string; detail?: unknown } | undefined;
  const payload =
    typed && typeof typed === 'object' && typeof typed.code === 'string'
      ? { error: typed.code, message: String(typed.message ?? ''), detail: typed.detail ?? {} }
      : { error: 'error', message: error instanceof Error ? error.message : String(error), detail: {} };
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ok: false, ...payload }, null, 2)}\n`);
  } else {
    process.stderr.write(`Error (${payload.error}): ${payload.message}\n`);
    if (payload.detail && Object.keys(payload.detail as object).length > 0) {
      process.stderr.write(`${JSON.stringify(payload.detail, null, 2)}\n`);
    }
  }
  process.exit(1);
}

export function table(rows: Record<string, unknown>[], columns: string[]): string {
  if (rows.length === 0) return '(none)';
  const widths = columns.map((column) =>
    Math.max(column.length, ...rows.map((row) => String(row[column] ?? '').length)),
  );
  const header = columns.map((column, i) => column.padEnd(widths[i] as number)).join('  ');
  const divider = widths.map((width) => '-'.repeat(width)).join('  ');
  const body = rows
    .map((row) => columns.map((column, i) => String(row[column] ?? '').padEnd(widths[i] as number)).join('  '))
    .join('\n');
  return `${header}\n${divider}\n${body}`;
}

export function truncate(value: unknown, max = 60): string {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
