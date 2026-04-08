# ADR 0002: BDL Defines Serializable Scene IR

## Status

Accepted

## Decision

Serializable scene IR is authored in BDL. TypeScript mirrors are generated from the BDL schema and
treated as derivative artifacts.

## Consequences

- schema changes must be reflected in BDL first
- renderer and runtime-specific state stays outside the schema
- interop code converts external formats into BDL-defined IR
