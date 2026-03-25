import { fromFileUrl, join } from '@std/path';

type Action = 'check' | 'png' | 'ckpng';

type ExampleEntry = Readonly<{
  id: string;
  dir: string;
  hasCanvasKit: boolean;
  aliases: readonly string[];
}>;

const repoRoot = fromFileUrl(new URL('../', import.meta.url));
const drawingExamplesRoot = join(repoRoot, 'packages', 'drawing', 'examples');

const fileExists = async (path: string): Promise<boolean> => {
  try {
    return (await Deno.stat(path)).isFile;
  } catch {
    return false;
  }
};

const normalizeExampleId = (name: string): string => name.replaceAll('_', '-');

const discoverExamples = async (): Promise<ExampleEntry[]> => {
  const entries: ExampleEntry[] = [];

  for await (const entry of Deno.readDir(drawingExamplesRoot)) {
    if (!entry.isDirectory) {
      continue;
    }

    const dir = join(drawingExamplesRoot, entry.name);
    if (entry.name === 'gm') {
      for await (const gmEntry of Deno.readDir(dir)) {
        if (!gmEntry.isDirectory) {
          continue;
        }
        const gmDir = join(dir, gmEntry.name);
        if (!await fileExists(join(gmDir, 'main.ts'))) {
          continue;
        }
        const id = `gm/${normalizeExampleId(gmEntry.name)}`;
        entries.push({
          id,
          dir: gmDir,
          hasCanvasKit: await fileExists(join(gmDir, 'canvaskit_main.ts')),
          aliases: [normalizeExampleId(gmEntry.name)],
        });
      }
      continue;
    }

    if (!entry.name.startsWith('render_')) {
      continue;
    }

    if (!await fileExists(join(dir, 'main.ts'))) {
      continue;
    }

    const rawName = entry.name.slice('render_'.length);
    const normalizedName = normalizeExampleId(rawName);
    const aliases = [normalizedName];
    if (rawName === 'tiger_png') {
      aliases.push('tiger');
    }

    entries.push({
      id: normalizedName,
      dir,
      hasCanvasKit: await fileExists(join(dir, 'canvaskit_main.ts')),
      aliases,
    });
  }

  entries.sort((left, right) => left.id.localeCompare(right.id));
  return entries;
};

const printUsage = (examples: readonly ExampleEntry[]): void => {
  console.error('usage: deno task example:drawing -- <example|all> <check|png|ckpng>');
  console.error('');
  console.error('examples:');
  for (const example of examples) {
    const canvasKitSuffix = example.hasCanvasKit ? '' : ' (no ckpng)';
    console.error(`  ${example.id}${canvasKitSuffix}`);
  }
};

const resolveExample = (
  examples: readonly ExampleEntry[],
  query: string,
): ExampleEntry | undefined => {
  return examples.find((example) => example.id === query || example.aliases.includes(query));
};

const runExample = async (example: ExampleEntry, action: Action): Promise<number> => {
  const targetFile = action === 'ckpng' ? 'canvaskit_main.ts' : 'main.ts';
  const targetPath = join(example.dir, targetFile);
  if (!await fileExists(targetPath)) {
    console.error(`example "${example.id}" does not support action "${action}"`);
    return 1;
  }

  const denoArgs = [action === 'check' ? 'check' : 'run'];
  if (action !== 'check') {
    denoArgs.push('-A');
  }
  denoArgs.push('--unstable-raw-imports');
  if (action !== 'ckpng') {
    denoArgs.push('--unstable-webgpu');
  }
  denoArgs.push(targetPath);

  const command = new Deno.Command(Deno.execPath(), {
    args: denoArgs,
    cwd: repoRoot,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const result = await command.output();
  return result.code;
};

const cliArgs = Deno.args[0] === '--' ? Deno.args.slice(1) : Deno.args;
const actionArg = cliArgs[1];
const exampleArg = cliArgs[0];

if (!exampleArg || !actionArg) {
  const examples = await discoverExamples();
  printUsage(examples);
  Deno.exit(1);
}

if (actionArg !== 'check' && actionArg !== 'png' && actionArg !== 'ckpng') {
  const examples = await discoverExamples();
  printUsage(examples);
  Deno.exit(1);
}

const examples = await discoverExamples();
const action = actionArg as Action;

if (exampleArg === 'all') {
  for (const example of examples) {
    if (action === 'ckpng' && !example.hasCanvasKit) {
      continue;
    }
    console.log(`==> ${example.id} ${action}`);
    const code = await runExample(example, action);
    if (code !== 0) {
      Deno.exit(code);
    }
  }
  Deno.exit(0);
}

const example = resolveExample(examples, exampleArg);
if (!example) {
  printUsage(examples);
  Deno.exit(1);
}

Deno.exit(await runExample(example, action));
