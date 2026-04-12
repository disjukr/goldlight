#!/usr/bin/env bun

import { spawn } from 'bun';
import { build as viteBuild, createServer as createViteServer, mergeConfig } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface GoldlightProjectConfig {
  entrypoint: string;
}

interface GoldlightAppManifest {
  entrypoint: string;
}

interface InspectorTargetInfo {
  title?: string;
  devtoolsFrontendUrl?: string;
  webSocketDebuggerUrl?: string;
}

const sdkDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(sdkDir, '..');
const viteDevServerHost = '127.0.0.1';
const viteDefaultPort = 9016;
const inspectorDefaultPort = 9229;
const GOLDLIGHT_BANNER = [
  '             _     _ _ _       _     _',
  '  __ _  ___ | | __| | (_) __ _| |__ | |_',
  " / _` |/ _ \\| |/ _` | | |/ _` | '_ \\| __|",
  '| (_| | (_) | | (_| | | | (_| | | | | |_',
  ' \\__, |\\___/|_|\\__,_|_|_|\\__, |_| |_|\\__|',
  ' |___/                    |___/',
].join('\n');

const ANSI = {
  reset: '\x1b[0m',
  brightWhite: '\x1b[97m',
  brightMagenta: '\x1b[95m',
  brightYellow: '\x1b[93m',
  yellow: '\x1b[33m',
  dim: '\x1b[2m',
} as const;

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

function clearTerminalIfInteractive() {
  if (!process.stdout.isTTY) {
    return;
  }

  process.stdout.write('\x1Bc');
}

function supportsColor() {
  return process.stdout.isTTY;
}

function colorize(text: string, color: string) {
  if (!supportsColor()) {
    return text;
  }

  return `${color}${text}${ANSI.reset}`;
}

function formatBanner() {
  if (!supportsColor()) {
    return GOLDLIGHT_BANNER;
  }

  const lines = GOLDLIGHT_BANNER.split('\n');
  return lines
    .map((line, index) => {
      const color =
        index < 2
          ? ANSI.brightMagenta
          : index < 4
            ? ANSI.brightYellow
            : ANSI.brightWhite;
      return `${color}${line}${ANSI.reset}`;
    })
    .join('\n');
}

function formatDevLine(line: string) {
  const separatorIndex = line.indexOf(': ');
  if (separatorIndex === -1) {
    return line;
  }

  const label = line.slice(0, separatorIndex + 1);
  const value = line.slice(separatorIndex + 2);
  return `${colorize(label, ANSI.brightMagenta)} ${colorize(value, ANSI.brightYellow)}`;
}

function formatDisplayPath(path: string) {
  const homePath = resolve(homedir());
  const relativePath = relative(homePath, path);
  const isInsideHome =
    relativePath === '' ||
    (!relativePath.startsWith('..') && !isAbsolute(relativePath));
  if (!isInsideHome) return path;
  if (!relativePath) return '~';
  return `~/${relativePath.replaceAll('\\', '/')}`;
}

function printDevHeader(lines: string[]) {
  console.log(formatBanner());
  console.log('');
  for (const line of lines) {
    console.log(formatDevLine(line));
  }
  console.log('');
}

function cargoColorEnv() {
  if (process.env.CARGO_TERM_COLOR) {
    return process.env.CARGO_TERM_COLOR;
  }

  return process.stdout.isTTY ? 'always' : 'never';
}

async function runCommand(
  command: string[],
  cwd: string,
  extraEnv: Record<string, string> = {},
) {
  const child = spawn(command, {
    cwd,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      ...extraEnv,
    },
  });

  const exitCode = await child.exited;
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
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
  const command = [resolve(distRoot, runtimeBinaryName()), '--bundle-root', distRoot];

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
  const manifestPath = resolve(distRoot, 'goldlight.manifest.json');
  const runtimeBuildName =
    process.platform === 'win32' ? 'goldlight-runtime-prod.exe' : 'goldlight-runtime-prod';
  const runtimeSource = resolve(repoRoot, 'target', 'release', runtimeBuildName);
  const runtimeTarget = resolve(distRoot, runtimeBinaryName());
  const { default: baseConfig } = await import('../vite.config.ts');

  await runCommand(
    ['cargo', 'build', '-p', 'goldlight-runtime', '--bin', 'goldlight-runtime-prod', '--release'],
    repoRoot,
    { CARGO_TERM_COLOR: cargoColorEnv() },
  );

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
  await Bun.write(
    manifestPath,
    JSON.stringify(
      {
        entrypoint: 'app/main.js',
      } satisfies GoldlightAppManifest,
      null,
      2,
    ) + '\n',
  );
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

