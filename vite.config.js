import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build`         -> dist/ with hashed assets
// `SINGLE=1 npm run build`-> dist/index.html as one self-contained file
const single = !!process.env.SINGLE;

export default defineConfig({
  base: './',
  plugins: [react(), ...(single ? [viteSingleFile()] : [])],
  build: {
    target: 'es2022',
    assetsInlineLimit: single ? 100000000 : 4096,
    cssCodeSplit: !single,
    rollupOptions: { output: { inlineDynamicImports: single } },
  },
  server: { open: true },
});
