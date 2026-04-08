# Desktop Shell

`@disjukr/goldlight/desktop` is a rendering-first desktop shell for Bun applications running under Electrobun. It provides:

- process-level desktop initialization through `initializeMain()` / `disposeMain()`
- window creation through `createWindow(...)`
- a React-facing bootstrap through `initializeWindow(...)`
- Electrobun `GpuWindow` integration with WebGPU canvas contexts

## Scope

- single-process desktop runtime
- Electrobun-managed native windows
- application-controlled frame scheduling through the window runtime
- multiple native windows inside one Bun process

## Boundary

The desktop boundary is now split into two layers.

- Bun/Electrobun owns the application-facing API surface, window creation, and WebGPU surface hookup
- the goldlight desktop runtime owns browser-like events, RAF scheduling, resize propagation, and cleanup

App authors do not call any native bridge directly. They use `@disjukr/goldlight/desktop`.

## Runtime Model

Each desktop window gets a runtime object. The runtime owns:

- the window-local `requestAnimationFrame` queue
- `cancelAnimationFrame`
- `postMessage` delivery
- dispatch of resize, focus, scale-factor, and close events into a browser-like surface

`initializeWindow(...)` follows the same model. It owns runtime-managed frame fields such as viewport size, frame index, and delta time, while the application can opt into a time-driven loop through `useSetTimeMs()`.

## Rendering Model

The desktop runtime does not force a game-style loop.

- if application code keeps calling `requestAnimationFrame(...)`, the window behaves like a continuously updating renderer
- if application code does not, the window redraws only when content or system state requires it
