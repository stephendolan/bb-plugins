# BB Plugins

Stephen Dolan's personal extensions for [BB](https://github.com/get-bb/bb), kept
together in one workspace.

## Plugins

| Plugin | What it does |
| --- | --- |
| [Image Copy](./plugins/image-copy) | Copies an image directly from BB's file preview. |
| [Jev](./plugins/jev) | Gives agents a classification tool backed by TypeSafe's Jev evaluation model. |
| [Personal Files](./plugins/personal-files) | Browses the working directory of personal threads in the right panel. |
| [Project Palette](./plugins/project-palette) | Opens a searchable new-thread project picker with `⌘⇧P` / `Ctrl+Shift+P`. |
| [Thread Curator](./plugins/thread-curator) | Names and dynamically groups active threads with one efficient Luna worker. |

## Install

`.bb/plugins.json` indexes every plugin, so BB installs each one by name
straight from Git and builds it on the host:

```sh
bb plugin install git:https://github.com/stephendolan/bb-plugins.git@main --plugin image-copy
bb plugin install git:https://github.com/stephendolan/bb-plugins.git@main --plugin jev
bb plugin install git:https://github.com/stephendolan/bb-plugins.git@main --plugin personal-files
bb plugin install git:https://github.com/stephendolan/bb-plugins.git@main --plugin project-palette
bb plugin install git:https://github.com/stephendolan/bb-plugins.git@main --plugin thread-curator
```

These installs track `main`. After pushing changes, update them with:

```sh
bb plugin outdated
bb plugin update --all
```

## Develop

Each plugin is an independent BB package under `plugins/<id>`. Run every
plugin's checks from the workspace root:

```sh
npm install
npm run check
```

For a tight edit loop, install a plugin from its local path and watch it:

```sh
bb plugin install ./plugins/thread-curator
bb plugin dev ./plugins/thread-curator
```

Switch back to the Git install when you are done so the server runs what is
on `main`.

New plugins belong in `plugins/<id>` with their own `package.json`, source,
tests, pinned `@get-bb/plugin-sdk` development dependency, and README. Add each
directory to `.bb/plugins.json`; the root npm workspace picks it up
automatically.

## License

[MIT](./LICENSE).

## Acknowledgements

This workspace began as a fork of
[MateoCerquetella/bb-plugins](https://github.com/MateoCerquetella/bb-plugins),
whose layout was inspired by
[smsunarto/bb-plugins](https://github.com/smsunarto/bb-plugins).
