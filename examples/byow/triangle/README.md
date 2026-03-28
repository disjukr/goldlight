# BYOW Triangle

Windows-native triangle example using Deno BYOW (`Deno.UnsafeWindowSurface`) and the
`@disjukr/goldlight/desktop` shell.

Run with:

```sh
deno task example:byow:triangle:run
```

Type-check with:

```sh
deno task example:byow:triangle:check
```

Requirements:

- Deno with `--unstable-ffi` and `--unstable-webgpu`
- the desktop host DLL built through `deno task desktop:host:build` or auto-built by the run task
