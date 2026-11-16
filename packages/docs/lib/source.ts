import { docs } from "collections/server";
import { loader } from "fumadocs-core/source";

// Pages live at the root of the site: `/factory/agents/`, not `/docs/…`.
export const source = loader({ baseUrl: "/", source: docs.toFumadocsSource() });
