# basic window

Minimal example that opens a single native window through:

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

## Direct runtime run

If you want to skip the dev server and run the file directly:

```sh
cargo run -p goldlight-runtime --bin goldlight-runtime-dev -- --vite http://127.0.0.1:9016 main.ts
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
