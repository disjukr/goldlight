# Drawing GM

This directory hosts small ports of Skia `gm/` samples into `packages/drawing`.

Each GM lives in its own subdirectory and should usually provide:

- `render.ts`: Dawn/`@goldlight/drawing` rendering path
- `main.ts`: writes `out.png`
- `canvaskit.ts`: CanvasKit reference rendering path
- `canvaskit_main.ts`: writes `ckout.png`
- `README.md`: sample-specific notes and run commands

Current ports:

- `fillrect_gradient`: Skia `gm/fillrect_gradient.cpp`
