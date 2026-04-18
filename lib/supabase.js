// Ryujin OS — Supabase Client
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_KEY || '').trim();
const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || '').trim();

// Service client — bypasses RLS, used in API routes
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Anon client — respects RLS, used for client-side if needed
export const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey);
