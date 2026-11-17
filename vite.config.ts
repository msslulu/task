import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
	root: 'frontend',
	plugins: [vue()],
	server: {
		proxy: {
			'/api': 'http://127.0.0.1:8787',
			'/health': 'http://127.0.0.1:8787',
		},
	},
	build: {
		outDir: '../dist/client',
		emptyOutDir: true,
	},
});
