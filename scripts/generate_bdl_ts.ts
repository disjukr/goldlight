import { walk } from '@std/fs';
import { dirname, fromFileUrl, join, relative } from '@std/path';
import { buildIr } from 'jsr:@disjukr/bdl@0.8.3/io/ir';
import type * as bdlIr from 'jsr:@disjukr/bdl@0.8.3/ir';

const generatedHeader =
  `// This file is generated from BDL IR.\n// Run \`deno task generate:ir\` to regenerate it.\n`;

const configPath = join(dirname(fromFileUrl(import.meta.url)), '..', 'bdl.yaml');
const outputRoot = join(
  dirname(fromFileUrl(import.meta.url)),
  '..',
  'packages',
  'ir',
  'src',
  'generated',
);

const primitiveTypeMap: Record<string, string> = {
  boolean: 'boolean',
  int32: 'number',
  int64: 'bigint',
  integer: 'bigint',
  float64: 'number',
  string: 'string',
  bytes: 'Uint8Array',
  object: 'Record<string, unknown>',
  void: 'void',
};

const checkOnly = Deno.args.includes('--check');
const { ir } = await buildIr({
  config: configPath,
  standard: 'conventional',
});
const expectedOutputs = createExpectedOutputs(ir);

if (checkOnly) {
  const issues = await collectGenerationIssues(expectedOutputs);
  if (issues.length > 0) {
    console.error('BDL generated files are out of date.');
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    console.error('Run `deno task generate:ir` to regenerate them.');
    Deno.exit(1);
  }
} else {
  await writeGeneratedOutputs(expectedOutputs);
}

type GeneratedOutput = Readonly<{
  relativePath: string;
  absolutePath: string;
  source: string;
}>;

function createExpectedOutputs(ir: bdlIr.BdlIr): readonly GeneratedOutput[] {
  return Object.entries(ir.modules).map(([modulePath, module]) => {
    const relativePath = `${modulePath.split('.').slice(1).join('/')}.generated.ts`;
    return {
      relativePath: relativePath.replaceAll('\\', '/'),
      absolutePath: join(outputRoot, relativePath),
      source: generateModuleSource(ir, modulePath, module),
    };
  });
}

async function writeGeneratedOutputs(outputs: readonly GeneratedOutput[]): Promise<void> {
  const expectedPaths = new Set(outputs.map((output) => output.absolutePath));
  const existingPaths = await listGeneratedFiles();

  for (const existingPath of existingPaths) {
    if (!expectedPaths.has(existingPath)) {
      await Deno.remove(existingPath);
    }
  }

  for (const output of outputs) {
    await Deno.mkdir(dirname(output.absolutePath), { recursive: true });
    await Deno.writeTextFile(output.absolutePath, output.source);
  }
}

async function collectGenerationIssues(outputs: readonly GeneratedOutput[]): Promise<string[]> {
  const issues: string[] = [];
  const expectedByPath = new Map(outputs.map((output) => [output.absolutePath, output]));
  const existingPaths = await listGeneratedFiles();

  for (const output of outputs) {
    let actualSource: string;
    try {
      actualSource = await Deno.readTextFile(output.absolutePath);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        issues.push(`missing generated file: ${output.relativePath}`);
        continue;
      }
      throw error;
    }

    if (actualSource !== output.source) {
      issues.push(`generated file differs: ${output.relativePath}`);
    }
  }

  for (const existingPath of existingPaths) {
    if (!expectedByPath.has(existingPath)) {
      issues.push(
        `stale generated file: ${relative(outputRoot, existingPath).replaceAll('\\', '/')}`,
      );
    }
  }

  return issues;
}

