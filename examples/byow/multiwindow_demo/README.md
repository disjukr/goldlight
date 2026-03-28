# BYOW Multiwindow Demo

This example opens two small native BYOW windows at the same time to validate the process-global
desktop window manager and per-window module worker flow.

## Run

```sh
deno run -A --unstable-ffi --unstable-webgpu --unstable-raw-imports examples/byow/multiwindow_demo/main.ts
```

## What To Expect

- Two `360x240` windows open at the same time
- Each window has a different title and startup background color
- Both windows run the existing BYOW triangle module independently
