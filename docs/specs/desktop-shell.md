# Desktop Shell

`@rieul3d/desktop` is a rendering-first desktop shell package. It is separate from
`@rieul3d/platform`, which remains limited to lightweight render-target helpers.

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

- the host-driven `requestAnimationFrame` queue
- `cancelAnimationFrame`
- `postMessage` delivery
- dispatch of host events into a browser-like event surface

The bootstrap installs the minimal global hooks before importing the user module. That guarantees
all modules in the same isolate observe the desktop-provided `requestAnimationFrame`,
`cancelAnimationFrame`, and `postMessage` functions.

## Frame Flow

The host is the timing source for animation frames.

1. application code schedules `requestAnimationFrame`
2. the runtime asks the native host to request a redraw
3. `winit` emits `RedrawRequested`
4. the host pushes a frame event with a timestamp into the queue
5. the Deno runtime drains the event queue and flushes RAF callbacks
6. application render code encodes commands and presents the `UnsafeWindowSurface`

This keeps animation timing aligned with host redraw scheduling instead of inventing a parallel
timer in JavaScript.
