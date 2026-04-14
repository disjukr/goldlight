# window controls

Window example that lets the worker drive native window state through
`setWindowInfo(...)`.

Controls:

- `Enter`: toggle `default` / `fullscreen`
- `Arrow keys`: move the window by 30 px
- `Shift + Arrow keys`: resize the window by 30 px

The center panel shows both the usage guide and the current `getWindowInfo()`
snapshot.

## Run

From this directory:

```sh
bun run goldlight dev
```
