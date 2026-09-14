export function nowIso(): string {
  return new Date().toISOString();
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isoPlusSeconds(seconds: number, from: Date = new Date()): string {
  return new Date(from.getTime() + seconds * 1000).toISOString();
}

export function isPast(iso: string | null | undefined, now: Date = new Date()): boolean {
  if (!iso) return false;
  return new Date(iso).getTime() <= now.getTime();
}

export function daysBetween(aIso: string, bIso: string): number {
  return Math.abs(new Date(aIso).getTime() - new Date(bIso).getTime()) / 86_400_000;
}
