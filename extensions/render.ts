/**
 * Pure render functions for the changed-files overlay.
 * Takes immutable state, returns string lines. No side effects.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ChangedFile } from "./git";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OverlayLayout {
  innerW: number;
  statusColW: number;
  pathColW: number;
  plusColW: number;
}

export interface OverlayState {
  files: ChangedFile[];
  selected: number;
  width: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, "error" | "accent" | "warning" | "success"> = {
  D: "error",
  R: "accent",
  M: "warning",
  A: "success",
};

// ---------------------------------------------------------------------------
// Layout computation
// ---------------------------------------------------------------------------

/** Compute column widths based on actual data so everything aligns. */
export function computeLayout(
  files: ChangedFile[],
  innerW: number,
): OverlayLayout {
  const prefixW = 2; // "▸ " or "  "
  const gap = 2;
  const spaceBeforeMinus = 1;

  const maxStatusW = Math.max(3, ...files.map((f) => visibleWidth(f.status)));
  const maxPlusW = Math.max(
    2,
    ...files.map((f) => visibleWidth(f.added > 0 ? `+${f.added}` : "-")),
  );
  const maxMinusW = Math.max(
    2,
    ...files.map((f) => visibleWidth(f.removed > 0 ? `-${f.removed}` : "-")),
  );

  const statusColW = maxStatusW + 1; // + trailing space
  const plusColW = maxPlusW;
  const minusColW = maxMinusW;

  const pathColW = Math.max(
    10,
    innerW - prefixW - statusColW - gap - gap - plusColW - spaceBeforeMinus - minusColW,
  );

  return { innerW, statusColW, pathColW, plusColW };
}

// ---------------------------------------------------------------------------
// Render sections
// ---------------------------------------------------------------------------

function renderHeader(files: ChangedFile[], innerW: number, theme: Theme): string[] {
  const pad = (s: string) => s + " ".repeat(Math.max(0, innerW - visibleWidth(s)));
  const border = (c: string) => theme.fg("border", c);

  const fileCount = files.length;
  const title = theme.fg(
    "accent",
    ` Git Changes (${fileCount} file${fileCount !== 1 ? "s" : ""}) `,
  );
  const titleW = visibleWidth(title);
  const fillW = Math.max(0, innerW - titleW);
  const leftFill = "─".repeat(Math.floor(fillW / 2));
  const rightFill = "─".repeat(fillW - leftFill.length);

  const top = `${border("╭")}${theme.fg("border", leftFill)}${title}${theme.fg("border", rightFill)}${border("╮")}`;

  const colHeader = `${theme.fg("dim", " Status")}  ${theme.fg("dim", "Path")}                    ${theme.fg("dim", "+  -")}`;
  const header = `${border("│")}${pad(colHeader)}${border("│")}`;

  const sep = `${border("├")}${theme.fg("border", "─".repeat(innerW))}${border("┤")}`;

  return [top, header, sep];
}

function renderRows(
  state: OverlayState,
  layout: OverlayLayout,
  theme: Theme,
): string[] {
  const { files, selected } = state;
  const { innerW, statusColW, pathColW, plusColW } = layout;
  const pad = (s: string) => s + " ".repeat(Math.max(0, innerW - visibleWidth(s)));
  const border = (c: string) => theme.fg("border", c);

  return files.map((file, i) => {
    const isSelected = i === selected;

    const statusColor = STATUS_COLORS[file.status] ?? ("dim" as const);
    const statusText = theme.fg(statusColor, file.status);

    const plusText =
      file.added > 0 ? theme.fg("success", `+${file.added}`) : theme.fg("dim", "-");
    const minusText =
      file.removed > 0 ? theme.fg("error", `-${file.removed}`) : theme.fg("dim", "-");

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

function renderPadding(
  files: ChangedFile[],
  currentLines: number,
  innerW: number,
  theme: Theme,
): string[] {
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Render the complete overlay from immutable state. */
export function renderOverlay(state: OverlayState, theme: Theme): string[] {
  const { files, width } = state;
  const innerW = Math.max(1, width - 2);
  const layout = computeLayout(files, innerW);

  const header = renderHeader(files, innerW, theme);
  const rows = renderRows(state, layout, theme);
  const padding = renderPadding(files, header.length + rows.length, innerW, theme);
  const footer = renderFooter(files, innerW, theme);

  return [...header, ...rows, ...padding, ...footer];
}

/** Check if a file entry represents a "not a git repo" placeholder. */
export function isNotARepo(file: ChangedFile): boolean {
  return file.displayPath.startsWith("(not a");
}
