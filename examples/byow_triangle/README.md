# BYOW Triangle

Windows-native triangle example using Deno BYOW (`Deno.UnsafeWindowSurface`) and SDL2.

Run with:

```sh
deno task setup:sdl2:windows
deno task example:byow:triangle:run
```

Type-check with:

```sh
deno task example:byow:triangle:check
```

Requirements:

- Deno with `--unstable-ffi` and `--unstable-webgpu`
- SDL2 available to `jsr:@divy/sdl2`

The repository includes a Windows-only installer script that downloads the official SDL2 runtime zip
from `libsdl.org/release` into `vendor/sdl2/windows-x64`. The BYOW run task auto-detects that
location on Windows, so after setup you can launch the example directly with
`deno task example:byow:triangle:run`.
