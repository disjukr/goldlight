# AAA

Port of Skia [`gm/aaa.cpp`](C:/Users/user/github/google/skia/gm/aaa.cpp).

This example stacks the three GMs from that file vertically:

- `analytic_antialias_convex`
- `analytic_antialias_general`
- `analytic_antialias_inverse`

## Run

From the repository root:

```sh
deno task example:drawing -- gm/aaa check
deno task example:drawing -- gm/aaa png
deno task example:drawing -- gm/aaa ckpng
```
