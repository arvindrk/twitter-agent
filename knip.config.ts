import type { KnipConfig } from "knip";

const config: KnipConfig = {
	entry: ["src/index.ts", "scripts/*.ts", "src/**/*.test.ts", "src/test/**"],
	project: ["src/**/*.ts"],
	ignoreDependencies: ["@types/bun"],
	ignoreUnresolved: ["bun-types"],
};

export default config;
