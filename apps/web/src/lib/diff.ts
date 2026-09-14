export type DiffLine = { type: 'same' | 'add' | 'del'; text: string };

const MAX_CELLS = 4_000_000;

/**
 * Line diff. Longest-common-subsequence for ordinary sizes; a common
 * prefix/suffix fallback when the product of the line counts would be too large.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.replace(/\r\n/g, '\n').split('\n');
  const b = after.replace(/\r\n/g, '\n').split('\n');
  if (a.length * b.length > MAX_CELLS) return linearDiff(a, b);

  const n = a.length;
  const m = b.length;
  const table: Uint32Array[] = [];
  for (let i = 0; i <= n; i += 1) table.push(new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    const rowNext = table[i + 1] as Uint32Array;
    const row = table[i] as Uint32Array;
    for (let j = m - 1; j >= 0; j -= 1) {
      row[j] = a[i] === b[j] ? (rowNext[j + 1] as number) + 1 : Math.max(rowNext[j] as number, row[j + 1] as number);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i] as string });
      i += 1;
      j += 1;
    } else if (((table[i + 1] as Uint32Array)[j] as number) >= ((table[i] as Uint32Array)[j + 1] as number)) {
      out.push({ type: 'del', text: a[i] as string });
      i += 1;
    } else {
      out.push({ type: 'add', text: b[j] as string });
      j += 1;
    }
  }
  while (i < n) out.push({ type: 'del', text: a[i++] as string });
  while (j < m) out.push({ type: 'add', text: b[j++] as string });
  return out;
}

function linearDiff(a: string[], b: string[]): DiffLine[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const out: DiffLine[] = [];
  for (let k = 0; k < start; k += 1) out.push({ type: 'same', text: a[k] as string });
  for (let k = start; k < endA; k += 1) out.push({ type: 'del', text: a[k] as string });
  for (let k = start; k < endB; k += 1) out.push({ type: 'add', text: b[k] as string });
  for (let k = endA; k < a.length; k += 1) out.push({ type: 'same', text: a[k] as string });
  return out;
}
