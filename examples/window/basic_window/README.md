# basic window

Minimal example that opens a single native window and renders a moving 2D rect
from its window worker through:

```ts
import { createWindow } from "goldlight";
```

## Run

From this directory:

```sh
bun run goldlight dev
```

This uses the local workspace `sdk` package as the official entrypoint, starts a
Vite dev server, and runs the local Rust dev runtime against that server.

The entrypoint comes from [`goldlight.json`](./goldlight.json) in the
current project directory.

`goldlight dev` also starts a JavaScript inspector for the dev runtime. On
startup it prints:

- `dev server: http://127.0.0.1:9016`
- `devtools: devtools://devtools/bundled/js_app.html?...`

Open the printed `devtools://...` URL.

Use the main DevTools target for:

1. the app entry runtime
2. the window worker source
3. worker breakpoints and paused expression evaluation

The worker side uses the built-in rendering object model:

- `new Scene2d()`
- `new Rect2d()`
- `scene.add(rect)`
- `scene.get()`
- `scene.set(...)`
- `rect.get()`
- `rect.set(...)`
- `setWindowScene(scene)`

## VS Code attach

You can also try attaching from VS Code first:

1. Run `bun run goldlight dev`
2. Open the repository in VS Code
3. Start the `Attach goldlight main runtime` launch configuration

## Direct runtime run

If you want to skip the dev server and run the file directly:

```sh
cargo run -p goldlight-runtime --bin goldlight-runtime-dev -- --vite http://127.0.0.1:9016 --inspect 127.0.0.1:9229 main.ts
```

## Build

To create a production app bundle for the current OS:

```sh
bun run goldlight build
```

To run the built app from this directory:

```sh
bun run goldlight run
```

This writes output to `dist/<target-os>/`. On Windows that includes a
double-clickable `goldlight.exe` next to the bundled `app/main.js` and
`goldlight.manifest.json`.
