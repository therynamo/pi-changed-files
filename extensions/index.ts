/**
 * Changed Files Overlay Extension
 *
 * Shows a floating overlay of git-tracked changed files with diff counts (+/-).
 * Navigate with j/k (or ↑/↓), Enter on a file to copy its path and insert
 * it into the editor with @ file: syntax. Escape dismisses.
 *
 * Toggle via Ctrl+Space shortcut or /changed-files command.
 */

import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { execSync } from "child_process";
import { resolve } from "path";
import { copyToClipboard } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChangedFile {
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

interface OverlayLayout {
  innerW: number;
  prefixW: number;
  statusColW: number;
  pathColW: number;
  plusColW: number;
  minusColW: number;
}

interface OverlayState {
  files: ChangedFile[];
  selected: number;
  width: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OVERLAY_OPTIONS = {
  overlay: true,
  overlayOptions: { width: "60%", minWidth: 60, maxWidth: 120 } as const,
};

const STATUS_SORT_ORDER: Record<string, number> = { D: 0, R: 1, M: 2, A: 3, T: 4 };

const STATUS_COLORS: Record<string, "error" | "accent" | "warning" | "success"> = {
  D: "error",
  R: "accent",
  M: "warning",
  A: "success",
};

// ---------------------------------------------------------------------------
// Git data layer (impure — isolated here)
// ---------------------------------------------------------------------------

function fetchChangedFiles(cwd: string): ChangedFile[] {
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

function getDiffStats(absolutePath: string, cwd: string): { added: number; removed: number } {
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

/** Sort: deletions → renames → modifications → additions. */
function sortByStatus(files: ChangedFile[]): ChangedFile[] {
  return [...files].sort(
    (a, b) => (STATUS_SORT_ORDER[a.status] ?? 99) - (STATUS_SORT_ORDER[b.status] ?? 99),
  );
}

// ---------------------------------------------------------------------------
// Pure render functions
// ---------------------------------------------------------------------------

function computeLayout(files: ChangedFile[], innerW: number): OverlayLayout {
  const prefixW = 2; // "▸ " or "  "
  const gap = 2;
  const spaceBeforeMinus = 1;

  const maxStatusW = Math.max(3, ...files.map((f) => visibleWidth(f.status)));
  const maxPlusW = Math.max(2, ...files.map((f) => visibleWidth(f.added > 0 ? `+${f.added}` : "-")));
  const maxMinusW = Math.max(2, ...files.map((f) => visibleWidth(f.removed > 0 ? `-${f.removed}` : "-")));

  const statusColW = maxStatusW + 1; // + trailing space
  const plusColW = maxPlusW;
  const minusColW = maxMinusW;

  const pathColW = Math.max(
    10,
    innerW - prefixW - statusColW - gap - gap - plusColW - spaceBeforeMinus - minusColW,
  );

  return { innerW, prefixW, statusColW, pathColW, plusColW, minusColW };
}

function renderHeader(files: ChangedFile[], innerW: number, theme: Theme): string[] {
  const pad = (s: string) => s + " ".repeat(Math.max(0, innerW - visibleWidth(s)));
  const border = (c: string) => theme.fg("border", c);

  const fileCount = files.length;
  const title = theme.fg("accent", ` Git Changes (${fileCount} file${fileCount !== 1 ? "s" : ""}) `);
  const titleW = visibleWidth(title);
  const fillW = Math.max(0, innerW - titleW);
  const leftFill = "─".repeat(Math.floor(fillW / 2));
  const rightFill = "─".repeat(fillW - leftFill.length);

  const top = `${border("╭")}${theme.fg("border", leftFill)}${title}${theme.fg("border", rightFill)}${border("╮")}`;

  // Column headers
  const colHeader = `${theme.fg("dim", " Status")}  ${theme.fg("dim", "Path")}                    ${theme.fg("dim", "+  -")}`;
  const header = `${border("│")}${pad(colHeader)}${border("│")}`;

  // Separator
  const sep = `${border("├")}${theme.fg("border", "─".repeat(innerW))}${border("┤")}`;

  return [top, header, sep];
}

function renderRows(state: OverlayState, layout: OverlayLayout, theme: Theme): string[] {
  const { files, selected, width } = state;
  const { innerW, statusColW, pathColW, plusColW } = layout;
  const pad = (s: string) => s + " ".repeat(Math.max(0, innerW - visibleWidth(s)));
  const border = (c: string) => theme.fg("border", c);

  return files.map((file, i) => {
    const isSelected = i === selected;

    const statusColor = STATUS_COLORS[file.status] ?? ("dim" as const);
    const statusText = theme.fg(statusColor, file.status);

    const plusText = file.added > 0 ? theme.fg("success", `+${file.added}`) : theme.fg("dim", "-");
    const minusText = file.removed > 0 ? theme.fg("error", `-${file.removed}`) : theme.fg("dim", "-");

    const pathDisplay = truncateToWidth(file.displayPath, pathColW, "...", true);

    const prefix = isSelected ? theme.fg("accent", "▸ ") : "  ";
    const statusPad = " ".repeat(statusColW - visibleWidth(statusText));
    const pathPad = " ".repeat(Math.max(0, pathColW - visibleWidth(pathDisplay)));
    const plusPad = " ".repeat(plusColW - visibleWidth(plusText));

    const content = `${prefix}${statusText}${statusPad}  ${pathDisplay}${pathPad}  ${plusText}${plusPad} ${minusText}`;

    if (isSelected) {
      return `${border("│")}${theme.bg("selectedBg", pad(content))}${border("│")}`;
    }
    return `${border("│")}${pad(content)}${border("│")}`;
  });
}

function renderPadding(files: ChangedFile[], currentLines: number, innerW: number, theme: Theme): string[] {
  const border = (c: string) => theme.fg("border", c);
  const pad = (s: string) => s + " ".repeat(Math.max(0, innerW - visibleWidth(s)));
  const minRows = 4 + Math.min(files.length, 10);
  const needed = minRows + 4 - currentLines; // +4 for header + footer

  const lines: string[] = [];
  for (let i = 0; i < Math.max(0, needed); i++) {
    lines.push(`${border("│")}${pad("")}${border("│")}`);
  }
  return lines;
}

function renderFooter(files: ChangedFile[], innerW: number, theme: Theme): string[] {
  const border = (c: string) => theme.fg("border", c);
  const pad = (s: string) => s + " ".repeat(Math.max(0, innerW - visibleWidth(s)));

  const sep = `${border("├")}${theme.fg("border", "─".repeat(innerW))}${border("┤")}`;

  const message =
    files.length > 0
      ? "↑↓/j/k navigate • Enter select • Esc/Ctrl+Space dismiss"
      : "Press any key to close";
  const footer = `${border("│")}${pad(` ${theme.fg("dim", message)}`)}${border("│")}`;

  const bottom = `${border("╰")}${theme.fg("border", "─".repeat(innerW))}${border("╯")}`;

  return [sep, footer, bottom];
}

/** Render the complete overlay from immutable state. */
function renderOverlay(state: OverlayState, theme: Theme): string[] {
  const { files, width } = state;
  const innerW = Math.max(1, width - 2);
  const layout = computeLayout(files, innerW);

  const header = renderHeader(files, innerW, theme);
  const rows = renderRows(state, layout, theme);
  const padding = renderPadding(files, header.length + rows.length, innerW, theme);
  const footer = renderFooter(files, innerW, theme);

  return [...header, ...rows, ...padding, ...footer];
}

// ---------------------------------------------------------------------------
// Overlay component (thin state container + input handling)
// ---------------------------------------------------------------------------

class ChangedFilesOverlay {
  readonly focused = false;

  private files: ChangedFile[];
  private selected = 0;

  private cachedWidth?: number;
  private cachedSelected?: number;
  private cachedLines?: string[];

  constructor(
    private cwd: string,
    private tui: import("@earendil-works/pi-tui").TUI,
    private theme: Theme,
    private done: (result: ChangedFile | undefined) => void,
  ) {
    this.files = fetchChangedFiles(cwd);
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+space")) {
      this.done(undefined);
      return;
    }

    if (matchesKey(data, "return")) {
      const file = this.files[this.selected];
      if (!file || isNotARepo(file)) {
        this.done(undefined);
      } else {
        this.done(file);
      }
      return;
    }

    if (matchesKey(data, "up") || matchesKey(data, "k")) {
      this.selected = Math.max(0, this.selected - 1);
      this.invalidate();
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, "down") || matchesKey(data, "j")) {
      this.selected = Math.min(this.files.length - 1, this.selected + 1);
      this.invalidate();
      this.tui.requestRender();
      return;
    }
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width && this.cachedSelected === this.selected) {
      return this.cachedLines;
    }

    const state: OverlayState = {
      files: this.files,
      selected: this.selected,
      width,
    };

    this.cachedLines = renderOverlay(state, this.theme);
    this.cachedWidth = width;
    this.cachedSelected = this.selected;
    return this.cachedLines;
  }

  invalidate(): void {
    this.cachedLines = undefined;
    this.cachedWidth = undefined;
    this.cachedSelected = undefined;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNotARepo(file: ChangedFile): boolean {
  return file.displayPath.startsWith("(not a");
}

/** Shared post-selection: copy path, notify, insert @mention into editor. */
async function handleFileSelected(file: ChangedFile, ctx: ExtensionCommandContext): Promise<void> {
  await copyToClipboard(file.absolutePath);
  ctx.ui.notify(`Copied: ${file.absolutePath}`, "success");
  ctx.ui.setEditorText(`@${file.absolutePath}`);
}

// ---------------------------------------------------------------------------
// Extension registration
// ---------------------------------------------------------------------------

// State for shortcut-based toggle
let overlayHandle: import("@earendil-works/pi-coding-agent").OverlayHandle | null = null;

function openOverlay(
  ctx: ExtensionCommandContext,
  options?: { onHandle?: (h: import("@earendil-works/pi-coding-agent").OverlayHandle) => void },
): Promise<ChangedFile | undefined> {
  return ctx.ui.custom<ChangedFile | undefined>(
    (tui, theme, _kb, done) => new ChangedFilesOverlay(ctx.cwd, tui, theme, done),
    { ...OVERLAY_OPTIONS, onHandle: options?.onHandle },
  );
}

export default function (pi: ExtensionAPI) {
  // Ctrl+Space shortcut — toggles the overlay
  pi.registerShortcut("ctrl+space", {
    description: "Toggle git changed files overlay",
    handler: async (ctx) => {
      if (overlayHandle) {
        overlayHandle.hide();
        overlayHandle = null;
        return;
      }

      const result = await openOverlay(ctx, { onHandle: (h) => { overlayHandle = h; } });
      overlayHandle = null;

      if (result) {
        await handleFileSelected(result, ctx);
      }
    },
  });

  // Also available as /changed-files command
  pi.registerCommand("changed-files", {
    description: "Show git changed files in an overlay",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const result = await openOverlay(ctx);

      if (result) {
        await handleFileSelected(result, ctx);
      }
    },
  });
}