async function listGeneratedFiles(): Promise<readonly string[]> {
  const paths: string[] = [];

  try {
    for await (
      const entry of walk(outputRoot, {
        includeDirs: false,
        exts: ['.ts'],
      })
    ) {
      paths.push(entry.path);
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }

  return paths;
}

function generateModuleSource(
  ir: bdlIr.BdlIr,
  modulePath: string,
  module: bdlIr.Module,
): string {
  const lines: string[] = [generatedHeader];
  const currentFile = modulePathToOutputPath(modulePath);
  const importLines = module.imports.map((entry) => {
    const names = entry.items.map((item) => item.as ?? item.name).join(', ');
    const importPath = modulePathToImportSpecifier(
      currentFile,
      modulePathToOutputPath(entry.modulePath),
    );
    return `import type { ${names} } from '${importPath}';`;
  });

  if (importLines.length > 0) {
    lines.push(...importLines, '');
  }

  for (const defPath of module.defPaths) {
    const def = ir.defs[defPath];
    lines.push(renderDef(def, module));
  }

  return lines.join('\n').trimEnd() + '\n';
}

function renderDef(def: bdlIr.Def, module: bdlIr.Module): string {
  switch (def.type) {
    case 'Custom':
      return `export type ${def.name} = ${renderType(def.originalType, module)};\n`;
    case 'Enum':
      return [
        `export type ${def.name} =`,
        ...def.items.map((item) => `  | ${JSON.stringify(item.name)}`),
        '  ;',
        '',
      ].join('\n');
    case 'Struct':
      return [
        `export type ${def.name} = Readonly<{`,
        ...def.fields.map((field) =>
          `  ${field.name}${field.optional ? '?' : ''}: ${renderType(field.fieldType, module)};`
        ),
        '}>;',
        '',
      ].join('\n');
    case 'Oneof':
      return [
        `export type ${def.name} =`,
        ...def.items.map((item) => `  | ${renderType(item.itemType, module)}`),
        '  ;',
        '',
      ].join('\n');
    case 'Union': {
      const discriminator = JSON.stringify(def.attributes.discriminator || 'type');
      const namespaceLines = def.items.flatMap((item) => [
        `  export type ${item.name} = Readonly<{`,
        `    ${discriminator}: ${JSON.stringify(item.name)};`,
        ...item.fields.map((field) =>
          `    ${field.name}${field.optional ? '?' : ''}: ${renderType(field.fieldType, module)};`
        ),
        '  }>;',
        '',
      ]);
      return [
        `export type ${def.name} =`,
        ...def.items.map((item) => `  | ${def.name}.${item.name}`),
        '  ;',
        '',
        `export namespace ${def.name} {`,
        ...namespaceLines,
        '}',
        '',
      ].join('\n');
    }
    case 'Proc':
      return `// Proc ${def.name} is omitted from generated type aliases in rieul3d.\n`;
  }
}

function renderType(type: bdlIr.Type, module: bdlIr.Module): string {
  switch (type.type) {
    case 'Plain':
      return renderTypePath(type.valueTypePath, module);
    case 'Array':
      return `readonly ${renderTypePath(type.valueTypePath, module)}[]`;
    case 'Dictionary':
      return `Readonly<Record<${renderTypePath(type.keyTypePath, module)}, ${
        renderTypePath(type.valueTypePath, module)
      }>>`;
  }
}

function renderTypePath(typePath: string, module: bdlIr.Module): string {
  if (!typePath.includes('.')) {
    return primitiveTypeMap[typePath] ?? typePath;
  }

  const modulePath = typePath.split('.').slice(0, -1).join('.');
  const name = typePath.split('.').pop()!;
  const imported = module.imports.find((entry) => entry.modulePath === modulePath);
  if (!imported) {
    return name;
  }

  const importItem = imported.items.find((entry) => entry.name === name);
  return importItem?.as ?? name;
}

function modulePathToOutputPath(modulePath: string): string {
  return `${modulePath.split('.').slice(1).join('/')}.generated.ts`;
}

function modulePathToImportSpecifier(fromPath: string, toPath: string): string {
  const fromDir = dirname(fromPath);
  let relativePath = relative(fromDir, toPath).replaceAll('\\', '/');
  if (!relativePath.startsWith('.')) {
    relativePath = `./${relativePath}`;
  }
  return relativePath.replace(/\.ts$/, '');
}
