# Desktop Shell

`@goldlight/desktop` is a rendering-first desktop shell for Deno applications. It provides:

- process-level desktop initialization through `initializeMain()` / `disposeMain()`
- window creation through `createWindow(...)`
- a React-facing window bootstrap through `initializeWindow(...)`
- a Rust `winit` host for native windows and raw surface handles

The package is currently focused on rendering and window/runtime integration first. Rich shell
features such as menus, tray integration, and embedded webviews are not implemented yet.

## Scope

- single process
- Deno-first application model
- Rust `winit` FFI host
- one shared window-manager worker per process
- multiple native windows, each with its own module worker and runtime object

## Boundary

The desktop runtime is split into two layers.

- Deno owns the application-facing API surface and worker orchestration
- Rust owns the actual OS windows, event pump, redraw requests, and raw surface handles

The native host exposes a narrow ABI:

- host init and shutdown
- create and destroy window
- request redraw
- poll and drain events
- query window state
- query raw surface handles for `Deno.UnsafeWindowSurface`

App authors do not call the FFI layer directly. They go through `@goldlight/desktop`.

## Process Model

The current process model is:

1. `initializeMain()` prepares one shared window-manager worker
2. `createWindow(...)` creates a native window through that shared manager
3. each created window gets its own module worker
4. the main thread routes messages and lifecycle events between the shared manager worker and the
   per-window module worker
5. `disposeMain()` tears down the shared manager worker

This keeps the stronger invariant that there is one window-manager worker per application process,
while still allowing multiple native windows.

## Runtime Model

Each desktop window gets a runtime object. The runtime owns:

- the window-local `requestAnimationFrame` queue
- `cancelAnimationFrame`
- `postMessage` delivery
- dispatch of host events into a browser-like event surface
- resize, scale-factor, focus, and close event delivery into the window module worker

The bootstrap installs the minimal global hooks before importing the user module. That guarantees
all modules in the same isolate observe the desktop-provided `requestAnimationFrame`,
`cancelAnimationFrame`, and `postMessage` functions.

## Rendering Model

The desktop runtime itself does not force a game-style frame loop.

- if application code keeps calling `requestAnimationFrame(...)`, the window behaves like a
  continuously updating renderer
- if application code does not do that, the window behaves like a normal application and redraws
  only when state changes or when the system requires a new frame, such as resize, restore, or
  surface recovery

`initializeWindow(...)` follows that same model. It owns runtime-managed frame fields such as
viewport size, frame index, and delta time, while the application can opt into a time-driven loop
through `useSetTimeMs()`.

## Current Windows Note

The current Windows shell still includes pragmatic behavior around native modal move/resize loops so
RAF-driven windows continue to animate while the OS is holding the window in a native drag or resize
interaction. The native follow-up for modal-loop tick delivery is tracked in
[`../issues/0001-native-modal-loop-frame-ticks.md`](../issues/0001-native-modal-loop-frame-ticks.md).
