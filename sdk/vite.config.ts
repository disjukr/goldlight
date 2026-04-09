import { defineConfig, normalizePath } from 'vite';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const GOLDLIGHT_RUNTIME_MODULE_ID = '\0goldlight-runtime';
const GOLDLIGHT_RUNTIME_PUBLIC_ID = '/__goldlight/runtime';
const GOLDLIGHT_WORKER_QUERY = '?goldlight-worker-url';
const GOLDLIGHT_RUNTIME_MODULE_SOURCE = readFileSync(
  resolve(import.meta.dirname, '..', 'runtime', 'js', 'goldlight_module.js'),
  'utf8',
);

let isBuild = false;
let devServerOrigin = 'http://127.0.0.1:9016';
let resolvedRoot = resolve(import.meta.dirname, '..');

function isGoldlightHmrFile(file: string) {
  return /\.(?:[cm]?[jt]sx?)$/i.test(file);
}

type HotModuleNode = {
  url: string;
  id: string | null;
  importers: Set<HotModuleNode>;
  acceptedHmrDeps: Set<HotModuleNode>;
  acceptedHmrExports: Set<string> | null;
  importedBindings: Map<string, Set<string>> | null;
  isSelfAccepting?: boolean;
};

function normalizeHmrPath(url: string) {
  try {
    const parsed = new URL(url, 'https://0xabcdef.com');
    const searchParams = new URLSearchParams(parsed.search);
    searchParams.delete('t');
    const search = searchParams.toString();
    return `${parsed.pathname}${search ? `?${search}` : ''}`;
  } catch {
    return url;
  }
}

function areAllImportsAccepted(
  importedBindings: Set<string>,
  acceptedExports: Set<string> | null,
) {
  if (!acceptedExports) {
    return false;
  }

  for (const binding of importedBindings) {
    if (!acceptedExports.has(binding)) {
      return false;
    }
  }

  return true;
}

function propagateGoldlightBoundary(
  node: HotModuleNode,
  traversed: Set<HotModuleNode>,
  boundaries: Array<{ path: string; acceptedPath: string }>,
): boolean {
  if (traversed.has(node)) {
    return false;
  }
  traversed.add(node);

  if (node.isSelfAccepting) {
    const path = normalizeHmrPath(node.url);
    boundaries.push({ path, acceptedPath: path });
    return false;
  }

  if (node.acceptedHmrExports) {
    const path = normalizeHmrPath(node.url);
    boundaries.push({ path, acceptedPath: path });
  } else if (node.importers.size === 0) {
    return true;
  }

  for (const importer of node.importers) {
    if (importer.acceptedHmrDeps.has(node)) {
      boundaries.push({
        path: normalizeHmrPath(importer.url),
        acceptedPath: normalizeHmrPath(node.url),
      });
      continue;
    }

    if (node.id && node.acceptedHmrExports && importer.importedBindings) {
      const importedBindings = importer.importedBindings.get(node.id);
      if (importedBindings && areAllImportsAccepted(importedBindings, node.acceptedHmrExports)) {
        continue;
      }
    }

    if (propagateGoldlightBoundary(importer, traversed, boundaries)) {
      return true;
    }
  }

  return false;
}

function collectGoldlightBoundaries(
  modules: readonly HotModuleNode[],
  timestamp: number,
  changedPath: string,
) {
  const updates: Array<{ path: string; acceptedPath: string; timestamp: number }> = [
    {
      path: changedPath,
      acceptedPath: changedPath,
      timestamp,
    },
  ];

  for (const module of modules) {
    const boundaries: Array<{ path: string; acceptedPath: string }> = [];
    const hasDeadEnd = propagateGoldlightBoundary(module, new Set<HotModuleNode>(), boundaries);
    if (hasDeadEnd) {
      continue;
    }
    for (const boundary of boundaries) {
      updates.push({
        ...boundary,
        timestamp,
      });
    }
  }

  const deduped = new Map<string, { path: string; acceptedPath: string; timestamp: number }>();
  for (const update of updates) {
    deduped.set(`${update.path}::${update.acceptedPath}`, update);
  }
  return [...deduped.values()];
}

export default defineConfig({
  root: resolve(import.meta.dirname, '..'),
  plugins: [
    {
      name: 'goldlight-runtime-module',
      enforce: 'pre',
      configResolved(config) {
        isBuild = config.command === 'build';
      },
      resolveId(source) {
        if (source === 'goldlight') {
          return isBuild ? GOLDLIGHT_RUNTIME_MODULE_ID : GOLDLIGHT_RUNTIME_PUBLIC_ID;
        }

        if (!isBuild && source === GOLDLIGHT_RUNTIME_PUBLIC_ID) {
          return GOLDLIGHT_RUNTIME_PUBLIC_ID;
        }

        return null;
      },
      load(id) {
        if (id === GOLDLIGHT_RUNTIME_MODULE_ID || id === GOLDLIGHT_RUNTIME_PUBLIC_ID) {
          return GOLDLIGHT_RUNTIME_MODULE_SOURCE;
        }

        return null;
      },
    },
    {
      name: 'goldlight-worker-entrypoint',
      enforce: 'pre',
      configResolved(config) {
        isBuild = config.command === 'build';
        resolvedRoot = config.root;
        const port = config.server.port ?? 9016;
        devServerOrigin = `http://${config.server.host ?? '127.0.0.1'}:${port}`;
      },
      async resolveId(source, importer) {
        if (!source.endsWith('?worker')) {
          return null;
        }

        const resolved = await this.resolve(source.slice(0, -'?worker'.length), importer, {
          skipSelf: true,
        });

        if (!resolved) {
          return null;
        }

        return `${resolved.id}${GOLDLIGHT_WORKER_QUERY}`;
      },
      load(id) {
        if (!id.endsWith(GOLDLIGHT_WORKER_QUERY)) {
          return null;
        }

        const workerId = id.slice(0, -GOLDLIGHT_WORKER_QUERY.length);
        if (isBuild) {
          const referenceId = this.emitFile({
            type: 'chunk',
            id: workerId,
          });

          return `export default import.meta.ROLLUP_FILE_URL_${referenceId};`;
        }

        const relativeWorkerUrl = normalizePath(relative(resolvedRoot, workerId));
        return `export default ${JSON.stringify(`${devServerOrigin}/${relativeWorkerUrl}`)};`;
      },
      resolveFileUrl({ fileName }) {
        return JSON.stringify(`./${normalizePath(fileName)}`);
      },
    },
    {
      name: 'goldlight-hmr-bridge',
      apply: 'serve',
      handleHotUpdate(context) {
        const normalizedFile = normalizePath(context.file);
        if (!isGoldlightHmrFile(normalizedFile)) {
          return;
        }

        const relativePath = normalizePath(relative(context.server.config.root, normalizedFile));
        if (relativePath.startsWith('..')) {
          return;
        }

        const timestamp = Date.now();
        const updates = collectGoldlightBoundaries(
          context.modules as readonly HotModuleNode[],
          timestamp,
          `/${relativePath}`,
        );

        if (updates.length > 0) {
          context.server.ws.send({
            type: 'custom',
            event: 'goldlight:hmr-update',
            data: {
              file: `/${relativePath}`,
              updates,
            },
          });
        }

        return [];
      },
    },
  ],
  build: {
    assetsInlineLimit: 0,
  },
  server: {
    host: '127.0.0.1',
    port: 9016,
    strictPort: false,
    fs: {
      allow: [resolve(import.meta.dirname, '..')],
    },
  },
});
