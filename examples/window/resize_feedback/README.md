# resize feedback

Window example that keeps a centered text readout of the current native window
size while the user resizes the window.

This variant is built around the 2D layout API:

```ts
new LayoutGroup2d().setLayout({ display: "flex", justifyContent: "center", alignItems: "center" });
new LayoutItem2d().setLayout({ width: 720, height: 320 });
```

The worker listens for:

```ts
addWindowEventListener("resize", (event) => {
  console.log(event.width, event.height);
});
```

and updates both the layout tree and the middle `width x height` label in real
time.

## Run

From this directory:

```sh
bun run goldlight dev
```
