import { createClient } from "@supabase/supabase-js";

const env = ((import.meta as any).env ?? {}) as Record<string, string | undefined>;
const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Supabase env vars missing: VITE_SUPABASE_URL and (VITE_SUPABASE_ANON_KEY or VITE_SUPABASE_PUBLISHABLE_KEY) are required."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
