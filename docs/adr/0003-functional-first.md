# ADR 0003: Functional-First API Style

## Status

Accepted

## Decision

Public APIs and most internal packages use plain data and functions. `class` is reserved for
performance- or lifetime-driven implementation details.

## Consequences

- package boundaries favor transforms over object graphs
- state ownership is explicit in function arguments
- performance-oriented classes must be justified by profiling or benchmarks
