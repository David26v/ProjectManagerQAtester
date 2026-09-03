'use strict';

// Supabase Auth wrapper for the Electron main process. Uses the
// PUBLISHABLE key ONLY (never the service key — that stays confined to
// `engine/cloud/supabase.js`'s admin client). The session is persisted via a
// custom `auth.storage` adapter so supabase-js's own session JSON — which
// includes a refresh token — never touches disk in plaintext: it is
// safeStorage-encrypted at `<userDataDir>/auth-session.bin`, mirroring the
// credential-blob pattern in ipc.js (plaintext + `.plaintext` sentinel file
// fallback when `safeStorage.isEncryptionAvailable()` is false, e.g. no OS
// keychain on some Linux CI/headless boxes).
//
// `createAuth` restores the session synchronously-ish at construction time
// (supabase-js reads from `storage.getItem` during `createClient` on first
// use of the session) but the actual network refresh is async — callers
// should treat `status()`/`getUser()` right after construction as
// "restoring", not definitively logged out, until the first `auth:changed`
// (or an explicit `status()` after `await ready`).

const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const { safeStorage } = require('electron');
const { NoopRealtimeTransport } = require('../engine/cloud/supabase.js');

const SESSION_FILE_NAME = 'auth-session.bin';
const PLAINTEXT_FLAG_SUFFIX = '.plaintext';

function createFileStorageAdapter(userDataDir) {
  const file = path.join(userDataDir, SESSION_FILE_NAME);
  const flagFile = file + PLAINTEXT_FLAG_SUFFIX;

  return {
    async getItem(_key) {
      if (!fs.existsSync(file)) return null;
      try {
        const raw = fs.readFileSync(file);
        const plaintext = fs.existsSync(flagFile) ? raw.toString('utf8') : safeStorage.decryptString(raw);
        return plaintext;
      } catch (e) {
        console.warn(`[qaflow] failed to read persisted auth session: ${e.message}`);
        return null;
      }
    },
    async setItem(_key, value) {
      fs.mkdirSync(userDataDir, { recursive: true });
      if (safeStorage.isEncryptionAvailable()) {
        fs.writeFileSync(file, safeStorage.encryptString(value));
        if (fs.existsSync(flagFile)) fs.unlinkSync(flagFile);
      } else {
        fs.writeFileSync(file, value, 'utf8');
        fs.writeFileSync(flagFile, '1');
      }
    },
    async removeItem(_key) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
      if (fs.existsSync(flagFile)) fs.unlinkSync(flagFile);
    },
  };
}

function toStatus(user) {
  if (!user) return { loggedIn: false, email: null, name: null };
  const name = (user.user_metadata && user.user_metadata.name) || null;
  return { loggedIn: true, email: user.email, name };
}

// `{ userDataDir }` — same directory main.js already uses for
// `qaflow-data`'s parent (Electron's `app.getPath('userData')`), kept as a
// parameter so this module never touches `electron`'s `app` singleton
// directly (only `safeStorage`, which is fine to import at module scope —
// it has no window/lifecycle coupling).
function createAuth({ userDataDir, url, publishableKey }) {
  const resolvedUrl = url || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const resolvedKey = publishableKey || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!resolvedUrl || !resolvedKey) {
    throw new Error('Supabase URL or publishable key not set');
  }

  const client = createClient(resolvedUrl, resolvedKey, {
    auth: {
      storage: createFileStorageAdapter(userDataDir),
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
    // See `engine/cloud/supabase.js`'s `NoopRealtimeTransport` comment — same
    // "no global WebSocket in Electron's main process" issue applies here.
    realtime: { transport: NoopRealtimeTransport },
  });

  let currentUser = null;
  const listeners = new Set();

  function emit() {
    const status = toStatus(currentUser);
    for (const cb of listeners) {
      try {
        cb(status);
      } catch (e) {
        console.warn(`[qaflow] auth change listener failed: ${e.message}`);
      }
    }
  }

  client.auth.onAuthStateChange((_event, session) => {
    currentUser = session ? session.user : null;
    emit();
  });

  // Auto-restore on boot: `getSession()` reads the persisted (decrypted)
  // session via the adapter above and, if it's expired, refreshes it —
  // resolving with `null` (not throwing) when there's nothing stored or the
  // refresh token is no longer valid, which is exactly "logged out".
  const ready = client.auth
    .getSession()
    .then(({ data, error }) => {
      if (error) {
        console.warn(`[qaflow] auth session restore failed: ${error.message}`);
        return;
      }
      currentUser = data.session ? data.session.user : null;
    })
    .catch((e) => {
      console.warn(`[qaflow] auth session restore failed: ${e.message}`);
    });

  function getUser() {
    return currentUser;
  }

  function status() {
    return toStatus(currentUser);
  }

  async function login(email, password) {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    currentUser = data.user;
    emit();
    return status();
  }

  async function logout() {
    await client.auth.signOut();
    currentUser = null;
    emit();
  }

  function onChange(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }

  return { ready, getUser, status, login, logout, onChange };
}

module.exports = { createAuth };
