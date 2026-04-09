const v8Console = Deno.core.v8Console;
const inspectorConsole = {};

for (const key of Object.keys(v8Console)) {
  const value = v8Console[key];
  inspectorConsole[key] =
    typeof value === "function" ? value.bind(v8Console) : value;
}

globalThis.console = inspectorConsole;
