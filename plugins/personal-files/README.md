# Personal Files

A Files tab for personal-thread working directories, including directories on remote BB hosts. Open folders, filter filenames, refresh the listing, and open documents in BB’s standard preview.

The tab is added once when a personal thread is visited. Closing it is respected; reopen it from the right panel’s **+ → Files** action. The underlying directory scan is bounded to 1,000 paths; incomplete listings are labeled. File contents are loaded by BB’s existing preview only when opened.

```sh
npm run check
bb plugin install . --yes
```

Uses Plugin SDK 0.4.47 and BB 0.42.1. The plugin resolves the working directory and host from the thread on every listing request. It does not rename, write or delete files.
