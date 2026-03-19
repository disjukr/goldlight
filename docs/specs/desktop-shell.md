# Desktop Shell

`@rieul3d/desktop` is a rendering-first desktop shell package. Render-target descriptors are passed
as plain literals directly to `@rieul3d/gpu` instead of going through a separate platform package.

## Scope

- single process
- Deno-first application model
- Rust `winit` FFI host
- single-window in v1
- worker-shaped runtime semantics for future multi-window expansion

Rich desktop shell features such as menus, tray integration, and embedded webviews are out of scope
for v1.

## Boundary

The desktop runtime is split into two layers.

- Deno owns the application-facing API surface
- Rust owns the actual OS window, event pump, and redraw scheduling

The native host exposes a narrow pull-style ABI:

- host init and shutdown
- create and destroy window
- request redraw
- poll and drain events
- query window state
- query raw surface handles for `Deno.UnsafeWindowSurface`

The JavaScript wrapper does not expose raw FFI calls to app authors.

## Runtime Model

Each desktop window gets a runtime object even though v1 only supports one window. The runtime owns:

- the window-local `requestAnimationFrame` queue
- `cancelAnimationFrame`
- `postMessage` delivery
- dispatch of host events into a browser-like event surface

The bootstrap installs the minimal global hooks before importing the user module. That guarantees
all modules in the same isolate observe the desktop-provided `requestAnimationFrame`,
`cancelAnimationFrame`, and `postMessage` functions.

## Frame Flow

The current runtime uses a hybrid model:

1. application code schedules `requestAnimationFrame`
2. the runtime asks the native host to request a redraw
3. the window worker also keeps a local timer armed so RAF continues during native modal move/resize
   loops that can delay host redraw delivery on Windows
4. host `frame` events may still flush RAF callbacks sooner when they arrive
5. application render code encodes commands and presents the `UnsafeWindowSurface`

This is a pragmatic behavior fix for the current Windows shell rather than the final timing model.
The native follow-up for modal-loop tick delivery is tracked in
[`../issues/0001-native-modal-loop-frame-ticks.md`](../issues/0001-native-modal-loop-frame-ticks.md).
