import type { ElectrobunConfig } from 'electrobun';

const config: ElectrobunConfig = {
  app: {
    name: 'goldlight',
    identifier: 'dev.disjukr.goldlight',
    version: '0.0.0',
  },
  build: {
    buildFolder: process.env.GOLDLIGHT_BUILD_FOLDER ?? 'build',
    bun: {
      entrypoint: 'src/bun/index.ts',
    },
    macos: { bundleWGPU: true },
    win: { bundleWGPU: true },
    linux: { bundleWGPU: true },
  },
};

export default config;
