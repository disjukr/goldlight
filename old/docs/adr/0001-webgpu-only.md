# ADR 0001: WebGPU Only

## Status

Accepted

## Decision

`goldlight` only targets WebGPU. WebGL fallback is out of scope for v1.

## Consequences

- all rendering contracts can assume WebGPU features and WGSL
- portability work focuses on browser, Deno, and headless targets
- compatibility shims for older graphics APIs are intentionally omitted
