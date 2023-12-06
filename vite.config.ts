
// vite.config.ts
import { resolve } from 'path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
// https://vitejs.dev/guide/build.html#library-mode
export default defineConfig({
  build: {
    target: 'es2015',
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'maps',
      fileName: (format) => `maps.${format}.js`,
    },
    
  },
  resolve: { 
    alias: { src: resolve('src/') } 
  },
  plugins: [dts()],
});