import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build`        -> build/ with hashed assets
// `npm run build:single` -> build/index.html as one self-contained file
//
// Output goes to build/, not dist/: dist/ holds the committed zero-install
// tessellate-cad.html (made by `npm run bundle`), and Vite empties its outDir.
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    plugins: [react(), ...(single ? [viteSingleFile()] : [])],
    build: {
      outDir: 'build',
      target: 'es2022',
      assetsInlineLimit: single ? 100000000 : 4096,
      cssCodeSplit: !single,
      rollupOptions: { output: { inlineDynamicImports: single } },
    },
    server: { open: true },
  };
});
