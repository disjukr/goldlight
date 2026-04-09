const hotData = new Map();
const hotContexts = new Map();
const customListeners = new Map();
const loadedModules = new Set();

function normalizeHotPath(specifier) {
  try {
    let normalized = String(specifier);
    const schemeIndex = normalized.indexOf("://");
    if (schemeIndex >= 0) {
      const pathStart = normalized.indexOf("/", schemeIndex + 3);
      normalized = pathStart >= 0 ? normalized.slice(pathStart) : "/";
    }

    const hashIndex = normalized.indexOf("#");
    if (hashIndex >= 0) {
      normalized = normalized.slice(0, hashIndex);
    }

    const queryIndex = normalized.indexOf("?");
    if (queryIndex < 0) {
      return normalized;
    }

    const path = normalized.slice(0, queryIndex);
    const search = normalized.slice(queryIndex + 1);
    const searchParams = new URLSearchParams(search);
    searchParams.delete("t");
    const nextSearch = searchParams.toString();
    return `${path}${nextSearch ? `?${nextSearch}` : ""}`;
  } catch {
    return String(specifier);
  }
}

function addCustomListener(event, callback) {
  const listeners = customListeners.get(event) ?? [];
  listeners.push(callback);
  customListeners.set(event, listeners);
}

function removeCustomListener(event, callback) {
  const listeners = customListeners.get(event);
  if (!listeners) {
    return;
  }
  const nextListeners = listeners.filter((listener) => listener !== callback);
  if (nextListeners.length === 0) {
    customListeners.delete(event);
    return;
  }
  customListeners.set(event, nextListeners);
}

function notifyCustomListeners(event, payload) {
  const listeners = customListeners.get(event) ?? [];
  for (const listener of listeners) {
    listener(payload);
  }
}

function ensureHotContext(path) {
  const existing = hotContexts.get(path);
  if (existing) {
    existing.acceptCallbacks = [];
    existing.disposeCallbacks = [];
    existing.pruneCallbacks = [];
    return existing;
  }

  const context = {
    path,
    acceptCallbacks: [],
    disposeCallbacks: [],
    pruneCallbacks: [],
  };
  hotContexts.set(path, context);
  if (!hotData.has(path)) {
    hotData.set(path, {});
  }
  return context;
}

function registerAccept(context, deps, callback) {
  context.acceptCallbacks.push({
    deps,
    fn: callback ?? (() => {}),
  });
}

function createHotContext(specifier) {
  const path = normalizeHotPath(specifier);
  const context = ensureHotContext(path);

  return {
    get data() {
      return hotData.get(path) ?? {};
    },
    accept(deps, callback) {
      if (typeof deps === "function" || deps == null) {
        registerAccept(context, [path], ([module]) => deps?.(module));
        return;
      }

      if (typeof deps === "string") {
        registerAccept(context, [normalizeHotPath(deps)], ([module]) => callback?.(module));
        return;
      }

      if (Array.isArray(deps)) {
        registerAccept(
          context,
          deps.map((dep) => normalizeHotPath(dep)),
          callback ?? (() => {}),
        );
        return;
      }

      throw new Error("invalid hot.accept() usage");
    },
    acceptExports(_exports, callback) {
      registerAccept(context, [path], ([module]) => callback?.(module));
    },
    dispose(callback) {
      context.disposeCallbacks.push(callback);
    },
    prune(callback) {
      context.pruneCallbacks.push(callback);
    },
    invalidate(message) {
      notifyCustomListeners("vite:invalidate", {
        path,
        message,
        firstInvalidatedBy: path,
      });
      Deno.core.ops.op_goldlight_hmr_request_restart();
    },
    on(event, callback) {
      addCustomListener(event, callback);
    },
    off(event, callback) {
      removeCustomListener(event, callback);
    },
    send(_event, _data) {},
  };
}

function registerModule(specifier) {
  const path = normalizeHotPath(specifier);
  loadedModules.add(path);
}

async function importUpdatedModule(path, timestamp) {
  const separator = path.includes("?") ? "&" : "?";
  return await import(`${path}${separator}t=${timestamp}`);
}

async function applyUpdate(update) {
  const acceptedPath = normalizeHotPath(update.acceptedPath ?? update.path);
  if (!loadedModules.has(acceptedPath)) {
    return;
  }
  const matchedEntries = [];

  for (const [ownerPath, context] of hotContexts.entries()) {
    const callbacks = context.acceptCallbacks.filter(({ deps }) => deps.includes(acceptedPath));
    if (callbacks.length > 0) {
      matchedEntries.push({ ownerPath, context, callbacks });
    }
  }

  if (matchedEntries.length === 0) {
    return;
  }

  notifyCustomListeners("vite:beforeUpdate", {
    type: "update",
    updates: [update],
  });

  let nextModule;
  try {
    const selfAccept = matchedEntries.some(({ ownerPath }) => ownerPath === acceptedPath);
    if (selfAccept) {
      const context = hotContexts.get(acceptedPath);
      if (context) {
        hotContexts.delete(acceptedPath);
        const nextData = {};
        for (const dispose of context.disposeCallbacks) {
          dispose(nextData);
        }
        hotData.set(acceptedPath, nextData);
      }
    }

    nextModule = await importUpdatedModule(acceptedPath, update.timestamp);
  } catch {
    Deno.core.ops.op_goldlight_hmr_request_restart();
    return;
  }

  for (const { callbacks } of matchedEntries) {
    for (const { deps, fn } of callbacks) {
      fn(
        deps.map((dependency) => (dependency === acceptedPath ? nextModule : undefined)),
      );
    }
  }

  notifyCustomListeners("vite:afterUpdate", {
    type: "update",
    updates: [update],
  });
}

globalThis.__goldlightCreateHotContext = createHotContext;
globalThis.__goldlightRegisterModule = registerModule;

globalThis.__goldlightPumpHmr = async function () {
  const updates = Deno.core.ops.op_goldlight_hmr_drain_updates();
  for (const update of updates) {
    if (!update.type || update.type === "update") {
      await applyUpdate(update);
    } else if (update.type === "full-reload") {
      notifyCustomListeners("vite:beforeFullReload", update);
      Deno.core.ops.op_goldlight_hmr_request_restart();
      return;
    }
  }
};
