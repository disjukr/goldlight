import { dirname, join, relative, resolve } from '@std/path';

export type CompileFileManifest = Readonly<{
  entrypoint: string;
  output?: string;
  includes?: readonly string[];
  buildTasks?: readonly string[];
}>;

export const resolveManifestPath = (repoRoot: string, manifestPath: string): string =>
  resolve(repoRoot, manifestPath);

export const toRepoRelativePath = (repoRoot: string, absolutePath: string): string | null => {
  const relativePath = relative(repoRoot, resolve(absolutePath));
  if (relativePath.startsWith('..')) {
    return null;
  }
  return relativePath.replaceAll('\\', '/');
};

export const resolveManifestRelativePath = (
  repoRoot: string,
  manifestPath: string,
  targetPath: string,
): string => {
  const manifestDir = dirname(resolveManifestPath(repoRoot, manifestPath));
  const resolvedTarget = resolve(manifestDir, targetPath);
  const repoRelativePath = toRepoRelativePath(repoRoot, resolvedTarget);
  if (!repoRelativePath) {
    throw new Error(`Manifest path escapes repository root: ${targetPath}`);
  }
  return repoRelativePath;
};

export const resolveManifestRelativeIncludes = (
  repoRoot: string,
  manifestPath: string,
  includes: readonly string[],
): readonly string[] =>
  includes.map((includePath) => resolveManifestRelativePath(repoRoot, manifestPath, includePath));

export const inferDefaultManifestPath = (entrypointOrDir: string): string =>
  join(entrypointOrDir, 'goldlight.json').replaceAll('\\', '/');
