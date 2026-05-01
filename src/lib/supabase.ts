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

/**
 * Same-origin proxy for Edge Functions (see `VITE_SUPABASE_FUNCTIONS_BFF_PREFIX` in `.env.example`).
 * Avoids "Failed to fetch" when trackers block `*.supabase.co` requests.
 */
function usesFunctionsBffProxy(): boolean {
  const prefix = (import.meta.env.VITE_SUPABASE_FUNCTIONS_BFF_PREFIX as string | undefined)?.trim();
  return !!prefix && typeof window !== 'undefined' && !!window.location?.origin;
}

/** Absolute URL path after `/functions/v1` (starts with `/`, may include query). */
function functionsHttpUrl(pathAfterV1Root: string): string {
  const rawPrefix = (import.meta.env.VITE_SUPABASE_FUNCTIONS_BFF_PREFIX as string | undefined)?.trim();
  const path = pathAfterV1Root.startsWith('/') ? pathAfterV1Root : `/${pathAfterV1Root}`;
  if (rawPrefix && typeof window !== 'undefined' && window.location?.origin) {
    const normalized = rawPrefix.startsWith('/') ? rawPrefix : `/${rawPrefix}`;
    return `${window.location.origin.replace(/\/$/, '')}${normalized.replace(/\/$/, '')}${path}`;
  }
  const base = (url ?? '').replace(/\/$/, '');
  return `${base}/functions/v1${path}`;
}

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

/** Thrown when an Edge Function returns a non-2xx JSON body with optional `code` / `request_ids`. */
export class EdgeFunctionHttpError extends Error {
  readonly code?: string;
  readonly requestIds?: string[];

  constructor(message: string, opts?: { code?: string; requestIds?: string[] }) {
    super(message);
    this.name = 'EdgeFunctionHttpError';
    this.code = opts?.code;
    this.requestIds = opts?.requestIds;
  }
}

