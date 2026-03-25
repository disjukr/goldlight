# Drawing GM

This directory hosts small ports of Skia `gm/` samples into `packages/drawing`.

Each GM lives in its own subdirectory and should usually provide:

- `render.ts`: Dawn/`@goldlight/drawing` rendering path
- `main.ts`: writes `out.png`
- `canvaskit.ts`: CanvasKit reference rendering path
- `canvaskit_main.ts`: writes `ckout.png`
- `README.md`: sample-specific notes and run commands

Current ports:

- `aaa`: Skia `gm/aaa.cpp`
- `fillrect_gradient`: Skia `gm/fillrect_gradient.cpp`

Progress order: alphabetical by Skia `gm/*.cpp`.

Current queue:

- `3d`: blocked, current `packages/drawing` scope is 2D-only
- `aaa`: done
- `aaclip`: pending
- `aarecteffect`: pending
- `aarectmodes`: pending
