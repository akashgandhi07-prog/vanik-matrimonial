import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { Webhook } from 'https://esm.sh/svix@1.45.1';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { getAdminClient } from '../_shared/dispatch-email.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET') ?? Deno.env.get('SVIX_SECRET');
  if (!secret) {
    return jsonResponse({ error: 'Webhook not configured' }, 500);
  }

  const payload = await req.text();
  const svixId = req.headers.get('svix-id');
  const svixTs = req.headers.get('svix-timestamp');
  const svixSig = req.headers.get('svix-signature');
  if (!svixId || !svixTs || !svixSig) {
    return jsonResponse({ error: 'Missing svix headers' }, 400);
  }

  let evt: { type?: string; data?: Record<string, unknown> };
  try {
    const wh = new Webhook(secret);
    evt = wh.verify(payload, {
      'svix-id': svixId,
      'svix-timestamp': svixTs,
      'svix-signature': svixSig,
    }) as { type?: string; data?: Record<string, unknown> };
  } catch {
    return jsonResponse({ error: 'Invalid signature' }, 400);
  }

  const type = evt.type ?? '';
  const data = evt.data ?? {};
  const emailId = String(data.email_id ?? data.id ?? '');

  if (!emailId) {
    return jsonResponse({ ok: true, ignored: true });
  }

  let status: string | null = null;
  let failure_detail: string | null = null;

  if (type === 'email.delivered') {
    status = 'delivered';
  } else if (type === 'email.bounced') {
    status = 'bounced';
    const bounce = data.bounce as { message?: string } | undefined;
    failure_detail = bounce?.message ? bounce.message.slice(0, 2000) : null;
  } else if (type === 'email.failed') {
    status = 'failed';
    failure_detail = String(data.error_message ?? data.message ?? '').slice(0, 2000);
  } else {
    return jsonResponse({ ok: true, ignored: type });
  }

  const admin = getAdminClient();
  const now = new Date().toISOString();

  const { error } = await admin
    .from('email_log')
    .update({
      status,
      failure_detail,
      delivery_updated_at: now,
    })
    .eq('resend_message_id', emailId);

  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }

  return jsonResponse({ ok: true });
});
