import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { DEMO, startDemo } from "./lib/demo.js";
import { createQueryClient } from "./lib/query-client.js";
import "./styles.css";

const root = document.getElementById("root");
// The demo build first points the app's reads at the recorded answers.
(DEMO ? startDemo() : Promise.resolve()).then(() => {
	if (root)
		createRoot(root).render(
			<StrictMode>
				<QueryClientProvider client={createQueryClient()}>
					<App />
				</QueryClientProvider>
			</StrictMode>,
		);
});
