# 2d scroll container

Demonstrates `ScrollContainer2d` by auto-panning a large retained 2D surface
inside a clipped viewport. There is no pointer input yet, so the worker drives
`scrollX` and `scrollY` from `requestAnimationFrame`.

From this directory:

```sh
bun run goldlight dev
```

Build a production bundle:

```sh
bun run goldlight build
```
