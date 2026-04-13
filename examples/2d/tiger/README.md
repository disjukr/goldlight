# 2d tiger

Parses the classic tiger SVG through the runtime `usvg` bridge, places all `Path2d` nodes inside a
single `Group2d`, and enables `cacheAsRaster` on that group. The window is resizable so cache
behavior can be observed while resizing, and a small FPS HUD is rendered in the corner.

From this directory:

```sh
bun run goldlight dev
```
