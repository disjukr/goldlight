import { emptyDir, ensureDir } from '@std/fs';
import { dirname, fromFileUrl, join, resolve } from '@std/path';

type AssetTarget = 'stanford-bunny' | 'damaged-helmet' | 'sponza' | 'hdri';

const repoRoot = resolve(dirname(fromFileUrl(import.meta.url)), '..');
const includedAssetsRoot = join(repoRoot, 'examples', 'assets');

const assetTargets = new Set<AssetTarget>(['stanford-bunny', 'damaged-helmet', 'sponza', 'hdri']);

const parseTargets = (args: readonly string[]): AssetTarget[] => {
  if (args.length === 0 || args.includes('included')) {
    return ['stanford-bunny', 'damaged-helmet', 'hdri'];
  }

  if (args.includes('all')) {
    return ['stanford-bunny', 'damaged-helmet', 'sponza', 'hdri'];
  }

  const targets = args.filter((arg): arg is AssetTarget => assetTargets.has(arg as AssetTarget));
  if (targets.length === 0) {
    throw new Error(
      'usage: deno run -A ./scripts/fetch_example_asset.ts [included|all|stanford-bunny|damaged-helmet|sponza|hdri]',
    );
  }

  return targets;
};

const downloadToFile = async (url: string, destinationPath: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to download "${url}" (${response.status})`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  await ensureDir(dirname(destinationPath));
  await Deno.writeFile(destinationPath, bytes);
  console.log(`downloaded ${url} -> ${destinationPath}`);
};

const runTar = async (args: readonly string[]) => {
  const command = new Deno.Command('tar', {
    args: [...args],
    stdout: 'piped',
    stderr: 'piped',
  });
  const { code, stderr } = await command.output();
  if (code !== 0) {
    throw new Error(`tar failed: ${new TextDecoder().decode(stderr).trim()}`);
  }
};

const fetchStanfordBunny = async () => {
  const assetRoot = join(includedAssetsRoot, 'stanford-bunny');
  const downloadRoot = join(repoRoot, '.tmp', 'example-assets', 'stanford-bunny');
  const archivePath = join(downloadRoot, 'bunny.tar.gz');
  const extractRoot = join(downloadRoot, 'extract');
  const sourceUrl = 'https://graphics.stanford.edu/pub/3Dscanrep/bunny.tar.gz';

  await ensureDir(downloadRoot);
  await emptyDir(extractRoot);
  await downloadToFile(sourceUrl, archivePath);
  await runTar(['-xzf', archivePath, '-C', extractRoot]);

  const extractedRoot = join(extractRoot, 'bunny');
  await Deno.copyFile(
    join(extractedRoot, 'reconstruction', 'bun_zipper.ply'),
    join(assetRoot, 'bun_zipper.ply'),
  );
  await Deno.remove(downloadRoot, { recursive: true });
};

const fetchDamagedHelmet = async () => {
  await downloadToFile(
    'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/DamagedHelmet/glTF-Binary/DamagedHelmet.glb',
    join(includedAssetsRoot, 'damaged-helmet', 'DamagedHelmet.glb'),
  );
};

const collectExternalUris = (gltfJson: unknown): string[] => {
  if (!gltfJson || typeof gltfJson !== 'object') {
    return [];
  }

  const buffers = Array.isArray((gltfJson as { buffers?: unknown }).buffers)
    ? (gltfJson as { buffers: Array<{ uri?: unknown }> }).buffers
    : [];
  const images = Array.isArray((gltfJson as { images?: unknown }).images)
    ? (gltfJson as { images: Array<{ uri?: unknown }> }).images
    : [];

  const uris = new Set<string>();
  for (const entry of [...buffers, ...images]) {
    if (typeof entry.uri === 'string' && entry.uri.length > 0 && !entry.uri.startsWith('data:')) {
      uris.add(entry.uri);
    }
  }

  return [...uris];
};

const fetchSponza = async () => {
  const assetRoot = join(includedAssetsRoot, 'sponza');
  const baseUrl =
    'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/Sponza/glTF/';
  const gltfUrl = new URL('Sponza.gltf', baseUrl).toString();
  const gltfPath = join(assetRoot, 'Sponza.gltf');

  await ensureDir(assetRoot);
  await downloadToFile(gltfUrl, gltfPath);

  const gltfText = await Deno.readTextFile(gltfPath);
  const gltfJson = JSON.parse(gltfText);
  for (const uri of collectExternalUris(gltfJson)) {
    const resourceUrl = new URL(uri, baseUrl).toString();
    await downloadToFile(resourceUrl, join(assetRoot, uri));
  }
};

const fetchHdriSamples = async () => {
  const assetRoot = join(includedAssetsRoot, 'hdri');
  await ensureDir(assetRoot);

  const downloads = [
    {
      url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/exr/1k/poly_haven_studio_1k.exr',
      path: join(assetRoot, 'poly_haven_studio_1k.exr'),
    },
    {
      url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/exr/1k/ferndale_studio_08_1k.exr',
      path: join(assetRoot, 'ferndale_studio_08_1k.exr'),
    },
    {
      url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/exr/1k/pav_studio_01_1k.exr',
      path: join(assetRoot, 'pav_studio_01_1k.exr'),
    },
  ] as const;

  for (const download of downloads) {
    await downloadToFile(download.url, download.path);
  }
};

const targets = parseTargets(Deno.args);
for (const target of targets) {
  switch (target) {
    case 'stanford-bunny':
      await fetchStanfordBunny();
      break;
    case 'damaged-helmet':
      await fetchDamagedHelmet();
      break;
    case 'sponza':
      await fetchSponza();
      break;
    case 'hdri':
      await fetchHdriSamples();
      break;
  }
}
