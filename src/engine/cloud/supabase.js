const { createClient } = require('@supabase/supabase-js');

// This app never uses Supabase Realtime (no `.channel()`/`.subscribe()`
// calls anywhere) — Auth + Postgres (via Prisma) + Storage only. But
// supabase-js's `RealtimeClient` constructor eagerly resolves a WebSocket
// constructor via `options.transport ?? WebSocketFactory.getWebSocketConstructor()`
// even when nothing ever uses it, and THROWS if none is found. Electron's
// main process runs on a bundled Node (currently < 22) with no global
// `WebSocket`, so every `createClient()` call would throw at construction
// time without this. Passing any constructor here short-circuits that `??`
// — it is never actually instantiated because nothing calls `.channel()`.
class NoopRealtimeTransport {}

function createSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase URL or service role key not set');
  return createClient(url, key, {
    auth: { persistSession: false },
    realtime: { transport: NoopRealtimeTransport },
  });
}

module.exports = { createSupabaseAdmin, NoopRealtimeTransport };
