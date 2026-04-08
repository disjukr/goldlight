import { spawn } from 'node:child_process';
import { access, copyFile, cp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const electrobunDir = path.join(repoRoot, 'node_modules', 'electrobun');
const coreDistDir = path.join(electrobunDir, 'dist-win-x64');
const sharedDistDir = path.join(electrobunDir, 'dist');
const examplesAssetsDir = path.join(repoRoot, 'examples', 'assets');
const appName = 'goldlight';
const channel = 'dev';
const generatedEntrypointDir = path.join(repoRoot, '.goldlight', 'generated-entry');
const generatedEntrypointPath = path.join(generatedEntrypointDir, 'index.ts');
const textNativeModuleSource = path.join(repoRoot, 'engine', 'text', 'native', 'index.node');

const ELECTROBUN_VERSION = '1.0.0';
const requiredCoreFiles = [
  'bun.exe',
  'bspatch.exe',
  'launcher.exe',
  'libNativeWrapper.dll',
  'webgpu_dawn.dll',
  'WebView2Loader.dll',
  'd3dcompiler_47.dll',
  path.join('zig-asar', 'x64', 'libasar.dll'),
];

const ensureFile = async (filePath) => {
  await access(filePath, fsConstants.F_OK);
};

const getRequestedEntrypoint = () => {
  const requestedEntrypoint = process.env.GOLDLIGHT_ENTRYPOINT;
  if (!requestedEntrypoint) {
    throw new Error('Missing GOLDLIGHT_ENTRYPOINT');
  }

  const absoluteEntrypoint = path.resolve(repoRoot, requestedEntrypoint);
  const entryDir = path.dirname(absoluteEntrypoint);
  const bundleName = `${appName}-${channel}`;
  const buildRoot = path.join(entryDir, '.goldlight-build', 'dev-win-x64');
  const bundleRoot = path.join(buildRoot, bundleName);
  const bundleBinDir = path.join(bundleRoot, 'bin');
  const bundleResourcesDir = path.join(bundleRoot, 'Resources');
  const bundleAppDir = path.join(bundleResourcesDir, 'app');
  const bundleBunDir = path.join(bundleAppDir, 'bun');
  const textNativeModuleDestination = path.join(bundleBunDir, 'native', 'index.node');

  return {
    absoluteEntrypoint,
    buildRoot,
    bundleName,
    bundleRoot,
    bundleBinDir,
    bundleResourcesDir,
    bundleAppDir,
    bundleBunDir,
    textNativeModuleDestination,
  };
};

const runCommand = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: false,
      ...options,
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code ?? 'unknown'}`));
    });
    child.on('error', reject);
  });

const ensureElectrobunCore = async () => {
  const missing = [];
  for (const relativePath of requiredCoreFiles) {
    try {
      await ensureFile(path.join(coreDistDir, relativePath));
    } catch {
      missing.push(relativePath);
    }
  }

  await ensureFile(path.join(sharedDistDir, 'main.js'));

  if (missing.length === 0) {
    return;
  }

  const releaseUrl = `https://github.com/blackboardsh/electrobun/releases/download/v${ELECTROBUN_VERSION}/electrobun-core-win-x64.tar.gz`;
  const tarballPath = path.join(electrobunDir, `.goldlight-core-${Date.now()}.tar.gz`);
  console.log(`Downloading Electrobun core for win-x64 from ${releaseUrl}`);

  const response = await fetch(releaseUrl);
  if (!response.ok) {
    throw new Error(`Failed to download Electrobun core: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await writeFile(tarballPath, Buffer.from(arrayBuffer));
  await mkdir(coreDistDir, { recursive: true });
  await runCommand('tar', ['-xzf', tarballPath, '-C', coreDistDir], { cwd: repoRoot });
  await rm(tarballPath, { force: true });
};

const stopLingeringWindowsBuildProcesses = async (buildRoot) => {
  const buildRootPattern = buildRoot.replace(/\\/g, '\\\\');
  const legacyBuildRootPattern = path.join(repoRoot, 'build').replace(/\\/g, '\\\\');
  const coreDistPattern = coreDistDir.replace(/\\/g, '\\\\');

  await runCommand(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      [
        '$targets = Get-CimInstance Win32_Process | Where-Object {',
        `  $_.ExecutablePath -like '*${buildRootPattern}*' -or $_.ExecutablePath -like '*${legacyBuildRootPattern}*' -or $_.ExecutablePath -like '*${coreDistPattern}*'`,
        '};',
        'foreach ($target in $targets) {',
        '  try { Stop-Process -Id $target.ProcessId -Force -ErrorAction Stop } catch {}',
        '}',
      ].join(' '),
    ],
    { cwd: repoRoot },
  );
};

const ensureTextNativeModule = async () => {
  try {
    const nativeModuleStat = await stat(textNativeModuleSource);
    if (nativeModuleStat.isFile()) {
      return;
    }
  } catch {
    await runCommand('bun', ['run', 'build:text:native'], { cwd: repoRoot });
  }
};

const writeGeneratedEntrypoint = async (absoluteEntrypoint) => {
  const relativeImport = path
    .relative(generatedEntrypointDir, absoluteEntrypoint)
    .replace(/\\/g, '/')
    .replace(/^(?!\.)/, './');
  const source = `import '${relativeImport}';\n`;
  await mkdir(generatedEntrypointDir, { recursive: true });
  await writeFile(generatedEntrypointPath, source, 'utf8');
};

const createBundleLayout = async (runtimePaths) => {
  const { buildRoot, bundleBinDir, bundleResourcesDir, bundleName } = runtimePaths;
  await rm(buildRoot, { recursive: true, force: true });
  await mkdir(bundleBinDir, { recursive: true });
  await mkdir(bundleResourcesDir, { recursive: true });

  const filesToCopy = [
    ['launcher.exe', path.join(bundleBinDir, 'launcher.exe')],
    ['bun.exe', path.join(bundleBinDir, 'bun.exe')],
    ['bspatch.exe', path.join(bundleBinDir, 'bspatch.exe')],
    ['zig-zstd.exe', path.join(bundleBinDir, 'zig-zstd.exe')],
    ['libNativeWrapper.dll', path.join(bundleBinDir, 'libNativeWrapper.dll')],
    ['webgpu_dawn.dll', path.join(bundleBinDir, 'webgpu_dawn.dll')],
    ['WebView2Loader.dll', path.join(bundleBinDir, 'WebView2Loader.dll')],
    ['d3dcompiler_47.dll', path.join(bundleBinDir, 'd3dcompiler_47.dll')],
    [path.join('zig-asar', 'x64', 'libasar.dll'), path.join(bundleBinDir, 'libasar.dll')],
    [path.join('zig-asar', 'arm64', 'libasar.dll'), path.join(bundleBinDir, 'libasar-arm64.dll')],
  ];

  for (const [relativeSource, destination] of filesToCopy) {
    const source = path.join(coreDistDir, relativeSource);
    try {
      await ensureFile(source);
      await copyFile(source, destination);
    } catch {
      if (relativeSource.includes('arm64')) {
        continue;
      }
      throw new Error(`Missing Electrobun runtime file: ${source}`);
    }
  }

  await copyFile(path.join(sharedDistDir, 'main.js'), path.join(bundleResourcesDir, 'main.js'));
  await cp(examplesAssetsDir, path.join(bundleResourcesDir, 'assets'), { recursive: true });

  const versionJson = {
    version: '0.0.0',
    hash: 'dev',
    channel,
    baseUrl: '',
    name: bundleName,
    identifier: 'dev.disjukr.goldlight',
  };
  await writeFile(path.join(bundleResourcesDir, 'version.json'), JSON.stringify(versionJson));
  await writeFile(
    path.join(bundleResourcesDir, 'build.json'),
    JSON.stringify({
      defaultRenderer: 'native',
      availableRenderers: ['native'],
      runtime: {},
      bunVersion: process.versions.bun ?? 'unknown',
    }),
  );
};

const buildApp = async (runtimePaths) => {
  const { bundleBunDir, textNativeModuleDestination } = runtimePaths;
  await mkdir(bundleBunDir, { recursive: true });
  await runCommand(
    'bun',
    [
      'build',
      generatedEntrypointPath,
      '--outdir',
      bundleBunDir,
      '--target',
      'bun',
    ],
    { cwd: repoRoot },
  );
  await mkdir(path.dirname(textNativeModuleDestination), { recursive: true });
  await copyFile(textNativeModuleSource, textNativeModuleDestination);
};

const launchApp = async (runtimePaths) => {
  const { bundleBinDir } = runtimePaths;
  await runCommand(path.join(bundleBinDir, 'launcher.exe'), [], {
    cwd: bundleBinDir,
  });
};

const main = async () => {
  const runtimePaths = getRequestedEntrypoint();
  await ensureElectrobunCore();
  await ensureTextNativeModule();
  await writeGeneratedEntrypoint(runtimePaths.absoluteEntrypoint);
  await stopLingeringWindowsBuildProcesses(runtimePaths.buildRoot);
  await createBundleLayout(runtimePaths);
  await buildApp(runtimePaths);
  await launchApp(runtimePaths);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
