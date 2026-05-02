import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// Tightened CORS — only known Lovable preview/published origins may call this.
const ALLOWED_ORIGINS = new Set([
  "https://id-preview--20427402-64b7-4dc9-80aa-727b1e4a3e69.lovable.app",
  "https://20427402-64b7-4dc9-80aa-727b1e4a3e69.lovableproject.com",
  "https://scent-oracle-decide.lovable.app",
]);

function buildCorsHeaders(origin: string | null) {
  const allowOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : "null";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-test-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

const ODARA_URL = "https://yysmhqxmnhfugwnojfag.supabase.co";
const ODARA_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5c21ocXhtbmhmdWd3bm9qZmFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5MjcxMzQsImV4cCI6MjA4NjUwMzEzNH0.X229W2_Ti5uDmlq8OJsaauOBxpaazUlPh1ywhTEsl2o";

// Simple in-memory rate limiter (per-edge-instance, best-effort).
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function rateLimited(ip: string, limit = 5, windowMs = 60_000) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + windowMs });
    return false;
  }
  bucket.count += 1;
  return bucket.count > limit;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const corsHeaders = buildCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // --- Shared-secret gate ---
    const expectedSecret = Deno.env.get("ODARA_TEST_LOGIN_SECRET");
    if (!expectedSecret) {
      return new Response(
        JSON.stringify({ error: "Endpoint not configured" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const provided = req.headers.get("x-test-secret");
    if (!provided || provided !== expectedSecret) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- Rate limiting ---
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") ||
      "unknown";
    if (rateLimited(ip)) {
      return new Response(
        JSON.stringify({ error: "Too many requests" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const email = Deno.env.get("ODARA_TEST_EMAIL");
    const password = Deno.env.get("ODARA_TEST_PASSWORD");

    if (!email || !password) {
      return new Response(
        JSON.stringify({ error: "Test credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const authRes = await fetch(`${ODARA_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": ODARA_ANON_KEY,
      },
      body: JSON.stringify({ email, password }),
    });

    const contentType = authRes.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
      return new Response(
        JSON.stringify({ error: "Auth service unavailable" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const json = await authRes.json();

    if (!authRes.ok || json.error) {
      return new Response(
        JSON.stringify({ error: "Test login failed" }),
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
    console.error("[odara-test-login] Unexpected error");
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
