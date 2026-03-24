import { appendMesh, appendNode, createNode, createSceneIr } from '@goldlight/ir';
import type { MeshAttribute, SceneIr } from '@goldlight/ir';

type PlyElementDefinition = Readonly<{
  name: string;
  count: number;
  properties: readonly PlyPropertyDefinition[];
}>;

type PlyPropertyDefinition = Readonly<{
  name: string;
  kind: 'scalar' | 'list';
}>;

const parsePlyElementDefinition = (
  lines: readonly string[],
  startIndex: number,
): Readonly<{
  element: PlyElementDefinition;
  nextIndex: number;
}> => {
  const [_, name, countText] = lines[startIndex].trim().split(/\s+/);
  if (!name || !countText) {
    throw new Error(`Malformed PLY element definition at line ${startIndex + 1}`);
  }

  const count = Number(countText);
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`Invalid PLY element count for "${name}": ${countText}`);
  }

  const properties: PlyPropertyDefinition[] = [];
  let nextIndex = startIndex + 1;
  while (nextIndex < lines.length) {
    const trimmed = lines[nextIndex].trim();
    if (!trimmed.startsWith('property ')) {
      break;
    }

    const propertyParts = trimmed.split(/\s+/);
    const propertyName = propertyParts.at(-1);
    if (!propertyName) {
      throw new Error(`Malformed PLY property definition at line ${nextIndex + 1}`);
    }

    properties.push({
      name: propertyName,
      kind: propertyParts[1] === 'list' ? 'list' : 'scalar',
    });
    nextIndex += 1;
  }

  return {
    element: {
      name,
      count,
      properties,
    },
    nextIndex,
  };
};

export const importPlyFromText = (source: string, sceneId = 'ply-scene'): SceneIr => {
  const lines = source.split(/\r?\n/);
  if (lines[0]?.trim() !== 'ply') {
    throw new Error('PLY source must start with "ply"');
  }

  if (lines[1]?.trim() !== 'format ascii 1.0') {
    throw new Error('Only ASCII PLY format 1.0 is currently supported');
  }

  const elements: PlyElementDefinition[] = [];
  let lineIndex = 2;
  while (lineIndex < lines.length) {
    const trimmed = lines[lineIndex].trim();
    if (trimmed === 'end_header') {
      lineIndex += 1;
      break;
    }
    if (trimmed === '' || trimmed.startsWith('comment ') || trimmed.startsWith('obj_info ')) {
      lineIndex += 1;
      continue;
    }
    if (trimmed.startsWith('element ')) {
      const definition = parsePlyElementDefinition(lines, lineIndex);
      elements.push(definition.element);
      lineIndex = definition.nextIndex;
      continue;
    }

    throw new Error(`Unsupported PLY header line at ${lineIndex + 1}: ${trimmed}`);
  }

  const vertexDefinition = elements.find((element) => element.name === 'vertex');
  const faceDefinition = elements.find((element) => element.name === 'face');
  if (!vertexDefinition) {
    throw new Error('PLY source must define a vertex element');
  }
  if (!faceDefinition) {
    throw new Error('PLY source must define a face element');
  }

  const xIndex = vertexDefinition.properties.findIndex((property) => property.name === 'x');
  const yIndex = vertexDefinition.properties.findIndex((property) => property.name === 'y');
  const zIndex = vertexDefinition.properties.findIndex((property) => property.name === 'z');
  const faceIndexPropertyIndex = faceDefinition.properties.findIndex((property) =>
    property.kind === 'list'
  );
  if (xIndex === -1 || yIndex === -1 || zIndex === -1) {
    throw new Error('PLY vertex element must define x, y, and z properties');
  }
  if (faceIndexPropertyIndex === -1) {
    throw new Error('PLY face element must define a list property for vertex indices');
  }

  const positions: number[] = [];
  const indices: number[] = [];

  for (const element of elements) {
    for (let elementIndex = 0; elementIndex < element.count; elementIndex += 1) {
      const dataLine = lines[lineIndex]?.trim();
      if (!dataLine) {
        throw new Error(`Missing PLY data for element "${element.name}"`);
      }

      const parts = dataLine.split(/\s+/);
      if (element.name === 'vertex') {
        positions.push(
          Number(parts[xIndex]),
          Number(parts[yIndex]),
          Number(parts[zIndex]),
        );
      } else if (element.name === 'face') {
        let cursor = 0;
        let faceIndices: number[] | undefined;
        for (const [propertyIndex, property] of element.properties.entries()) {
          if (property.kind === 'list') {
            const itemCount = Number(parts[cursor]);
            if (!Number.isInteger(itemCount) || itemCount < 0) {
              throw new Error(`Invalid PLY list property at line ${lineIndex + 1}`);
            }

            const values = parts.slice(cursor + 1, cursor + 1 + itemCount).map((value) =>
              Number(value)
            );
            if (values.length !== itemCount) {
              throw new Error(`Invalid PLY list property at line ${lineIndex + 1}`);
            }
            if (propertyIndex === faceIndexPropertyIndex) {
              faceIndices = values;
            }
            cursor += 1 + itemCount;
          } else {
            cursor += 1;
          }
        }

        if (!faceIndices || faceIndices.length < 3) {
          throw new Error(`Invalid PLY face at line ${lineIndex + 1}`);
        }

        for (let index = 1; index < faceIndices.length - 1; index += 1) {
          indices.push(faceIndices[0], faceIndices[index], faceIndices[index + 1]);
        }
      }

      lineIndex += 1;
    }
  }

  const positionAttribute: MeshAttribute = {
    semantic: 'POSITION',
    itemSize: 3,
    values: positions,
  };

  const meshId = `${sceneId}-mesh-0`;
  let scene = createSceneIr(sceneId);
  scene = appendMesh(scene, {
    id: meshId,
    attributes: [positionAttribute],
    indices,
  });
  scene = appendNode(scene, createNode(`${sceneId}-node-0`, { meshId }));
  return scene;
};