function edgeHttpErrorFromPayload(json: unknown, fallbackMessage: string): EdgeFunctionHttpError {
  const o =
    json && typeof json === 'object' && !Array.isArray(json)
      ? (json as Record<string, unknown>)
      : {};
  const code =
    (typeof o.code === 'string' && o.code) ||
    (typeof o.error === 'string' && o.error) ||
    undefined;
  const message =
    (typeof o.message === 'string' && o.message) ||
    (typeof o.error === 'string' && o.error) ||
    fallbackMessage;
  const rawIds = o.request_ids;
  const requestIds = Array.isArray(rawIds)
    ? rawIds.filter((x): x is string => typeof x === 'string')
    : undefined;
  return new EdgeFunctionHttpError(message, { code, requestIds });
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
  const invokeUrl = functionsHttpUrl(path);
  const res = await fetch(invokeUrl, {
    method: options.method ?? 'POST',
    headers: {
      Authorization: `Bearer ${options.token}`,
      apikey: anon,
      ...(options.method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(options.method !== 'GET' ? { body: JSON.stringify(options.body ?? {}) } : {}),
  }).catch((error: unknown) => {
    const msg = error instanceof Error ? error.message : String(error);
    const directTarget = `${functionsBase()}/functions/v1`;
    const hint =
      msg.includes('fetch') || msg.includes('NetworkError')
        ? usesFunctionsBffProxy()
          ? ` Request URL was ${invokeUrl}. If still failing, check Vercel rewrites for /bff/functions → Supabase or local Vite proxy.`
          : ` Check DevTools → Network for ${directTarget}. If blocked by an extension/network, set VITE_SUPABASE_FUNCTIONS_BFF_PREFIX=/bff/functions in hosting + add the Vercel rewrite (see .env.example), or whitelist *.supabase.co. Also verify VITE_SUPABASE_URL and Edge CORS.`
        : '';
    throw new Error(`${options.networkErrorPrefix ?? 'Could not reach Edge Function'}: ${msg}.${hint}`);
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

/** Same-origin-friendly call when `functions.invoke` drops the body or hits relay issues (common on hosted builds). */
async function invokeFunctionDirectFetch(
  name: string,
  body: object | undefined,
  token: string
): Promise<Record<string, unknown>> {
  const { res, text, json } = await fetchFunctionEndpoint(`/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: body ?? {},
    token,
    networkErrorPrefix: 'Could not reach Edge Function. Deploy functions and check network / ad blockers',
  });
  if (!res.ok) {
    throw edgeHttpErrorFromPayload(json, responseMessage(res, text, json));
  }
  if (json != null && typeof json === 'object' && !Array.isArray(json)) {
    return json as Record<string, unknown>;
  }
  return {};
}

/**
 * Call Edge Functions with the session JWT. Uses `supabase.functions.invoke` first; falls back to
 * direct `fetch` when the relay fails or returns no JSON body (fixes production/Vercel + some browsers).
 * Retries once after `refreshSession()` on 401.
 */
export async function invokeFunction(name: string, body?: object) {
  if (!url || !anon) {
    throw new Error(
      'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env - add them with the VITE_ prefix and restart npm run dev.'
    );
  }

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session?.access_token) {
    throw new Error('Not authenticated - please log in again.');
  }

  const networkErrorPrefix =
    'Could not reach Edge Function. Deploy functions and check network / ad blockers';

  if (usesFunctionsBffProxy()) {
    let lastRelay: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const tokenNow = (await supabase.auth.getSession()).data.session?.access_token;
      if (!tokenNow) throw new Error('Not authenticated - please log in again.');
      try {
        return await invokeFunctionDirectFetch(name, body, tokenNow);
      } catch (e) {
        lastRelay = e;
        const msg = e instanceof Error ? e.message : String(e);
        if (attempt === 0 && jwtHint401(msg)) {
          const { data: refreshed } = await supabase.auth.refreshSession();
          if (refreshed.session?.access_token) continue;
        }
        throw e instanceof Error ? e : new Error(String(e));
      }
    }
    throw lastRelay instanceof Error ? lastRelay : new Error(String(lastRelay));
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const tokenNow = (await supabase.auth.getSession()).data.session?.access_token;
    if (!tokenNow) {
      throw new Error('Not authenticated - please log in again.');
    }

    const { data, error } = await supabase.functions.invoke(name, { body: body ?? {} });

    if (!error) {
      if (data != null && typeof data === 'object' && !Array.isArray(data)) {
        return data as Record<string, unknown>;
      }
      return await invokeFunctionDirectFetch(name, body, tokenNow);
    }

    if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) {
      try {
        return await invokeFunctionDirectFetch(name, body, tokenNow);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`${networkErrorPrefix} (${error.message}). Direct fetch: ${msg}`);
      }
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
          `${msg || 'Unauthorized'} - Sign out and sign in again, and confirm VITE_SUPABASE_URL / anon key match the project where functions are deployed (redeploy after changing env vars).`
        );
      }
      throw edgeHttpErrorFromPayload(json, msg);
    }

    throw new Error(error instanceof Error ? error.message : 'Edge Function error');
  }

  throw new Error('Unauthorized - please sign in again.');
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
  const urls = await fetchProfilePhotoSignedUrls(profileId);
  return urls[0] ?? null;
}

/** All gallery photos the viewer may see (same access rules as single photo). */
export async function fetchProfilePhotoSignedUrls(profileId: string): Promise<string[]> {
  const token = await getAccessToken();
  if (!token || !url || !anon) return [];
  const res = await fetch(
    functionsHttpUrl(`/serve-photo?profile_id=${encodeURIComponent(profileId)}`),
    { headers: { Authorization: `Bearer ${token}`, apikey: anon } }
  ).catch(() => null);
  if (!res || !res.ok) return [];
  const j = (await res.json()) as { signedUrl?: string; signedUrls?: string[] };
  if (Array.isArray(j.signedUrls) && j.signedUrls.length > 0) {
    return j.signedUrls.filter((u): u is string => typeof u === 'string' && u.length > 0);
  }
  return j.signedUrl ? [j.signedUrl] : [];
}
