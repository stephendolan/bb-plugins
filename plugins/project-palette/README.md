# Project Palette for bb

Project Palette adds a keyboard-first project chooser to bb’s New Thread
screen without adding persistent UI.

Press `⌘⇧P` on macOS or `Ctrl+Shift+P` elsewhere to open the searchable
picker. Type to filter every project, use the arrow keys to move, and press
Enter to choose. The first result is **Don’t work in a project**, which uses
bb’s personal project and preserves its normal projectless-thread behavior.

Escape closes the picker and leaves bb’s built-in composer unchanged. The
palette never opens automatically.

## Development

From the repository root:

```sh
npm install
npm run check --workspace bb-plugin-project-palette
bb plugin install ./plugins/project-palette
```
