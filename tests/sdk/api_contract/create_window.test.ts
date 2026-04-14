import { describe, expect, it } from 'bun:test';

import type {
  Camera3dState,
  Mat4Value,
  OrthographicCamera3dInit,
  PerspectiveCamera3dInit,
  Rect2d,
  Rect2dInit,
  Rect2dPatch,
  Rect2dState,
  Scene2d,
  Scene2dInit,
  Scene2dState,
  Scene3d,
  Scene3dInit,
  Scene3dState,
  Triangle3d,
  Triangle3dInit,
  Triangle3dPatch,
  Triangle3dState,
  WindowHandle,
  WindowInit,
} from 'goldlight';
import { Rect2d as Rect2dClass, Scene2d as Scene2dClass, Scene3d as Scene3dClass, Triangle3d as Triangle3dClass, createOrthographicCamera3d, createPerspectiveCamera3d, createWindow, setWindowScene } from 'goldlight';
import { Group2d as Group2dClass, Group3d as Group3dClass, LayoutGroup2d as LayoutGroup2dClass, LayoutGroup3d as LayoutGroup3dClass, LayoutItem2d as LayoutItem2dClass, LayoutItem3d as LayoutItem3dClass, ScrollContainer2d as ScrollContainer2dClass } from 'goldlight';

describe('goldlight sdk contract', () => {
  it('exports createWindow as a function', () => {
    expect(typeof createWindow).toBe('function');
  });

  it('accepts typed window options', () => {
    const init: WindowInit = {
      title: 'example',
      width: 640,
      height: 480,
      workerEntrypoint: 'file:///window.worker.js',
    };

    expect(init.title).toBe('example');
    expect(init.width).toBe(640);
    expect(init.height).toBe(480);
    expect(init.workerEntrypoint).toBe('file:///window.worker.js');
  });

  it('describes the window handle shape', () => {
    const handle: WindowHandle = { id: 1 };

    expect(handle.id).toBe(1);
  });

  it('describes the 2D scene contract', () => {
    const sceneInit: Scene2dInit = {};
    const rectInit: Rect2dInit = { x: 10 };
    const rectPatch: Rect2dPatch = { width: 180 };
    const sceneState: Scene2dState = {
      clearColor: { r: 0.1, g: 0.12, b: 0.16, a: 1 },
    };
    const rectState: Rect2dState = {
      x: 10,
      y: 0,
      width: 120,
      height: 120,
      color: { r: 0.25, g: 0.65, b: 0.95, a: 1 },
    };
    const scene = { id: 1, set() { return this; }, get() { return sceneState; }, add() { return { id: 1, set() { return this; }, get() { return rectState; } }; } } satisfies Scene2d;
    const rect = { id: 1, set() { return this; }, get() { return rectState; } } satisfies Rect2d;

    expect(sceneInit).toEqual({});
    expect(rectInit.x).toBe(10);
    expect(rectPatch.width).toBe(180);
    expect(scene.id).toBe(1);
    expect(rect.id).toBe(1);
    expect(typeof Scene2dClass).toBe('function');
    expect(typeof Rect2dClass).toBe('function');
    expect(typeof Group2dClass).toBe('function');
    expect(typeof ScrollContainer2dClass).toBe('function');
    expect(typeof LayoutGroup2dClass).toBe('function');
    expect(typeof LayoutItem2dClass).toBe('function');
    expect(typeof scene.set).toBe('function');
    expect(typeof scene.get).toBe('function');
    expect(scene.get().clearColor.a).toBe(1);
    expect(rect.get().width).toBe(120);
    const setScene: <T extends Scene2d>(scene: T) => T = setWindowScene;
    expect(typeof setScene).toBe('function');
  });

  it('describes the 3D scene contract', () => {
    const sceneInit: Scene3dInit = {};
    const triangleInit: Triangle3dInit = {};
    const trianglePatch: Triangle3dPatch = { color: { r: 1, g: 0, b: 0, a: 1 } };
    const matrix: Mat4Value = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
    const cameraState: Camera3dState = {
      viewProjectionMatrix: matrix,
    };
    const orthographicCameraInit: OrthographicCamera3dInit = { width: 640, height: 480 };
    const perspectiveCameraInit: PerspectiveCamera3dInit = { width: 640, height: 480 };
    const sceneState: Scene3dState = {
      clearColor: { r: 0.1, g: 0.12, b: 0.16, a: 1 },
      camera: cameraState,
    };
    const triangleState: Triangle3dState = {
      positions: [
        [-0.7, -0.6, 0],
        [0.7, -0.6, 0],
        [0, 0.7, 0],
      ],
      color: { r: 0.95, g: 0.45, b: 0.25, a: 1 },
    };
    const scene = {
      id: 1,
      set() { return this; },
      get() { return sceneState; },
      add() { return { id: 1, set() { return this; }, get() { return triangleState; } }; },
    } satisfies Scene3d;
    const triangle = { id: 1, set() { return this; }, get() { return triangleState; } } satisfies Triangle3d;

    expect(sceneInit).toEqual({});
    expect(triangleInit).toEqual({});
    expect(trianglePatch.color?.r).toBe(1);
    expect(scene.id).toBe(1);
    expect(triangle.id).toBe(1);
    expect(typeof Scene3dClass).toBe('function');
    expect(typeof Triangle3dClass).toBe('function');
    expect(typeof Group3dClass).toBe('function');
    expect(typeof LayoutGroup3dClass).toBe('function');
    expect(typeof LayoutItem3dClass).toBe('function');
    expect(typeof scene.set).toBe('function');
    expect(typeof scene.get).toBe('function');
    expect(scene.get().camera.viewProjectionMatrix[0]).toBe(1);
    expect(triangle.get().positions[0][0]).toBe(-0.7);
    expect(orthographicCameraInit.width).toBe(640);
    expect(perspectiveCameraInit.height).toBe(480);
    expect(typeof createOrthographicCamera3d).toBe('function');
    expect(typeof createPerspectiveCamera3d).toBe('function');
  });

  it('throws outside the runtime', () => {
    expect(() => createWindow()).toThrow(
      'The "goldlight" module is provided by the goldlight runtime at execution time.',
    );
    expect(() => setWindowScene({} as Scene2d)).toThrow(
      'The "goldlight" module is provided by the goldlight runtime at execution time.',
    );
    expect(() => new Scene2dClass()).toThrow(
      'The "goldlight" module is provided by the goldlight runtime at execution time.',
    );
    expect(() => new Scene3dClass()).toThrow(
      'The "goldlight" module is provided by the goldlight runtime at execution time.',
    );
  });
});
