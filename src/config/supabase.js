const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
// Basic runtime diagnostics to help debug missing env issues.
if (!supabaseUrl || !supabaseKey) {
  console.warn('Supabase configuration missing. SUPABASE_URL or SUPABASE_KEY not found in environment.');
  console.warn('Available env keys:', {
    SUPABASE_URL: !!process.env.SUPABASE_URL,
    VITE_SUPABASE_URL: !!process.env.VITE_SUPABASE_URL,
    SUPABASE_KEY: !!process.env.SUPABASE_KEY,
    VITE_SUPABASE_ANON_KEY: !!process.env.VITE_SUPABASE_ANON_KEY,
  });
}

let supabase = null;
if (supabaseUrl && supabaseKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('Supabase client created (from src/config/supabase.js)');
  } catch (e) {
    console.error('Failed to create Supabase client:', e && e.message);
    supabase = null;
  }
} else {
  // Provide a helpful stub that surfaces a clear error if used.
  supabase = {
    from() {
      throw new Error('Supabase client not configured. Set SUPABASE_URL and SUPABASE_KEY (or VITE_SUPABASE_*).');
    },
  };
}

module.exports = supabase;
