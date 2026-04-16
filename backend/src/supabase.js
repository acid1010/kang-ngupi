import { createClient } from '@supabase/supabase-js';
import logger from './lib/logger.js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

let _client = null;
let _lastError = null;
let _lastErrorAt = 0;

export function getSupabase() {
  if (_client) return _client;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase env is not configured');
  }

  _client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    global: {
      fetch: (...args) => {
        return fetch(...args).catch(err => {
          _lastError = err.message;
          _lastErrorAt = Date.now();
          logger.error('[supabase] Connection error: %s', err.message);
          throw err;
        });
      }
    }
  });

  return _client;
}

export function getSupabaseStatus() {
  return {
    connected: !!_client,
    lastError: _lastError,
    lastErrorAt: _lastErrorAt ? new Date(_lastErrorAt).toISOString() : null
  };
}