async function fetchInspectorTargets(url: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as InspectorTargetInfo[];
    return Array.isArray(payload) && payload.length > 0 ? payload : null;
  } catch {
    return null;
  }
}

function inspectorLines(
  projectRoot: string,
  devServerOrigin: string,
  inspectorTargets: InspectorTargetInfo[] | null,
) {
  const lines = [
    `cwd: ${formatDisplayPath(projectRoot)}`,
    `dev server: ${devServerOrigin}`,
  ];
  if (inspectorTargets?.length) {
    const mainTarget =
      inspectorTargets.find((target) => target.title === 'main' && target.devtoolsFrontendUrl) ??
      inspectorTargets.find((target) => target.devtoolsFrontendUrl);
    if (mainTarget?.devtoolsFrontendUrl) {
      lines.push(`devtools: ${mainTarget.devtoolsFrontendUrl}`);
    } else {
      lines.push('devtools: starting...');
    }
  } else {
    lines.push('devtools: starting...');
  }

  return lines;
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

async function pickAvailablePort(startPort: number) {
  for (let port = startPort; port < startPort + 20; port += 1) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }

  throw new Error(`Could not find an available port starting at ${startPort}`);
}

async function devProject() {
  const projectRoot = currentProjectRoot();
  const projectConfig = loadProjectConfig(projectRoot);
  const normalizedEntrypoint = projectConfig.entrypoint.replaceAll('\\', '/');
  const { default: baseConfig } = await import('../vite.config.ts');
  const port = await pickAvailablePort(viteDefaultPort);
  const inspectorPort = await pickAvailablePort(inspectorDefaultPort);
  const inspectorAddress = `${viteDevServerHost}:${inspectorPort}`;
  const runtimeBuildName =
    process.platform === 'win32' ? 'goldlight-runtime-dev.exe' : 'goldlight-runtime-dev';
  const runtimeBinary = resolve(repoRoot, 'target', 'debug', runtimeBuildName);

  console.log('building goldlight runtime...');
  await runCommand(
    ['cargo', 'build', '-p', 'goldlight-runtime', '--bin', 'goldlight-runtime-dev', '--features', 'dev-runtime'],
    repoRoot,
    { CARGO_TERM_COLOR: cargoColorEnv() },
  );
  clearTerminalIfInteractive();

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
  const inspectorListUrl = `http://${inspectorAddress}/json/list`;

  try {
    await waitForServer(devEntrypointUrl);
  } catch (error) {
    await server.close();
    throw error;
  }

  let exitCode = 0;
  let shouldRestart = false;

  do {
    shouldRestart = false;
    let lastInspectorSignature = '';
    let keepWatchingInspector = true;
    const renderInspectorTargets = (inspectorTargets: InspectorTargetInfo[] | null) => {
      const signature = JSON.stringify(inspectorTargets ?? []);
      if (signature === lastInspectorSignature) {
        return;
      }
      lastInspectorSignature = signature;
      clearTerminalIfInteractive();
      printDevHeader(inspectorLines(projectRoot, devServerOrigin, inspectorTargets));
    };

    renderInspectorTargets(null);

    const runtime = spawn(
      [
        runtimeBinary,
        '--vite',
        devServerOrigin,
        '--inspect',
        inspectorAddress,
        normalizedEntrypoint,
      ],
      {
        cwd: projectRoot,
        env: process.env,
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
      },
    );

    const inspectorWatcher = (async () => {
      for (let index = 0; index < 100; index += 1) {
        if (!keepWatchingInspector) {
          return;
        }
        const inspectorTargets = await fetchInspectorTargets(inspectorListUrl);
        if (inspectorTargets) {
          renderInspectorTargets(inspectorTargets);
          if (inspectorTargets.some((target) => (target.title ?? '').startsWith('window-'))) {
            return;
          }
        }
        await Bun.sleep(100);
      }
    })();

    exitCode = await runtime.exited;
    keepWatchingInspector = false;
    await inspectorWatcher;
    shouldRestart = exitCode === 75;
  } while (shouldRestart);

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
