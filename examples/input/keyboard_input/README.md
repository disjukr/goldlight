# input

Keyboard input example that visualizes physical key presses on a keyboard-shaped
layout and shows the latest event payload details in a text inspector panel.

The worker listens for:

```ts
addWindowEventListener("keydown", (event) => {
  console.log(event.code, event.key, event.repeat);
});

addWindowEventListener("keyup", (event) => {
  console.log(event.code, event.key);
});
```

The highlighted keycaps are driven by `event.code`, so the view follows the
physical key location instead of the current text layout.

## Run

From this directory:

```sh
bun run goldlight dev
```
