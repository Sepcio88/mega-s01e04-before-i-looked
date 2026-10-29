// Plan morning-digest § 1. The contract every part of § 2 builds against.

export type RunStatus = 'ok' | 'retry' | 'fail';

// One line of runs/<night>.jsonl, after parsing.
export type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

// One row per job. Times keep the offset from the log (styleguide).
export type DigestRow = {
  job: string;
  owner: string | null; // null renders as `—`
  runs: number; // lines for this job
  retries: number; // lines with status `retry`
  lastStatus: RunStatus;
  lastError: string | null; // error of the latest line that had one
  first: string; // `at` of the first line
  last: string; // `at` of the last line
};

export type DigestNight = {
  night: string; // YYYY-MM-DD
  rows: DigestRow[]; // sorted by job
  badLines: number; // lines that did not parse, counted, never thrown
};

// Reads runs/<night>.jsonl. Returns null when the night has no file (the routes answer 404);
// an empty file gives a night with no rows.
export type ReadNight = (runsDir: string, night: string) => DigestNight | null;
