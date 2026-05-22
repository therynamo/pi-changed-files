/**
 * Post-selection actions and overlay launch helper.
 */

import type { ExtensionCommandContext, OverlayHandle } from "@earendil-works/pi-coding-agent";
import { copyToClipboard } from "@earendil-works/pi-coding-agent";
import type { ChangedFile } from "./git";
import { ChangedFilesOverlay } from "./overlay";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OVERLAY_OPTIONS = {
  overlay: true,
  overlayOptions: { width: "60%", minWidth: 60, maxWidth: 120 } as const,
};

// ---------------------------------------------------------------------------
// Post-selection
// ---------------------------------------------------------------------------

/** Copy file path to clipboard, notify, and insert @mention into the editor. */
export async function handleFileSelected(
  file: ChangedFile,
  ctx: ExtensionCommandContext,
): Promise<void> {
  await copyToClipboard(file.absolutePath);
  ctx.ui.notify(`Copied: ${file.absolutePath}`, "success");
  ctx.ui.setEditorText(`@${file.absolutePath}`);
}

// ---------------------------------------------------------------------------
// Overlay launcher
// ---------------------------------------------------------------------------

export interface OpenOverlayOptions {
  onHandle?: (h: OverlayHandle) => void;
}

/** Open the changed-files overlay and return the selected file (or undefined). */
export function openOverlay(
  ctx: ExtensionCommandContext,
  options?: OpenOverlayOptions,
): Promise<ChangedFile | undefined> {
  return ctx.ui.custom<ChangedFile | undefined>(
    (tui, theme, _kb, done) => new ChangedFilesOverlay(ctx.cwd, tui, theme, done),
    { ...OVERLAY_OPTIONS, onHandle: options?.onHandle },
  );
}
