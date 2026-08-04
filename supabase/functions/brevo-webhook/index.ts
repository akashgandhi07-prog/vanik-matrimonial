import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { corsHeadersFor, jsonResponse } from '../_shared/cors.ts';
import { getAdminClient } from '../_shared/dispatch-email.ts';

// Brevo transactional webhook -> email_log delivery statuses.
//
// Brevo cannot sign payloads, so the webhook URL carries a shared token
// (?token=...) checked against BREVO_WEBHOOK_TOKEN. SMTP sends do not record
// a provider message id at send time, so events are matched to the most
// recent email_log row for the recipient (preferring a subject match); the
// Brevo message id is then stored so follow-up events for the same email
// (e.g. deferred -> delivered) hit the same row.

type BrevoEvent = {
  event?: string;
  email?: string;
  subject?: string;
  reason?: string;
  'message-id'?: string;
};

/** Higher rank wins; a later lower-rank event never downgrades the status. */
const STATUS_RANK: Record<string, number> = {
  sent: 0,
  failed: 0,
  skipped: 0,
  deferred: 1,
  delivered: 2,
  bounced: 3,
  blocked: 3,
  spam: 3,
};

function mapEvent(event: string): { status: string; isFailure: boolean } | null {
  switch (event) {
    case 'delivered':
      return { status: 'delivered', isFailure: false };
    case 'hard_bounce':
    case 'invalid_email':
      return { status: 'bounced', isFailure: true };
    case 'blocked':
      return { status: 'blocked', isFailure: true };
    case 'spam':
    case 'complaint':
      return { status: 'spam', isFailure: true };
    case 'soft_bounce':
    case 'deferred':
    case 'error':
      return { status: 'deferred', isFailure: true };
    default:
      // opened / click / unsubscribed etc are not delivery states.
      return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeadersFor(req) });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, req, 405);
  }

  const expected = Deno.env.get('BREVO_WEBHOOK_TOKEN')?.trim();
  if (!expected) {
    return jsonResponse({ error: 'Webhook not configured' }, req, 500);
  }
  const token = new URL(req.url).searchParams.get('token') ?? '';
  if (token !== expected) {
    return jsonResponse({ error: 'Unauthorized' }, req, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, req, 400);
  }
  const events: BrevoEvent[] = Array.isArray(body) ? (body as BrevoEvent[]) : [body as BrevoEvent];

  const admin = getAdminClient();
  let updated = 0;

  for (const ev of events) {
    const mapped = ev.event ? mapEvent(ev.event) : null;
    const email = ev.email?.trim().toLowerCase();
    if (!mapped || !email) continue;

    const messageId = ev['message-id']?.trim() || null;
    const reason = ev.reason?.trim() || null;

    // Prefer an exact provider-id match (set by an earlier event for this email).
    let rowId: string | null = null;
    let currentStatus = 'sent';
    if (messageId) {
      const { data: byId } = await admin
        .from('email_log')
        .select('id, status')
        .eq('resend_message_id', messageId)
        .maybeSingle();
      if (byId) {
        rowId = byId.id as string;
        currentStatus = String(byId.status);
      }
    }

    if (!rowId) {
      const cutoff = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
      const { data: recent } = await admin
        .from('email_log')
        .select('id, status, subject, resend_message_id')
        .ilike('recipient_email', `%${email}%`)
        .gte('sent_at', cutoff)
        .order('sent_at', { ascending: false })
        .limit(5);
      const rows = (recent ?? []) as { id: string; status: string; subject: string | null; resend_message_id: string | null }[];
      const candidates = rows.filter((r) => !r.resend_message_id || r.resend_message_id === messageId);
      const match =
        (ev.subject ? candidates.find((r) => r.subject === ev.subject) : undefined) ?? candidates[0] ?? rows[0];
      if (!match) continue;
      rowId = match.id;
      currentStatus = match.status;
    }

    const currentRank = STATUS_RANK[currentStatus] ?? 0;
    const newRank = STATUS_RANK[mapped.status] ?? 0;
    if (newRank < currentRank) continue;

    const { error } = await admin
      .from('email_log')
      .update({
        status: mapped.status,
        failure_detail: mapped.isFailure ? (reason ?? `Brevo event: ${ev.event}`) : null,
        delivery_updated_at: new Date().toISOString(),
        ...(messageId ? { resend_message_id: messageId } : {}),
      })
      .eq('id', rowId);
    if (!error) updated += 1;
  }

  return jsonResponse({ ok: true, updated }, req);
});
