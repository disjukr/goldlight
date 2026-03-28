import { createMaterialRegistry, inspectMaterialTemplateBake } from '@disjukr/goldlight/renderer';

const [templateId, variantJson] = Deno.args;

if (!templateId || !variantJson) {
  console.error('usage: deno task renderer:template:inspect <template-id> <variant-json>');
  Deno.exit(1);
}

const variant = JSON.parse(variantJson) as Record<string, unknown>;
const report = inspectMaterialTemplateBake(
  createMaterialRegistry(),
  templateId,
  variant as never,
);

console.log(JSON.stringify(report, null, 2));
