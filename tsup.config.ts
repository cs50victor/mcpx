import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node18',
  outDir: 'dist',
  clean: true,
  minify: false,
  sourcemap: false,
  dts: false,
  shims: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
  esbuildPlugins: [
    {
      name: 'strip-shebang',
      setup(build) {
        build.onLoad({ filter: /index\.ts$/ }, async (args) => {
          const fs = await import('fs');
          let contents = fs.readFileSync(args.path, 'utf8');
          // Remove existing shebang line
          contents = contents.replace(/^#!.*\n/, '');
          return { contents, loader: 'ts' };
        });
      },
    },
  ],
});

