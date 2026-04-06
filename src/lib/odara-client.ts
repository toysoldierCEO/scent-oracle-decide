/**
 * Real Odara Supabase client — connects to the production Odara backend
 * instead of the Lovable-provisioned demo project.
 */
import { createClient } from '@supabase/supabase-js';

const ODARA_SUPABASE_URL = 'https://yysmhqxmnhfugwnojfag.supabase.co';
const ODARA_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5c21ocXhtbmhmdWd3bm9qZmFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5MjcxMzQsImV4cCI6MjA4NjUwMzEzNH0.X229W2_Ti5uDmlq8OJsaauOBxpaazUlPh1ywhTEsl2o';

export const odaraSupabase = createClient(ODARA_SUPABASE_URL, ODARA_SUPABASE_ANON_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});
