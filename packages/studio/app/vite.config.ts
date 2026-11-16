import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** The token of the running server; it changes at each start, so it is read on each use. */
const token = () => {
	const path = join(
		process.env.OPENFABRIQ_HOME ?? join(homedir(), ".openfabriq"),
		"viewer-token",
	);
	return existsSync(path) ? readFileSync(path, "utf8").trim() : "";
};

// Built next to the server (dist/app), which serves it. In dev, /api goes to a running `openfabriq start`.
export default defineConfig(({ mode }) => ({
	plugins: [react(), tailwindcss()],
	// The demo (src/lib/demo.ts) is built into the docs' site, next to its recorded answers, from
	// the sources of core: it does not wait for `pnpm build`.
	...(mode === "demo" && {
		base: "./",
		resolve: {
			alias: {
				"@openfabriq/core": fileURLToPath(
					new URL("../../core/src/index.ts", import.meta.url),
				),
			},
		},
	}),
	// A local app: one larger chunk for the conversation pages costs nothing over the network.
	build:
		mode === "demo"
			? {
					outDir: "../../docs/public/studio-demo",
					// Its api/ folder holds the recorded answers.
					emptyOutDir: false,
					chunkSizeWarningLimit: 600,
				}
			: {
					outDir: "../dist/app",
					emptyOutDir: true,
					chunkSizeWarningLimit: 600,
				},
	server: {
		proxy: {
			"/api": {
				target: "http://127.0.0.1:4310",
				// Every API route wants the server's cookie, and writes accept no foreign Origin.
				changeOrigin: true,
				configure: (proxy) =>
					proxy.on("proxyReq", (req) => {
						req.removeHeader("origin");
						const value = token();
						// The cookie of the studio on 4310, the port this proxy reaches.
						if (value) req.setHeader("cookie", `openfabriq-4310=${value}`);
					}),
			},
		},
	},
}));
