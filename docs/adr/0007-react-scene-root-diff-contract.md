# ADR 0007: React Scene-Root Diff Contract

## Status

Proposed

## Decision

After the first `createSceneRoot()` bridge landed, the next unresolved question is whether
`@rieul3d/react` should keep publishing whole-scene `SceneIr` snapshots as its public live-update
contract or add a first-class diff/apply surface for committed changes.

The proposal to evaluate is:

- keep the current snapshot commit contract as the stable baseline for now
- decide separately whether a public diff/apply payload is necessary for caller-owned integrations
- if diff metadata is introduced, keep it data-only and derived from committed scene state, not from
  renderer-owned or GPU-owned objects
- leave renderer, residency, and frame execution ownership outside the React package regardless of
  which commit shape is chosen

This ADR does not yet select snapshot-only or diff/apply as the accepted long-term boundary. It
captures the next architecture decision that now blocks follow-up implementation work for issue
`#64`.

Related discussion: `#90`, "ADR 0007: React scene-root diff/apply contract"

## Consequences

- the repository keeps ADR 0006's snapshot bridge as the current implemented path while the next
  contract decision remains open
- snapshot consumers can now derive added/removed/updated resource IDs from committed scene pairs
  through helper utilities without locking the repository into a first-class diff/apply protocol
- the current browser integration still treats node/topology changes as residency-reset boundaries
  through `commitSummaryNeedsResidencyReset()` because residency caches do not prune dead resource
  usage yet
- caller-owned integrations can continue to consume full snapshots immediately without waiting on a
  finer-grained protocol
- any future diff/apply contract will need to justify its public surface in terms of real caller
  pain, not only theoretical efficiency
- follow-up implementation work should track issue `#89` once discussion `#90` settles the desired
  contract shape
