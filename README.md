# pi-changed-files

Pi extension that shows git-changed files in a floating overlay with diff counts (+/-).

## Usage

### Install

```bash
# From git (unpinned — updates with `pi update --extensions`)
pi install git:github.com/therynamo/pi-changed-files

# Pin to a tag
pi install git:github.com/therynamo/pi-changed-files@v0.1.0

# Local development
pi install /Users/theryngroetken/dev/pi-changed-files
```

### Controls

- **Ctrl+Space** — Toggle the overlay
- **/changed-files** — Show the overlay via command
- **j/k** or **↑/↓** — Navigate the file list
- **Enter** — Copy the file path to clipboard and insert `@file` mention into the editor
- **Escape** — Dismiss the overlay

## What it shows

Files with working-tree or staged changes, sorted by status (deletions, renames, modifications, additions), with `+added` / `-removed` line counts from `git diff --numstat`.
