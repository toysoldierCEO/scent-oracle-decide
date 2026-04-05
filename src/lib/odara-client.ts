/**
 * Real Odara Supabase client — connects to the production Odara backend
 * instead of the Lovable-provisioned demo project.
 */
import { createClient } from '@supabase/supabase-js';

const ODARA_SUPABASE_URL = 'https://yysmhqxmnhfugwnojfag.supabase.co';
const ODARA_SUPABASE_ANON_KEY = 'sb_publishable_vUHeafZqxqsNyvXIatqDrw_c15i1fbU';

export const odaraSupabase = createClient(ODARA_SUPABASE_URL, ODARA_SUPABASE_ANON_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});
