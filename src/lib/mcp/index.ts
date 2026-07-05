import { defineMcp } from "@lovable.dev/mcp-js";
import echoTool from "./tools/echo";
import getFragranceContextTool from "./tools/get-fragrance-context";

export default defineMcp({
  name: "odara-mcp",
  title: "Odara Fragrance MCP",
  version: "0.1.0",
  instructions:
    "Tools for the Odara fragrance oracle. Use `echo` to verify connectivity and `get_fragrance_context` to get recommended scent families for a given weather, temperature, and occasion.",
  tools: [echoTool, getFragranceContextTool],
});
