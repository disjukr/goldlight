# Example Assets

This directory stores small, versioned assets that are practical to keep in the repository.

## Included Assets

- `stanford-bunny/`: Stanford Bunny source refresh target plus the extracted `bun_zipper.ply`
  reconstruction mesh, now directly loadable through `@rieul3d/importers`
- `damaged-helmet/`: Khronos `DamagedHelmet.glb` sample asset
- `hdri/`: 1K EXR environment-map samples for future lookdev and IBL work

## Refresh Commands

- `deno task asset:examples`: refresh the in-repo example assets
- `deno task asset:stanford-bunny`: re-download the Stanford Bunny source archive and refresh the
  extracted `bun_zipper.ply`
- `deno task asset:damaged-helmet`: re-download the `DamagedHelmet.glb` sample
- `deno task asset:hdri`: refresh the vendored 1K EXR HDRI sample set
- `deno task asset:sponza`: download the `Sponza` glTF sample into `examples/assets/sponza/`

Large assets that should not live in git can still be staged under `examples/assets/` when they are
explicitly ignored, such as `examples/assets/sponza/`.
