# Project Palette for bb

Project Palette is a keyboard-first switcher for starting a new bb thread in a
project or on a machine, or jumping to a recent thread.

Press `⌘N` on macOS or `Ctrl+N` elsewhere to open the palette. It is the
**Open Project Palette** command in bb’s command palette, so you can rebind it
in Settings → Keyboard or with
`bb settings keyboard set plugin:project-palette/open <shortcut>`.

bb’s desktop app also binds New thread to `⌘N`, and bb leaves a conflicting
plugin default unbound. Move New thread to its other default shortcut so the
palette gets `⌘N`:

```sh
bb settings keyboard set thread.new Mod+Shift+O
```

Browsers keep `⌘N` for a new window, so in a browser tab open the palette from
the command palette or bind another shortcut.

With an empty query the palette lists every project, every machine, and the
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
