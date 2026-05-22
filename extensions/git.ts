/**
 * Git data layer — fetches, parses, and enriches changed-file information.
 * Zero UI dependencies.
 */

import { execSync } from "child_process";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChangedFile {
  displayPath: string; // relative path for display
  absolutePath: string; // absolute path for clipboard/@mention
  added: number;
  removed: number;
  status: string; // M, A, D, R, etc.
}

interface NameStatusEntry {
  status: string;
  displayPath: string;
  absolutePath: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_SORT_ORDER: Record<string, number> = { D: 0, R: 1, M: 2, A: 3, T: 4 };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Fetch all changed files from the current git repo. */
export function fetchChangedFiles(cwd: string): ChangedFile[] {
  try {
    const raw = parseNameStatus(execNameStatus(cwd), cwd);
    const unique = deduplicateByNameStatus(raw);
    const enriched = enrichWithNumStats(unique, cwd);
    return sortByStatus(enriched);
  } catch {
    return [
      {
        displayPath: "(not a git repository)",
        absolutePath: "",
        added: 0,
        removed: 0,
        status: "?",
      },
    ];
  }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function execNameStatus(cwd: string): string {
  return execSync(
    `git diff --name-status HEAD 2>/dev/null; git diff --name-status --cached 2>/dev/null`,
    { cwd, encoding: "utf-8" },
  );
}

/** Parse git diff --name-status output (STATUS\tPATH lines). */
function parseNameStatus(output: string, cwd: string): NameStatusEntry[] {
  return output
    .trim()
    .split("\n")
    .map((line) => parseNameStatusLine(line, cwd))
    .filter((e): e is NameStatusEntry => e !== null);
}

function parseNameStatusLine(line: string, cwd: string): NameStatusEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const tabIdx = trimmed.indexOf("\t");
  if (tabIdx === -1) return null;

  const status = trimmed.slice(0, tabIdx).trim();
  const rawPath = trimmed.slice(tabIdx + 1).trim();
  if (!rawPath) return null;

  return {
    status,
    displayPath: rawPath,
    absolutePath: resolve(cwd, rawPath),
  };
}

/**
 * Deduplicate entries so only the last occurrence of each absolute path is kept
 * (handles files appearing in both working tree and staged).
 */
function deduplicateByNameStatus(entries: NameStatusEntry[]): NameStatusEntry[] {
  const map = new Map<string, NameStatusEntry>();
  for (const entry of entries) {
    map.set(entry.absolutePath, entry);
  }
  return [...map.values()];
}

// ---------------------------------------------------------------------------
// Diff stats
// ---------------------------------------------------------------------------

/**
 * Compute per-file diff stats from git --numstat.
 * Checks staged changes first, then working tree.
 */
function enrichWithNumStats(entries: NameStatusEntry[], cwd: string): ChangedFile[] {
  return entries.map((entry) => ({
    ...entry,
    added: 0,
    removed: 0,
    ...getDiffStats(entry.absolutePath, cwd),
  }));
}

function getDiffStats(
  absolutePath: string,
  cwd: string,
): { added: number; removed: number } {
  try {
    let stats = execSync(
      `git diff --cached --numstat -- "${absolutePath}" 2>/dev/null`,
      { cwd, encoding: "utf-8" },
    ).trim();

    if (!stats) {
      stats = execSync(
        `git diff --numstat HEAD -- "${absolutePath}" 2>/dev/null`,
        { cwd, encoding: "utf-8" },
      ).trim();
    }

    if (stats) {
      const [rawAdded, rawRemoved] = stats.split(/\s+/);
      return {
        added: parseNumStatField(rawAdded),
        removed: parseNumStatField(rawRemoved),
      };
    }
  } catch {
    // binary or missing — keep 0/0
  }
  return { added: 0, removed: 0 };
}

function parseNumStatField(value: string): number {
  if (value === "-") return 0; // binary
  const n = parseInt(value, 10);
  return isNaN(n) ? 0 : n;
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

/** Sort: deletions → renames → modifications → additions. */
function sortByStatus(files: ChangedFile[]): ChangedFile[] {
  return [...files].sort(
    (a, b) => (STATUS_SORT_ORDER[a.status] ?? 99) - (STATUS_SORT_ORDER[b.status] ?? 99),
  );
}
