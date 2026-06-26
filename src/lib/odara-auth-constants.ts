export const ODARA_SUPABASE_URL = 'https://yysmhqxmnhfugwnojfag.supabase.co';
export const ODARA_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5c21ocXhtbmhmdWd3bm9qZmFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5MjcxMzQsImV4cCI6MjA4NjUwMzEzNH0.X229W2_Ti5uDmlq8OJsaauOBxpaazUlPh1ywhTEsl2o';
export const ODARA_SUPABASE_PROJECT_REF = new URL(ODARA_SUPABASE_URL).hostname.split('.')[0];
export const ODARA_AUTH_STORAGE_KEY = `sb-${ODARA_SUPABASE_PROJECT_REF}-auth-token`;
