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

    const emailExists = !!email && email.length > 0;
    const passwordExists = !!password && password.length > 0;

    if (!email || !password) {
      return new Response(
        JSON.stringify({
          error: "Test credentials not configured",
          debug: { emailExists, passwordExists },
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log email for debugging (email is not a secret), password length only
    console.log(`[odara-test-login] email="${email}", passwordLen=${password.length}`);

    const odara = createClient(ODARA_URL, ODARA_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await odara.auth.signInWithPassword({ email, password });

    if (error) {
      return new Response(
        JSON.stringify({
          error: "Test login failed",
          detail: error.message,
          debug: { emailUsed: email, passwordLen: password.length },
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_in: data.session.expires_in,
        user: { id: data.user.id, email: data.user.email },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
