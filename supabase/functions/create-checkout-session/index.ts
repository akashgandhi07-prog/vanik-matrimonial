import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';
import { getAdminClient } from '../_shared/dispatch-email.ts';
import { checkoutRedirectBase } from '../_shared/site-url.ts';

type Purpose = 'registration' | 'renewal';

function safeInternalPath(p: unknown, fallback: string): string {
  if (typeof p !== 'string' || !p.startsWith('/') || p.includes('//') || p.includes('..')) {
    return fallback;
  }
  return p;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeadersFor(req) });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, req, 405);
  }

  const secret = Deno.env.get('STRIPE_SECRET_KEY')?.trim();
  const priceId = Deno.env.get('STRIPE_MEMBERSHIP_PRICE_ID')?.trim();
  if (!secret || !priceId) {
    return jsonResponse({ error: 'Stripe is not configured on the server.' }, req, 503);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, req, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const userClient = createClient(supabaseUrl, anon, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return jsonResponse({ error: 'Unauthorized' }, req, 401);
  }

  let body: {
    purpose?: Purpose;
    renewal_success_path?: string;
    renewal_cancel_path?: string;
    /** Browser origin (e.g. https://hostname) — must be allowlisted; see checkoutRedirectBase. */
    client_origin?: string;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, req, 400);
  }

  const purpose = body.purpose === 'renewal' ? 'renewal' : 'registration';
  const base = checkoutRedirectBase(body.client_origin);

  const admin = getAdminClient();
  const uid = userData.user.id;

  let profileId: string | null = null;

  if (purpose === 'registration') {
    const { data: existing } = await admin.from('profiles').select('id').eq('auth_user_id', uid).maybeSingle();
    if (existing) {
      return jsonResponse({ error: 'You already have a profile. Use renewal instead.' }, req, 400);
    }
  } else {
    const { data: prof, error: pe } = await admin
      .from('profiles')
      .select('id, status')
      .eq('auth_user_id', uid)
      .maybeSingle();
    if (pe || !prof) {
      return jsonResponse({ error: 'No profile found for this account.' }, req, 404);
    }
    const st = prof.status as string;
    const renewable = new Set(['active', 'matched', 'expired', 'archived']);
    if (!renewable.has(st)) {
      return jsonResponse({
        error:
          'Membership renewal is only available when your profile is active, matched, expired, or archived.',
      }, req, 400);
    }
    profileId = prof.id as string;
  }

  const successPath =
    purpose === 'registration'
      ? '/register'
      : safeInternalPath(body.renewal_success_path, '/membership-expired');
  const cancelPath =
    purpose === 'registration'
      ? '/register'
      : safeInternalPath(body.renewal_cancel_path, '/membership-expired');
  const successUrl = `${base}${successPath}?checkout=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${base}${cancelPath}?checkout=cancel`;

  const params = new URLSearchParams();
  params.append('mode', 'payment');
  params.append('payment_method_types[]', 'card');
  params.append('line_items[0][price]', priceId);
  params.append('line_items[0][quantity]', '1');
  params.append('success_url', successUrl);
  params.append('cancel_url', cancelUrl);
  params.append('client_reference_id', uid);
  params.append('metadata[supabase_user_id]', uid);
  params.append('metadata[purpose]', purpose);
  if (profileId) {
    params.append('metadata[profile_id]', profileId);
  }

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    const msg = (json.error as { message?: string } | undefined)?.message ?? text.slice(0, 300);
    return jsonResponse({ error: msg || 'Stripe checkout create failed' }, req, 502);
  }

  const url = json.url as string | undefined;
  const id = json.id as string | undefined;
  if (!url || !id) {
    return jsonResponse({ error: 'Invalid Stripe response' }, req, 502);
  }

  return jsonResponse({ url, session_id: id }, req);
});
