import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
type JsonObject = Record<string, unknown>;

if (!url || !anon) {
  console.warn('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set');
}

export const supabase = createClient(url ?? '', anon ?? '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

function functionsBase(): string {
  return (url ?? '').replace(/\/$/, '');
}

function requireEnv() {
  if (!url || !anon) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
  }
  return { url, anon };
}

function parseMaybeJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as JsonObject;
  } catch {
    return null;
  }
}

function responseMessage(res: Response, text: string, json: unknown): string {
  const payload = json as { error?: string; message?: string } | null;
  return (
    (payload && typeof payload.message === 'string' && payload.message) ||
    (payload && typeof payload.error === 'string' && payload.error) ||
    text.slice(0, 400) ||
    res.statusText
  );
}

async function fetchFunctionEndpoint(
  path: string,
  options: {
    method?: 'GET' | 'POST';
    body?: object;
    token: string;
    networkErrorPrefix?: string;
  }
) {
  const { anon } = requireEnv();
  const res = await fetch(`${functionsBase()}/functions/v1${path}`, {
    method: options.method ?? 'POST',
    headers: {
      Authorization: `Bearer ${options.token}`,
      apikey: anon,
      ...(options.method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(options.method !== 'GET' ? { body: JSON.stringify(options.body ?? {}) } : {}),
  }).catch((error: unknown) => {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`${options.networkErrorPrefix ?? 'Could not reach Edge Function'}: ${msg}`);
  });

  const text = await res.text();
  const json = parseMaybeJson(text);
  return { res, text, json };
}

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Call Edge Functions with explicit headers. Also set verify_jwt = false in supabase/config.toml
 * for each function and redeploy — otherwise the gateway often returns 401 Invalid JWT even when
 * the function would accept the token.
 */
export async function invokeFunction(name: string, body?: object) {
  if (!url || !anon) {
    throw new Error(
      'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env — add them with the VITE_ prefix and restart npm run dev.'
    );
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  if (!token) {
    throw new Error('Not authenticated — please log in again.');
  }

  const { res, text, json } = await fetchFunctionEndpoint(`/${encodeURIComponent(name)}`, {
    method: 'POST',
    body,
    token,
    networkErrorPrefix:
      'Could not reach Edge Function. Deploy functions and check network / ad blockers',
  });

  if (res.status === 402) {
    const o = json as { code?: string; error?: string } | null;
    if (o?.code === 'PAYMENT_REQUIRED') {
      throw new Error('PAYMENT_REQUIRED');
    }
  }

  if (!res.ok) {
    const msg = responseMessage(res, text, json);
    if (res.status === 401 && msg.includes('JWT')) {
      throw new Error(
        `${msg} — Redeploy functions so config.toml has verify_jwt = false for this function, or sign out and sign in again with keys from the same Supabase project as VITE_SUPABASE_URL.`
      );
    }
    throw new Error(msg);
  }

  return (json ?? {}) as Record<string, unknown>;
}

/** Edge Function callable without a user session (uses anon key). */
export async function invokePublicFunction(name: string, body?: object) {
  const { anon } = requireEnv();
  const { res, text, json } = await fetchFunctionEndpoint(`/${encodeURIComponent(name)}`, {
    method: 'POST',
    body,
    token: anon,
  });

  if (!res.ok) {
    throw new Error(responseMessage(res, text, json));
  }
  return (json ?? {}) as JsonObject;
}

export async function fetchPublicFunction(pathAndQuery: string) {
  const { anon } = requireEnv();
  const path = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`;
  const { res, text, json } = await fetchFunctionEndpoint(path, {
    method: 'GET',
    token: anon,
  });

  if (!res.ok) {
    throw new Error(responseMessage(res, text, json));
  }
  return (json ?? {}) as JsonObject;
}

/** POST with optional Bearer (session); falls back to anon when token is null. */
export async function postFunctionOptionalAuth(
  name: string,
  body: object,
  accessToken: string | null
) {
  const { anon } = requireEnv();
  const token = accessToken ?? anon;
  const { res, text, json } = await fetchFunctionEndpoint(`/${encodeURIComponent(name)}`, {
    method: 'POST',
    body,
    token,
  });

  if (!res.ok) {
    throw new Error(responseMessage(res, text, json));
  }
  return (json ?? {}) as JsonObject;
}

export async function fetchPhotoSignedUrl(profileId: string): Promise<string | null> {
  const token = await getAccessToken();
  if (!token || !url || !anon) return null;
  const res = await fetch(
    `${functionsBase()}/functions/v1/serve-photo?profile_id=${encodeURIComponent(profileId)}`,
    { headers: { Authorization: `Bearer ${token}`, apikey: anon } }
  ).catch(() => null);
  if (!res || !res.ok) return null;
  const j = (await res.json()) as { signedUrl?: string };
  return j.signedUrl ?? null;
}
