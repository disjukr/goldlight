#!/usr/bin/env bun

import { spawn } from 'bun';
import { build as viteBuild, createServer as createViteServer, mergeConfig } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface GoldlightProjectConfig {
  entrypoint: string;
}

const sdkDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(sdkDir, '..');
const viteDevServerHost = '127.0.0.1';
const viteDefaultPort = 9016;

function printHelp() {
  console.log(`goldlight

Usage:
  goldlight run
  goldlight dev
  goldlight build

Commands:
  run    Run the built production app for the current project
  dev    Read ./goldlight.json and run the project with Vite + the dev runtime
  build  Read ./goldlight.json and build into dist/<target-os>
`);
}

function currentTargetOsDir() {
  switch (process.platform) {
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'macos';
    default:
      return 'linux';
  }
}

function runtimeBinaryName() {
  return process.platform === 'win32' ? 'goldlight.exe' : 'goldlight';
}

function currentProjectRoot() {
  const candidates = [
    process.env.PWD,
    process.env.INIT_CWD,
    process.cwd(),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    let current = resolve(candidate);

    while (true) {
      if (existsSync(resolve(current, 'goldlight.json'))) {
        return current;
      }

      const parent = dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }

  return process.env.PWD ?? process.env.INIT_CWD ?? process.cwd();
}

function loadProjectConfig(projectRoot: string): GoldlightProjectConfig {
  const configPath = resolve(projectRoot, 'goldlight.json');
  const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as Partial<GoldlightProjectConfig>;

  if (!parsed.entrypoint || typeof parsed.entrypoint !== 'string') {
    throw new Error(`Invalid goldlight.json: missing string "entrypoint" in ${configPath}`);
  }

  return {
    entrypoint: parsed.entrypoint,
  };
}

async function runProject() {
  const projectRoot = currentProjectRoot();
  const distRoot = resolve(projectRoot, 'dist', currentTargetOsDir());
  const command = [resolve(distRoot, runtimeBinaryName())];

  const child = spawn(command, {
    cwd: distRoot,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });

  const exitCode = await child.exited;
  process.exit(exitCode);
}

async function buildProject() {
  const projectRoot = currentProjectRoot();
  const projectConfig = loadProjectConfig(projectRoot);
  const targetOsDir = currentTargetOsDir();
  const distRoot = resolve(projectRoot, 'dist', targetOsDir);
  const distAppRoot = resolve(distRoot, 'app');
  const runtimeBuildName =
    process.platform === 'win32' ? 'goldlight-runtime-prod.exe' : 'goldlight-runtime-prod';
  const runtimeSource = resolve(repoRoot, 'target', 'release', runtimeBuildName);
  const runtimeTarget = resolve(distRoot, runtimeBinaryName());
  const { default: baseConfig } = await import('../vite.config.ts');

  await Bun.$`cargo build -p goldlight-runtime --bin goldlight-runtime-prod --release`.cwd(repoRoot);

  await viteBuild(
    mergeConfig(baseConfig, {
      configFile: false,
      root: projectRoot,
      build: {
        copyPublicDir: false,
        emptyOutDir: true,
        outDir: distAppRoot,
        rollupOptions: {
          input: resolve(projectRoot, projectConfig.entrypoint),
          output: {
            entryFileNames: 'main.js',
            chunkFileNames: 'chunks/[name]-[hash].js',
            assetFileNames: 'assets/[name]-[hash][extname]',
          },
        },
      },
    }),
  );

  await Bun.write(runtimeTarget, Bun.file(runtimeSource));
  console.log(`Built goldlight app at ${join('dist', targetOsDir)}`);
}

async function waitForServer(url: string) {
  for (let index = 0; index < 100; index += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still booting.
    }

    await Bun.sleep(100);
  }

  throw new Error(`Timed out waiting for dev server: ${url}`);
}

async function isPortAvailable(port: number) {
  return await new Promise<boolean>((resolveAvailability) => {
    const server = createNetServer();

    server.once('error', () => {
      resolveAvailability(false);
    });

    server.once('listening', () => {
      server.close(() => resolveAvailability(true));
    });

    server.listen(port, viteDevServerHost);
  });
}

async function pickDevPort() {
  for (let port = viteDefaultPort; port < viteDefaultPort + 20; port += 1) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }

  throw new Error(`Could not find an available dev port starting at ${viteDefaultPort}`);
}

async function devProject() {
  const projectRoot = currentProjectRoot();
  const projectConfig = loadProjectConfig(projectRoot);
  const normalizedEntrypoint = projectConfig.entrypoint.replaceAll('\\', '/');
  const { default: baseConfig } = await import('../vite.config.ts');
  const port = await pickDevPort();

  const server = await createViteServer(
    mergeConfig(baseConfig, {
      configFile: false,
      root: projectRoot,
      server: {
        host: viteDevServerHost,
        port,
        strictPort: true,
        fs: {
          allow: [projectRoot, repoRoot],
        },
      },
    }),
  );

  await server.listen();
  const devServerOrigin = `http://${viteDevServerHost}:${port}`;
  const devEntrypointUrl = `${devServerOrigin}/${normalizedEntrypoint}`;

  try {
    await waitForServer(devEntrypointUrl);
  } catch (error) {
    await server.close();
    throw error;
  }

  const runtime = spawn(
    [
      'cargo',
      'run',
      '-p',
      'goldlight-runtime',
      '--bin',
      'goldlight-runtime-dev',
      '--',
      '--vite',
      devServerOrigin,
      normalizedEntrypoint,
    ],
    {
      cwd: projectRoot,
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    },
  );

  const exitCode = await runtime.exited;
  await server.close();
  process.exit(exitCode);
}

const [, , command] = process.argv;

switch (command) {
  case undefined:
  case 'help':
  case '--help':
  case '-h':
    printHelp();
    break;
  case 'run':
    await runProject();
    break;
  case 'dev':
    await devProject();
    break;
  case 'build':
    await buildProject();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
}
