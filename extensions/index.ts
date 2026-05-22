/**
 * Changed Files Overlay Extension
 *
 * Shows a floating overlay of git-tracked changed files with diff counts (+/-).
 * Navigate with j/k (or ↑/↓), Enter on a file to copy its path and insert
 * it into the editor with @ file: syntax. Escape dismisses.
 *
 * Toggle via Ctrl+Space shortcut or /changed-files command.
 */

import type { ExtensionAPI, ExtensionCommandContext, OverlayHandle } from "@earendil-works/pi-coding-agent";
import { openOverlay, handleFileSelected } from "./actions";

// ---------------------------------------------------------------------------
// State for shortcut-based toggle
// ---------------------------------------------------------------------------

let overlayHandle: OverlayHandle | null = null;

// ---------------------------------------------------------------------------
// Extension registration
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  // Ctrl+Space shortcut — toggles the overlay
  pi.registerShortcut("ctrl+space", {
    description: "Toggle git changed files overlay",
    handler: async (ctx: ExtensionCommandContext) => {
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
