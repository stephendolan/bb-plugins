# Project Palette for bb

Project Palette replaces bb’s `⌘K` thread search with a keyboard-first
switcher for projects, machines, and threads.

Press `⌘K` on macOS or `Ctrl+K` elsewhere from anywhere in bb to open the
palette. With an empty query it lists every project, every machine, and the
most recently updated threads. Typing filters all three by simple substring
match on the name or title, so a thread only appears when its title contains
what you typed. Projects and machines always sort above threads.

Choosing a project opens the New Thread screen with that project selected. The
first project is **Don’t work in a project**, which uses bb’s personal project
and preserves its normal projectless-thread behavior. Choosing a connected
machine opens that same projectless composer on the selected machine; offline
machines remain visible but unavailable. Choosing a thread navigates to it.

Escape closes the palette and leaves bb’s built-in composer unchanged. The
palette never opens automatically.

## Development

From the repository root:

```sh
npm install
npm run check --workspace bb-plugin-project-palette
bb plugin install ./plugins/project-palette
```
