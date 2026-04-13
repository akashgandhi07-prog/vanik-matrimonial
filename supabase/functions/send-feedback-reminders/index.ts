import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { stripHtml } from '../_shared/sanitize.ts';
import { jsonResponse } from '../_shared/cors.ts';
import { cronUnauthorized } from '../_shared/cron-guard.ts';
import { dispatchEmail, getAdminClient } from '../_shared/dispatch-email.ts';

function siteUrl(): string {
  return Deno.env.get('PUBLIC_SITE_URL') ?? 'https://vanikmatrimonial.co.uk';
}

function daysSince(iso: string): number {
  const t = new Date(iso).getTime();
  return (Date.now() - t) / 864e5;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }
  const deny = cronUnauthorized(req);
  if (deny) return deny;

  const admin = getAdminClient();
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) {
    return jsonResponse({ ok: true, skipped: true, reason: 'no_resend' });
  }

  const { data: requests, error } = await admin
    .from('requests')
    .select(
      'id, created_at, candidate_ids, requester_id, feedback_reminder_21_sent_at, feedback_reminder_35_sent_at'
    )
    .order('created_at', { ascending: true });

  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }

  let emails = 0;

  for (const reqRow of requests ?? []) {
    const rid = reqRow.id as string;
    const requesterId = reqRow.requester_id as string | null;
    if (!requesterId) continue;
    const created = reqRow.created_at as string;
    const cids = (reqRow.candidate_ids as string[]) ?? [];
    const age = daysSince(created);
    if (age < 21) continue;

    const outstanding: string[] = [];
    for (const cid of cids) {
      const { count } = await admin
        .from('feedback')
        .select('id', { count: 'exact', head: true })
        .eq('request_id', rid)
        .eq('candidate_id', cid);
      if ((count ?? 0) === 0) outstanding.push(cid);
    }
    if (outstanding.length === 0) continue;

    const sent21 = !!reqRow.feedback_reminder_21_sent_at;
    const sent35 = !!reqRow.feedback_reminder_35_sent_at;

    let emailType: 'feedback_reminder_21' | 'feedback_reminder_35' | null = null;
    if (age >= 35 && !sent35) {
      emailType = 'feedback_reminder_35';
    } else if (age >= 21 && !sent21) {
      emailType = 'feedback_reminder_21';
    }
    if (!emailType) continue;

    const { data: requester } = await admin
      .from('profiles')
      .select('first_name')
      .eq('id', requesterId)
      .single();
    const firstName = stripHtml(String(requester?.first_name ?? 'Member'), 80);

    const expiresAt = new Date(Date.now() + 14 * 864e5).toISOString();
    const linkParts: string[] = [];

    for (const cid of outstanding) {
      const { data: token, error: rpcErr } = await admin.rpc('refresh_feedback_token', {
        p_request_id: rid,
        p_candidate_id: cid,
        p_requester_id: requesterId,
        p_expires_at: expiresAt,
      });
      if (rpcErr || token == null) continue;

      const { data: cand } = await admin
        .from('profiles')
        .select('reference_number, first_name')
        .eq('id', cid)
        .single();
      const ref = stripHtml(String(cand?.reference_number ?? cid), 20);
      const nm = stripHtml(String(cand?.first_name ?? ''), 60);
      const url = `${siteUrl()}/feedback/${rid}/${cid}?token=${token}`;
      linkParts.push(
        `<p style="margin:12px 0;"><a href="${url}">Feedback for ${nm} (${ref})</a></p>`
      );
    }

    if (linkParts.length === 0) continue;

    const r = await dispatchEmail(admin, resendKey, {
      type: emailType,
      recipientProfileId: requesterId,
      extraData: {
        first_name: firstName,
        links_html: linkParts.join(''),
      },
    });

    if (!r.ok) continue;

    emails++;
    const patch: Record<string, string> = {};
    if (emailType === 'feedback_reminder_21') {
      patch.feedback_reminder_21_sent_at = new Date().toISOString();
    } else {
      patch.feedback_reminder_35_sent_at = new Date().toISOString();
      if (!sent21) {
        patch.feedback_reminder_21_sent_at = new Date().toISOString();
      }
    }
    await admin.from('requests').update(patch).eq('id', rid);
  }

  return jsonResponse({ ok: true, emails_sent: emails });
});
