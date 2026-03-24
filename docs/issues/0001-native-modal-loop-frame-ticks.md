# Issue 0001: Native Desktop Frame Ticks During Windows Move/Resize Modal Loops

## Status

Open.

## Context

`@goldlight/desktop` now runs desktop modules in per-window Deno workers while a separate window
manager worker owns the Rust `winit` host and event pumping. That split isolates application logic,
React updates, and WebGPU rendering from the main bootstrap isolate.

However, Windows move/resize interactions still enter a native modal loop on the host side. During
that loop the `winit`-driven host pump may delay or stall redraw-aligned frame delivery. The
repository now mitigates visible animation stalls by using a worker-local timer-backed
`requestAnimationFrame` implementation inside the window runtime.

That mitigation is pragmatic, but it is not the final architecture.

## Problem

The current desktop runtime no longer requires host-delivered `frame` events to keep rendering
alive, but this leaves several gaps:

- frame cadence is no longer strictly aligned with the native redraw cycle
- redundant renders may occur when the worker timer runs faster than useful presentation work
- present timing during modal move/resize interactions is controlled by JavaScript timers instead of
  the native host
- the documented desktop-shell contract still describes host-driven RAF timing as the desired model

The unresolved question is how the native desktop host should continue to provide timely frame or
tick signals even while Windows owns the move/resize modal loop.

## Desired Outcome

Preserve smooth animation during drag/resize interactions without relying solely on JavaScript-side
timer ticks, while keeping the runtime compatible with multi-window expansion.

## Constraints

- `winit` remains the host window/event abstraction for v1
- desktop windows should remain worker-shaped so per-window application state can scale toward
  multi-window support
- the solution must not reintroduce a design where the main bootstrap isolate owns the host loop
- window creation, destruction, and raw-handle lifetime must stay under the native host/manager
  boundary
- the eventual design should not make future non-Windows support harder than the current timer
  fallback already does

## Candidate Directions

### Option A: Native Tick Delivery During Modal Loops

Teach the native host to continue emitting tick/frame messages while Windows is inside move/resize
modal loops.

Potential avenues:

- detect entry/exit of the modal loop with Win32-specific messages such as `WM_ENTERSIZEMOVE` and
  `WM_EXITSIZEMOVE`
- maintain a native timer or alternate wakeup path that continues to push frame/tick events into the
  host event queue while the modal loop is active
- distinguish between redraw-aligned frames and host tick events so the JS runtime can make clearer
  scheduling decisions

Main benefits:

- preserves a host-authored timing model
- keeps presentation cadence closer to native window-system behavior
- reduces reliance on JavaScript timers for continuous desktop animation

Main risks:

- likely requires Windows-specific host code below current `winit` abstractions
- adds lifecycle complexity around timer start/stop, close, resize, and shutdown ordering
- raises the bar for cross-platform parity

### Option B: Hybrid Host Tick + Worker RAF Policy

Keep the current worker-local timer fallback, but add a first-class host tick mode that can take
priority whenever the native host can provide reliable cadence.

Potential shape:

- worker runtime continues to support timer-backed RAF
- host `frame` or future `tick` events can opportunistically flush RAF sooner
- runtime records whether frames were host-driven or timer-driven for diagnostics

Main benefits:

- incremental migration path from the current mitigation
- resilient fallback when native tick delivery is missing or temporarily blocked
- avoids rebreaking drag/resize behavior while native work is in progress

Main risks:

- more complex runtime semantics
- potential double-scheduling or jitter if host and timer cadence are not coordinated carefully

## Open Questions

- Can `winit` alone expose enough signal to drive modal-loop ticks correctly, or is direct Win32
  message handling required?
- Should native modal-loop ticks be modeled as the same `frame` event or as a separate `tick` event?
- How should the runtime coalesce or prioritize timer-driven vs host-driven callbacks to avoid
  duplicate work?
- Should native tick delivery apply only while move/resize modal loops are active, or more broadly
  whenever redraw delivery is delayed?
- What telemetry or debug hooks are needed so desktop runtime regressions can be diagnosed without
  interactive debugging?

## Immediate Follow-up

- keep the current worker-local timer RAF fallback in place so desktop examples remain usable during
  move/resize interactions
- prototype Windows-specific modal-loop detection in the native host behind a narrow internal
  boundary
- validate how that prototype interacts with `UnsafeWindowSurface.present()`, resize events, and
  future multi-window management
