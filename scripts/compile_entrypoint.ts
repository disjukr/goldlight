import { exists } from '@std/fs';
import { basename, dirname, fromFileUrl, isAbsolute, join, resolve } from '@std/path';

import {
  type CompileFileManifest,
  resolveManifestPath,
  resolveManifestRelativeIncludes,
  resolveManifestRelativePath,
} from './compile_manifest.ts';

type DenoInfoModule = Readonly<{
  local?: string;
}>;

type DenoInfoJson = Readonly<{
  modules?: readonly DenoInfoModule[];
}>;

const repoRoot = join(dirname(fromFileUrl(import.meta.url)), '..');
const args = [...Deno.args];
const manifestPathArg = args.shift();

if (!manifestPathArg) {
  throw new Error(
    'Missing manifest directory. Usage: deno task compile <example-dir|goldlight.json> [additional deno compile args]',
  );
}
const releaseIndex = args.indexOf('--release');
const release = releaseIndex >= 0;
if (releaseIndex >= 0) {
  args.splice(releaseIndex, 1);
}
const buildMode = release ? 'release' : 'debug';

const hasExplicitOutput = args.some((arg, index) =>
  arg === '--output' || arg === '-o' || arg.startsWith('--output=') || (
    arg === '-o' && index + 1 < args.length
  )
);
const hasNoTerminal = args.includes('--no-terminal');

const normalizedManifestArg = manifestPathArg.replaceAll('\\', '/').replace(/^\.\//, '');
const normalizedManifestPath = normalizedManifestArg.endsWith('.json')
  ? normalizedManifestArg
  : join(normalizedManifestArg, 'goldlight.json').replaceAll('\\', '/');
const manifestAbsolutePath = resolveManifestPath(repoRoot, normalizedManifestPath);

const loadJson = async <T>(path: string): Promise<T> =>
  JSON.parse(await Deno.readTextFile(path)) as T;

if (!(await exists(manifestAbsolutePath))) {
  throw new Error(`Compile manifest does not exist: ${normalizedManifestPath}`);
}

const manifest = await loadJson<CompileFileManifest>(manifestAbsolutePath);
if (!manifest.entrypoint) {
  throw new Error(`Compile manifest is missing required "entrypoint": ${normalizedManifestPath}`);
}

const normalizedEntrypoint = resolveManifestRelativePath(
  repoRoot,
  normalizedManifestPath,
  manifest.entrypoint,
);

const inferOutputPath = (): string => {
  if (manifest.output) {
    return resolveManifestRelativePath(repoRoot, normalizedManifestPath, manifest.output);
  }

  const stem = basename(dirname(normalizedEntrypoint));
  const suffix = Deno.build.os === 'windows' ? '.exe' : '';
  return join(dirname(normalizedEntrypoint), `${stem}${suffix}`).replaceAll('\\', '/');
};

const runTask = async (task: string): Promise<void> => {
  const command = new Deno.Command(Deno.execPath(), {
    args: ['task', task],
    cwd: repoRoot,
    stdin: 'null',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const { code } = await command.output();
  if (code !== 0) {
    Deno.exit(code);
  }
};

const getDenoInfo = async (): Promise<DenoInfoJson> => {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      'info',
      '--json',
      '--no-lock',
      '--unstable-ffi',
      '--unstable-webgpu',
      '--unstable-raw-imports',
      normalizedEntrypoint,
    ],
    cwd: repoRoot,
    stdin: 'null',
    stdout: 'piped',
    stderr: 'inherit',
  });
  const { code, stdout } = await command.output();
  if (code !== 0) {
    Deno.exit(code);
  }
  return JSON.parse(new TextDecoder().decode(stdout)) as DenoInfoJson;
};

const getNativeLibraryIncludes = (localModulePaths: readonly string[]): readonly string[] => {
  const includes: string[] = [];
  const usesDesktopHost = localModulePaths.some((path) =>
    path.replaceAll('\\', '/').endsWith('/engine/desktop/ffi.ts')
  );
  const usesTextHost = localModulePaths.some((path) =>
    path.replaceAll('\\', '/').endsWith('/engine/text/ffi.ts')
  );

  if (usesDesktopHost) {
    includes.push(`engine/desktop/native/target/${buildMode}/goldlight_desktop_host.dll`);
  }
  if (usesTextHost) {
    includes.push(`engine/text/native/target/${buildMode}/goldlight_text_host.dll`);
  }

  return includes;
};

const getCommonWorkerIncludes = (localModulePaths: readonly string[]): readonly string[] => {
  const usesDesktopApp = localModulePaths.some((path) =>
    path.replaceAll('\\', '/').endsWith('/engine/desktop/app.ts')
  );

  if (!usesDesktopApp) {
    return [];
  }

  return [
    'engine/desktop/window_manager_worker.ts',
    'engine/desktop/worker_module.ts',
  ];
};

const getNativeBuildTasks = (localModulePaths: readonly string[]): readonly string[] => {
  const tasks: string[] = [];
  const usesDesktopHost = localModulePaths.some((path) =>
    path.replaceAll('\\', '/').endsWith('/engine/desktop/ffi.ts')
  );
  const usesTextHost = localModulePaths.some((path) =>
    path.replaceAll('\\', '/').endsWith('/engine/text/ffi.ts')
  );

  if (usesDesktopHost) {
    tasks.push(`desktop:host:build${buildMode === 'release' ? ':release' : ''}`);
  }
  if (usesTextHost) {
    tasks.push(`text:host:build${buildMode === 'release' ? ':release' : ''}`);
  }

  return tasks;
};

const denoInfo = await getDenoInfo();
const localModulePaths = (denoInfo.modules ?? [])
  .map((module) => module.local)
  .filter((path): path is string => Boolean(path && isAbsolute(path)));
const manifestIncludes = resolveManifestRelativeIncludes(
  repoRoot,
  normalizedManifestPath,
  manifest.includes ?? [],
);

const buildTasks = [
  ...getNativeBuildTasks(localModulePaths),
  ...(manifest.buildTasks ?? []),
];
const includes = [
  ...new Set([
    ...getCommonWorkerIncludes(localModulePaths),
    ...getNativeLibraryIncludes(localModulePaths),
    ...manifestIncludes,
  ]),
];

for (const task of buildTasks) {
  await runTask(task);
}

for (const includePath of includes) {
  const absolutePath = resolve(repoRoot, includePath);
  if (!(await exists(absolutePath))) {
    throw new Error(`Compile include does not exist: ${includePath}`);
  }
}

const compileArgs = [
  'compile',
  '-A',
  '--no-lock',
  '--unstable-ffi',
  '--unstable-webgpu',
  '--unstable-raw-imports',
  '--no-check',
  ...(release && Deno.build.os === 'windows' && !hasNoTerminal ? ['--no-terminal'] : []),
  ...(!hasExplicitOutput ? ['--output', inferOutputPath()] : []),
  ...includes.flatMap((includePath) => ['--include', includePath]),
  ...args,
  normalizedEntrypoint,
];

const command = new Deno.Command(Deno.execPath(), {
  args: compileArgs,
  cwd: repoRoot,
  stdin: 'null',
  stdout: 'inherit',
  stderr: 'inherit',
});
const { code } = await command.output();
if (code !== 0) {
  Deno.exit(code);
}
