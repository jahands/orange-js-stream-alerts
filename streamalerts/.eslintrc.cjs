/** @type {import("eslint").Linter.Config} */
module.exports = {
	root: true,
	extends: ['@repo/eslint-config/default.cjs'],
	ignorePatterns: ['./postcss.config.mjs'],
}
