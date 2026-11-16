import { createContext, useContext } from "react";
import { type AgentHue, agentHues } from "../lib/agent-hue.js";

/** The agents' colors, which the app sets from the board: the same agent, the same color, on every page. */
export const AgentHueContext = createContext<AgentHue>(agentHues([]));

/** An agent's color, by its name. */
export const useAgentHue = (): AgentHue => useContext(AgentHueContext);
