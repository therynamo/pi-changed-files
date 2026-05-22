/**
 * Overlay TUI component — thin state container with input handling
 * and memoized rendering.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { matchesKey } from "@earendil-works/pi-tui";
import { fetchChangedFiles, type ChangedFile } from "./git";
import { renderOverlay, isNotARepo, type OverlayState } from "./render";

export class ChangedFilesOverlay {
  readonly focused = false;

  private files: ChangedFile[];
  private selected = 0;

  private cachedWidth?: number;
  private cachedSelected?: number;
  private cachedLines?: string[];

  constructor(
    private cwd: string,
    private tui: TUI,
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
    if (
      this.cachedLines &&
      this.cachedWidth === width &&
      this.cachedSelected === this.selected
    ) {
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
