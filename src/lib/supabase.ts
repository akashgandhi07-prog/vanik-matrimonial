import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anon) {
  console.warn('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set');
}

export const supabase = createClient(url ?? '', anon ?? '');

function functionsBase(): string {
  return (url ?? '').replace(/\/$/, '');
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
  // #region agent log
  fetch('http://127.0.0.1:7813/ingest/32d55c98-7c74-4dbe-b522-f4df48baf028',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'cbfc57'},body:JSON.stringify({sessionId:'cbfc57',runId:'pre-fix',hypothesisId:'H1',location:'src/lib/supabase.ts:invokeFunction:entry',message:'invokeFunction called',data:{name,hasBody:typeof body==='object'&&body!==null,bodyKeyCount:body&&typeof body==='object'?Object.keys(body).length:0,hasUrl:Boolean(url),hasAnon:Boolean(anon)},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  if (!url || !anon) {
    throw new Error(
      'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env — add them with the VITE_ prefix and restart npm run dev.'
    );
  }

  await supabase.auth.refreshSession().catch(() => {
    /* ignore; fall back to existing session */
  });

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  // #region agent log
  fetch('http://127.0.0.1:7813/ingest/32d55c98-7c74-4dbe-b522-f4df48baf028',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'cbfc57'},body:JSON.stringify({sessionId:'cbfc57',runId:'pre-fix',hypothesisId:'H2',location:'src/lib/supabase.ts:invokeFunction:session',message:'session checked before invoke',data:{name,hasSession:Boolean(sessionData.session),hasToken:Boolean(token),tokenLength:typeof token==='string'?token.length:0},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  if (!token) {
    throw new Error('Not authenticated — please log in again.');
  }

  const requestUrl = `${functionsBase()}/functions/v1/${encodeURIComponent(name)}`;
  // #region agent log
  fetch('http://127.0.0.1:7813/ingest/32d55c98-7c74-4dbe-b522-f4df48baf028',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'cbfc57'},body:JSON.stringify({sessionId:'cbfc57',runId:'pre-fix',hypothesisId:'H3',location:'src/lib/supabase.ts:invokeFunction:beforeFetch',message:'about to call edge function',data:{name,requestUrl,urlHost:requestUrl.split('/').slice(0,3).join('/'),hasAuthorizationHeader:Boolean(token),payloadBytes:JSON.stringify(body??{}).length},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  const res = await fetch(requestUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anon,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  }).catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    // #region agent log
    fetch('http://127.0.0.1:7813/ingest/32d55c98-7c74-4dbe-b522-f4df48baf028',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'cbfc57'},body:JSON.stringify({sessionId:'cbfc57',runId:'pre-fix',hypothesisId:'H4',location:'src/lib/supabase.ts:invokeFunction:fetchCatch',message:'network error while calling edge function',data:{name,errorMessage:msg},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    throw new Error(
      `Could not reach Edge Function: ${msg}. Deploy functions and check network / ad blockers.`
    );
  });
  // #region agent log
  fetch('http://127.0.0.1:7813/ingest/32d55c98-7c74-4dbe-b522-f4df48baf028',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'cbfc57'},body:JSON.stringify({sessionId:'cbfc57',runId:'pre-fix',hypothesisId:'H5',location:'src/lib/supabase.ts:invokeFunction:response',message:'edge function response received',data:{name,status:res.status,ok:res.ok,statusText:res.statusText},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* plain text body */
    }
  }

  if (res.status === 402) {
    const o = json as { code?: string; error?: string } | null;
    if (o?.code === 'PAYMENT_REQUIRED') {
      throw new Error('PAYMENT_REQUIRED');
    }
  }

  if (!res.ok) {
    const o = json as { error?: string; message?: string; code?: number } | null;
    const msg =
      (o && typeof o.message === 'string' && o.message) ||
      (o && typeof o.error === 'string' && o.error) ||
      text.slice(0, 400) ||
      res.statusText;
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
  if (!url || !anon) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
  }
  const res = await fetch(`${functionsBase()}/functions/v1/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${anon}`,
      apikey: anon,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  }).catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Could not reach Edge Function: ${msg}`);
  });
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* plain */
    }
  }
  if (!res.ok) {
    const o = json as { error?: string; message?: string } | null;
    const msg =
      (o && typeof o.message === 'string' && o.message) ||
      (o && typeof o.error === 'string' && o.error) ||
      text.slice(0, 400) ||
      res.statusText;
    throw new Error(msg);
  }
  return (json ?? {}) as Record<string, unknown>;
}

export async function fetchPublicFunction(pathAndQuery: string) {
  if (!url || !anon) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
  }
  const path = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`;
  const res = await fetch(`${functionsBase()}/functions/v1${path}`, {
    headers: { Authorization: `Bearer ${anon}`, apikey: anon },
  }).catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Could not reach Edge Function: ${msg}`);
  });
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* plain */
    }
  }
  if (!res.ok) {
    const o = json as { error?: string } | null;
    throw new Error((o && typeof o.error === 'string' && o.error) || text.slice(0, 400) || res.statusText);
  }
  return (json ?? {}) as Record<string, unknown>;
}

/** POST with optional Bearer (session); falls back to anon when token is null. */
export async function postFunctionOptionalAuth(
  name: string,
  body: object,
  accessToken: string | null
) {
  if (!url || !anon) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
  }
  const token = accessToken ?? anon;
  const res = await fetch(`${functionsBase()}/functions/v1/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anon,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }).catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Could not reach Edge Function: ${msg}`);
  });
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* plain */
    }
  }
  if (!res.ok) {
    const o = json as { error?: string; message?: string } | null;
    const msg =
      (o && typeof o.message === 'string' && o.message) ||
      (o && typeof o.error === 'string' && o.error) ||
      text.slice(0, 400) ||
      res.statusText;
    throw new Error(msg);
  }
  return (json ?? {}) as Record<string, unknown>;
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
