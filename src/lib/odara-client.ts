/**
 * Real Odara Supabase client — connects to the production Odara backend
 * instead of the Lovable-provisioned demo project.
 */
import { createClient } from '@supabase/supabase-js';
import {
  ODARA_AUTH_STORAGE_KEY,
  ODARA_SUPABASE_ANON_KEY,
  ODARA_SUPABASE_PROJECT_REF,
  ODARA_SUPABASE_URL,
} from '@/lib/odara-auth-constants';
import { vesperAuthStorage } from '@/lib/auth-persistence';

export { ODARA_AUTH_STORAGE_KEY, ODARA_SUPABASE_PROJECT_REF };

export const odaraSupabase = createClient(ODARA_SUPABASE_URL, ODARA_SUPABASE_ANON_KEY, {
  auth: {
    storage: vesperAuthStorage,
    storageKey: ODARA_AUTH_STORAGE_KEY,
    persistSession: true,
    autoRefreshToken: true,
  },
});
