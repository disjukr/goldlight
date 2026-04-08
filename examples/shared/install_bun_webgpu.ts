import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let installed = false;

export const installBunWebGpu = async (): Promise<void> => {
  if (installed) {
    return;
  }

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(currentDir, '..', '..');
  const runtimeBinDir = path.join(repoRoot, '.goldlight', 'runtime', 'bin');
  const runtimeResourcesDir = path.join(repoRoot, '.goldlight', 'runtime', 'Resources');
  const electrobunDistDir = path.join(repoRoot, 'node_modules', 'electrobun', 'dist-win-x64');
  mkdirSync(runtimeBinDir, { recursive: true });
  mkdirSync(runtimeResourcesDir, { recursive: true });
  for (const dllName of [
    'libNativeWrapper.dll',
    'webgpu_dawn.dll',
    'WebView2Loader.dll',
    'd3dcompiler_47.dll',
  ]) {
    const sourcePath = path.join(electrobunDistDir, dllName);
    const destinationPath = path.join(runtimeBinDir, dllName);
    if (existsSync(sourcePath) && !existsSync(destinationPath)) {
      try {
        copyFileSync(sourcePath, destinationPath);
      } catch (error) {
        if (!existsSync(destinationPath)) {
          throw error;
        }
      }
    }
  }
  writeFileSync(
    path.join(runtimeResourcesDir, 'version.json'),
    JSON.stringify({
      version: '0.0.0',
      hash: 'dev',
      channel: 'dev',
      baseUrl: '',
      name: 'goldlight-dev',
      identifier: 'dev.disjukr.goldlight',
    }),
    'utf8',
  );

  if (process.cwd() !== runtimeBinDir) {
    process.chdir(runtimeBinDir);
  }

  process.env.ELECTROBUN_WGPU_PATH ??= path.join(
    runtimeBinDir,
    'webgpu_dawn.dll',
  );
  const { webgpu } = await import('electrobun/bun');
  webgpu.install();
  installed = true;
};
