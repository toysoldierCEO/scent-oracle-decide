import { auth, defineMcp } from "@lovable.dev/mcp-js";
import echoTool from "./tools/echo";
import getFragranceContextTool from "./tools/get-fragrance-context";

const ODARA_MCP_SUPABASE_URL = "https://yysmhqxmnhfugwnojfag.supabase.co";

export default defineMcp({
  name: "odara-mcp",
  title: "Odara Fragrance MCP",
  version: "0.1.0",
  instructions:
    "Tools for the Odara fragrance oracle. Use `echo` to verify connectivity and `get_fragrance_context` to get recommended scent families for a given weather, temperature, and occasion.",
  auth: auth.oauth.issuer({
    issuer: `${ODARA_MCP_SUPABASE_URL}/auth/v1`,
    acceptedAudiences: "authenticated",
    jwksUri: `${ODARA_MCP_SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
  }),
  tools: [echoTool, getFragranceContextTool],
});
