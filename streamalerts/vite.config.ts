import orange from '@orange-js/vite'
import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

// Orange's client-isolation plugin doesn't take into account files outside /app
// https://github.com/orange-framework/orange-js/issues/17
const orangePlugins = orange().filter((it) => {
	if (typeof it === 'object' && it.name === 'orange:client-isolation') {
		return false
	}
	return true
})

export default defineConfig((config) => {
	return {
		plugins: [orangePlugins, tsconfigPaths()],
		build: {
			minify: config.mode === 'development' ? false : true,
		},
	}
})
