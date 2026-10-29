import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { readNight } from '../src/digest/read.js';
import type { DigestNight } from '../src/digest/types.js';

let runsDir = '';
const app = () =>
  createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir });

const line = (o: Record<string, unknown>) => JSON.stringify(o);
const NORMAL = [
  line({ at: '2026-10-28T23:00:06+01:00', job: 'lane/sync', status: 'ok', owner: 'rook' }),
  line({ at: '2026-10-29T01:30:00+01:00', job: 'fixtures/refresh', status: 'retry', owner: 'rook', error: 'upstream 503' }),
  line({ at: '2026-10-29T01:31:00+01:00', job: 'fixtures/refresh', status: 'retry', owner: 'rook', error: 'upstream 503' }),
  line({ at: '2026-10-29T01:33:00+01:00', job: 'fixtures/refresh', status: 'retry', owner: 'rook', error: 'upstream 503' }),
  line({ at: '2026-10-29T01:37:00+01:00', job: 'fixtures/refresh', status: 'ok', owner: 'rook' }),
  line({ at: '2026-10-29T04:00:01+01:00', job: 'notes/backup', status: 'fail', owner: 'lane-07', error: 'quota exceeded' }),
  line({ at: '2026-10-29T05:41:09+01:00', job: 'digest/render', status: 'ok', owner: null }),
];
const JOBS = ['digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup'];

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  writeFileSync(join(runsDir, '2026-10-28.jsonl'), NORMAL.join('\n') + '\n');
  writeFileSync(join(runsDir, '2026-01-01.jsonl'), '');
  writeFileSync(join(runsDir, '2026-01-02.jsonl'), [NORMAL[0], '{not json', NORMAL[5]].join('\n') + '\n');
  writeFileSync(join(runsDir, '2026-01-03.jsonl'), ['garbage', '{"at":1}', NORMAL[0]].join('\n') + '\n');
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

// The <tr> element that mentions this job.
function rowFor(html: string, job: string): string {
  const tr = html.split('<tr').find((s) => s.includes(job));
  if (tr === undefined) throw new Error(`no row for ${job}`);
  return '<tr' + tr;
}

describe('GET /digest/:night', () => {
  it('renders a normal night: lane banner, one row per job sorted, gaps as dashes, warn rows', async () => {
    process.env.LANE_MARKER = 'TEST-MARKER';
    const res = await app().request('/digest/2026-10-28');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('TEST-MARKER');
    const positions = JOBS.map((j) => html.indexOf(j));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(rowFor(html, 'digest/render')).toContain('—');
    expect(rowFor(html, 'digest/render')).not.toContain('warn');
    expect(rowFor(html, 'lane/sync')).toContain('—');
    expect(rowFor(html, 'fixtures/refresh')).toMatch(/class="[^"]*warn/);
    expect(rowFor(html, 'notes/backup')).toMatch(/class="[^"]*warn/);
    expect(rowFor(html, 'lane/sync')).not.toMatch(/class="[^"]*warn/);
    expect(html).not.toContain('did not parse');
    expect(html).not.toContain('nothing ran');
  });

  it('404 for a night with no file', async () => {
    expect((await app().request('/digest/2030-01-01')).status).toBe(404);
  });

  it('empty night says nothing ran', async () => {
    const res = await app().request('/digest/2026-01-01');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('bad line: shows the count and still lists the other rows', async () => {
    const res = await app().request('/digest/2026-01-02');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('1 line did not parse');
    expect(html).toContain('lane/sync');
    expect(html).toContain('notes/backup');
  });

  it('several bad lines use the plural', async () => {
    const html = await (await app().request('/digest/2026-01-03')).text();
    expect(html).toContain('2 lines did not parse');
  });
});

describe('GET /api/digest/:night', () => {
  it('returns exactly what readNight returns', async () => {
    const res = await app().request('/api/digest/2026-10-28');
    expect(res.status).toBe(200);
    const body = (await res.json()) as DigestNight;
    expect(body).toEqual(readNight(runsDir, '2026-10-28'));
    expect(body.night).toBe('2026-10-28');
    expect(body.rows.map((r) => r.job)).toEqual(JOBS);
    expect(body.badLines).toBe(0);
  });

  it('404 with a JSON error for a night with no file', async () => {
    const res = await app().request('/api/digest/2030-01-01');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no run log', night: '2030-01-01' });
  });

  it('empty night has no rows', async () => {
    const res = await app().request('/api/digest/2026-01-01');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ night: '2026-01-01', rows: [], badLines: 0 });
  });

  it('bad line is counted and the other rows stay', async () => {
    const res = await app().request('/api/digest/2026-01-02');
    const body = (await res.json()) as DigestNight;
    expect(res.status).toBe(200);
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(['lane/sync', 'notes/backup']);
  });
});

describe('page and JSON agree', () => {
  it('same jobs in the same order', async () => {
    const api = (await (await app().request('/api/digest/2026-10-28')).json()) as DigestNight;
    const html = await (await app().request('/digest/2026-10-28')).text();
    const order = api.rows.map((r) => html.indexOf(r.job));
    expect(order.every((p) => p >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
