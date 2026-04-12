import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ODARA_URL = "https://yysmhqxmnhfugwnojfag.supabase.co";
const ODARA_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5c21ocXhtbmhmdWd3bm9qZmFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5MjcxMzQsImV4cCI6MjA4NjUwMzEzNH0.X229W2_Ti5uDmlq8OJsaauOBxpaazUlPh1ywhTEsl2o";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const email = Deno.env.get("ODARA_TEST_EMAIL");
    const password = Deno.env.get("ODARA_TEST_PASSWORD");

    if (!email || !password) {
      return new Response(
        JSON.stringify({ error: "Test credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[odara-test-login] email="${email}", passwordLen=${password.length}`);

    // Try raw fetch first to avoid HTML parse errors from the SDK
    const authRes = await fetch(`${ODARA_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": ODARA_ANON_KEY,
      },
      body: JSON.stringify({ email, password }),
    });

    const contentType = authRes.headers.get("content-type") || "";

    // If response isn't JSON, the Odara project may be down/paused
    if (!contentType.includes("application/json")) {
      const text = await authRes.text();
      console.error(`[odara-test-login] Non-JSON response (${authRes.status}):`, text.slice(0, 200));
      return new Response(
        JSON.stringify({
          error: "Odara auth service unavailable",
          detail: `Received ${contentType || "unknown content-type"} (status ${authRes.status})`,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const json = await authRes.json();

    if (!authRes.ok || json.error) {
      return new Response(
        JSON.stringify({
          error: "Test login failed",
          detail: json.error_description || json.msg || json.error || "Unknown auth error",
          debug: { emailUsed: email, passwordLen: password.length },
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        access_token: json.access_token,
        refresh_token: json.refresh_token,
        expires_in: json.expires_in,
        user: { id: json.user?.id, email: json.user?.email },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[odara-test-login] Unexpected:", e);
    return new Response(
      JSON.stringify({ error: "Internal error", detail: String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
