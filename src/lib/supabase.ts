import {
  createClient,
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';

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

function jwtHint401(msg: string): boolean {
  const m = msg.trim();
  return /jwt/i.test(m) || /invalid/i.test(m) || m === 'Unauthorized' || m === '';
}

/**
 * Call Edge Functions with the session JWT. Uses `supabase.functions.invoke` so headers match the
 * SDK’s authenticated fetch (same as PostgREST). Retries once after `refreshSession()` on 401.
 */
export async function invokeFunction(name: string, body?: object) {
  if (!url || !anon) {
    throw new Error(
      'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env — add them with the VITE_ prefix and restart npm run dev.'
    );
  }

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session?.access_token) {
    throw new Error('Not authenticated — please log in again.');
  }

  const networkErrorPrefix =
    'Could not reach Edge Function. Deploy functions and check network / ad blockers';

  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase.functions.invoke(name, { body: body ?? {} });

    if (!error) {
      if (data != null && typeof data === 'object' && !Array.isArray(data)) {
        return data as Record<string, unknown>;
      }
      return {} as Record<string, unknown>;
    }

    if (error instanceof FunctionsFetchError) {
      throw new Error(`${networkErrorPrefix}: ${error.message}`);
    }
    if (error instanceof FunctionsRelayError) {
      throw new Error(`Edge Function relay error: ${error.message}`);
    }

    if (error instanceof FunctionsHttpError) {
      const res = error.context as Response;
      if (res.status === 401 && attempt === 0) {
        const { data: refreshed } = await supabase.auth.refreshSession();
        if (refreshed.session?.access_token) {
          continue;
        }
      }
      const text = await res.text();
      const json = parseMaybeJson(text);
      if (res.status === 402) {
        const o = json as { code?: string; error?: string } | null;
        if (o?.code === 'PAYMENT_REQUIRED') {
          throw new Error('PAYMENT_REQUIRED');
        }
      }
      const msg = responseMessage(res, text, json);
      if (res.status === 401 && jwtHint401(msg)) {
        throw new Error(
          `${msg || 'Unauthorized'} — Sign out and sign in again, and confirm VITE_SUPABASE_URL / anon key match the project where functions are deployed (redeploy after changing env vars).`
        );
      }
      throw new Error(msg);
    }

    throw new Error(error instanceof Error ? error.message : 'Edge Function error');
  }

  throw new Error('Unauthorized — please sign in again.');
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
