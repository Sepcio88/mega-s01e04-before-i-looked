import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLine } from './read.js';
import type { RunStatus } from './types.js';

export type NightCounts = Record<RunStatus, number> & { bad: number };

// Counts run LINES by status (not jobs) for one night. null when the file can't be read.
export function countNight(runsDir: string, night: string): NightCounts | null {
  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch {
    return null;
  }
  const c: NightCounts = { ok: 0, retry: 0, fail: 0, bad: 0 };
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === '') continue;
    const l = parseLine(raw);
    if (l) c[l.status] += 1;
    else c.bad += 1;
  }
  return c;
}
