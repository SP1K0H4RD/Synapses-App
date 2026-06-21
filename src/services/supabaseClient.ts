import { createClient } from "@supabase/supabase-js";

const env = ((import.meta as any).env ?? {}) as Record<string, string | undefined>;
export const supabaseUrl = env.VITE_SUPABASE_URL;
export const supabaseKey = env.VITE_SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabaseKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;
