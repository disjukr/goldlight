# Example Assets

This directory stores small, versioned assets that are practical to keep in the repository.

## Included Assets

- `stanford-bunny/`: Stanford Bunny source mesh and extracted `bun_zipper.ply`
- `damaged-helmet/`: Khronos `DamagedHelmet.glb` sample asset
- `hdri/`: 1K EXR environment-map samples used by the forward helmet demos

## Refresh Status

The old Deno asset refresh tasks were removed during the Bun migration.

- These assets are currently treated as vendored repository fixtures.
- If a refresh workflow is needed again, add a Bun-based script before documenting it here.
