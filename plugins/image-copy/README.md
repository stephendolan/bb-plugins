# Image Copy for bb

Adds a copy button to bb's native image preview. Open a PNG, JPEG, GIF, WebP,
AVIF, BMP, or SVG path, then use the button in the preview's upper-right corner
to place the rendered image on the system clipboard.

Non-PNG images are converted to PNG for broad clipboard compatibility. Animated
images copy their currently decoded frame.

## Install

```sh
bb plugin install .
```

The plugin keeps bb's native image viewer intact and works with workspace,
host, and thread-storage image paths.
