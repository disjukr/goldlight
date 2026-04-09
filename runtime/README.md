# goldlight runtime

Rust runtime scaffold for the next goldlight architecture.

The runtime owns the event loop and resolves the built-in `"goldlight"` module
itself. It does not create a default window on boot. Windows are created only
when user JavaScript imports `"goldlight"` and calls `createWindow(...)`.

## Binaries

- `goldlight-runtime-dev`: connects to a Vite dev server with `--vite <url>`
- `goldlight-runtime-prod`: loads from a bundle root structure

## Production output

`goldlight build` is expected to place a native app layout in `dist/<target-os>/`.
On Windows that means a double-clickable `.exe` next to the bundled app files.
The SDK also writes `goldlight.manifest.json` beside the binary, and the prod
runtime reads that manifest to find the bundle entrypoint.

## Dev

```sh
bun run goldlight dev
```

Run this from a project directory that contains `goldlight.json`.

The entrypoint is resolved from that file, and startup prints:

- `dev server: http://127.0.0.1:9016`
- `devtools: devtools://...`

Open the printed `devtools://...` link.

Use the main DevTools target for:

- the app entry runtime
- worker sources
- worker breakpoints and paused expression evaluation

```js
import { createWindow } from "goldlight";

createWindow({ width: 640, height: 480 });
```
