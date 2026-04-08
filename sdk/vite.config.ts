import { defineConfig, normalizePath } from 'vite';
import { relative, resolve } from 'node:path';

const GOLDLIGHT_RUNTIME_MODULE_ID = '\0goldlight-runtime';
const GOLDLIGHT_WORKER_QUERY = '?goldlight-worker-url';
const GOLDLIGHT_RUNTIME_MODULE_SOURCE = `
function normalizeWindowOptions(options = {}) {
  const {
    title = "goldlight window",
    width = 640,
    height = 480,
    workerEntrypoint = undefined,
  } = options;

  return { title, width, height, workerEntrypoint };
}

export function createWindow(options = {}) {
  return Deno.core.ops.op_goldlight_create_window(normalizeWindowOptions(options));
}
`;

let isBuild = false;
let devServerOrigin = 'http://127.0.0.1:9016';

export default defineConfig({
  root: resolve(import.meta.dirname, '..'),
  plugins: [
    {
      name: 'goldlight-runtime-module',
      enforce: 'pre',
      resolveId(source) {
        if (source === 'goldlight') {
          return GOLDLIGHT_RUNTIME_MODULE_ID;
        }

        return null;
      },
      load(id) {
        if (id === GOLDLIGHT_RUNTIME_MODULE_ID) {
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

        const relativeWorkerUrl = normalizePath(relative(resolve(import.meta.dirname, '..'), workerId));
        return `export default ${JSON.stringify(`${devServerOrigin}/${relativeWorkerUrl}`)};`;
      },
      resolveFileUrl({ fileName }) {
        return JSON.stringify(`./${normalizePath(fileName)}`);
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
