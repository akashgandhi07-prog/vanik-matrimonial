import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ProfileThumb } from '../member/ProfileThumb';
import { useMemberArea } from '../member/memberContext';
import { invokeFunction } from '../lib/supabase';
import { whatsappUrlFromPhone } from '../lib/whatsapp';

type ContactDetailRow = {
  profile_id: string;
  first_name: string;
  full_name: string;
  reference_number: string;
  mobile: string;
  email: string;
  father_name: string;
  mother_name: string;
};

function telHref(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, '');
  return cleaned ? `tel:${cleaned}` : `tel:${encodeURIComponent(phone)}`;
}

const WEEK_MS = 7 * 86400000;

export default function MemberRequests() {
  const { profile, candidates, requests, feedbackKeys } = useMemberArea();
  const [contactsByRequest, setContactsByRequest] = useState<Record<string, ContactDetailRow[]>>({});
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (requests.length === 0) {
      setContactsByRequest({});
      setContactsError(null);
      return () => {
        cancelled = true;
      };
    }

    async function loadContacts() {
      setContactsLoading(true);
      setContactsError(null);
      try {
        const res = (await invokeFunction('member-request-contacts', {
          request_ids: requests.map((r) => r.id),
        })) as {
          contacts_by_request?: Record<string, ContactDetailRow[]>;
        };
        if (cancelled) return;
        setContactsByRequest((res.contacts_by_request ?? {}) as Record<string, ContactDetailRow[]>);
      } catch (e) {
        if (cancelled) return;
        setContactsError(e instanceof Error ? e.message : 'Could not load contact details.');
      } finally {
        if (!cancelled) setContactsLoading(false);
      }
    }

    void loadContacts();
    return () => {
      cancelled = true;
    };
  }, [requests]);

  const weeklyWindow = useMemo(() => {
    const cutoff = Date.now() - WEEK_MS;
    const usedCandidateIds = new Set<string>();
    let oldestRecentRequestMs: number | null = null;

    for (const r of requests) {
      const requestMs = new Date(r.created_at).getTime();
      if (Number.isNaN(requestMs) || requestMs <= cutoff) continue;
      oldestRecentRequestMs = oldestRecentRequestMs == null ? requestMs : Math.min(oldestRecentRequestMs, requestMs);
      const candidateIds = Array.isArray(r.candidate_ids) ? (r.candidate_ids as string[]) : [];
      for (const candidateId of candidateIds) usedCandidateIds.add(candidateId);
    }

    const used = usedCandidateIds.size;
    const remaining = Math.max(0, 3 - used);
    return {
      used,
      remaining,
      locked: remaining === 0,
      resetAt:
        oldestRecentRequestMs != null
          ? new Date(oldestRecentRequestMs + WEEK_MS).toLocaleDateString('en-GB')
          : null,
    };
  }, [requests]);

  if (!profile) return null;

  if (requests.length === 0) {
    return (
      <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
        <p style={{ margin: 0, fontWeight: 500 }}>No requests yet</p>
        <p style={{ margin: '8px 0 0', fontSize: 14 }}>
          Go to <Link to="/dashboard/browse">Browse</Link> and select up to 3 candidates to request their contact details.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Contact requests</h3>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 0 }}>
        Everything you requested is shown here, so you can call or message directly from this screen. You can request details for up to
        3 <strong>distinct</strong> candidates per rolling 7-day window (and cannot request the same profile again until that window
        passes). If you still owe feedback on introductions older than 21 days, new requests are blocked until that feedback is submitted.
      </p>
      <div
        style={{
          margin: '12px 0 16px',
          padding: '10px 12px',
          borderRadius: 10,
          border: `1px solid ${weeklyWindow.locked ? 'rgba(217,119,6,0.3)' : 'var(--color-border)'}`,
          background: weeklyWindow.locked ? 'rgba(217,119,6,0.08)' : 'var(--color-surface)',
          fontSize: 13,
          color: weeklyWindow.locked ? 'var(--color-warning)' : 'var(--color-text-secondary)',
        }}
      >
        {weeklyWindow.locked ? (
          <>
            You have used all 3 request slots in the last 7 days. You cannot submit any new requests
            {weeklyWindow.resetAt ? ` until ${weeklyWindow.resetAt}` : ''}.
          </>
        ) : (
          <>
            Weekly request usage: {weeklyWindow.used}/3 used, {weeklyWindow.remaining}/3 remaining.
          </>
        )}
      </div>
      {contactsLoading && (
        <p style={{ marginTop: 0, fontSize: 13, color: 'var(--color-text-secondary)' }}>Loading requested contact details...</p>
      )}
      {contactsError && (
        <p style={{ marginTop: 0, fontSize: 13, color: 'var(--color-danger)' }}>
          Could not refresh contact details ({contactsError}). Existing request history is still shown below.
        </p>
      )}
      <div className="table-scroll">
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
            <th style={{ padding: 8 }}>Date</th>
            <th style={{ padding: 8 }}>Candidates</th>
            <th style={{ padding: 8 }}>Feedback</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => {
            const candidateIds = Array.isArray(r.candidate_ids) ? (r.candidate_ids as string[]) : [];
            const allFeedbackGiven = candidateIds.every((cid) =>
              feedbackKeys.has(`${r.id}:${cid}`)
            );
            const contacts = contactsByRequest[r.id] ?? [];
            return (
              <tr
                key={r.id}
                style={{
                  borderBottom: '1px solid var(--color-border)',
                  background: allFeedbackGiven ? undefined : 'rgba(217, 119, 6, 0.04)',
                }}
              >
                <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                  {new Date(r.created_at).toLocaleDateString('en-GB')}
                </td>
                <td style={{ padding: 8, minWidth: 0 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {candidateIds.map((id) => {
                      const c = candidates.find((x) => x.id === id);
                      const details = contacts.find((row) => row.profile_id === id);
                      const displayName = details?.full_name || (c ? c.first_name : `Member ${id.slice(0, 8)}...`);
                      const refNo = details?.reference_number || c?.reference_number || id.slice(0, 6);
                      const wa = details?.mobile ? whatsappUrlFromPhone(details.mobile) : null;
                      return (
                        <div
                          key={id}
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 10,
                            padding: 8,
                            borderRadius: 10,
                            border: '1px solid var(--color-border)',
                            background: 'var(--color-surface)',
                          }}
                        >
                          <div
                            style={{
                              width: 40,
                              height: 40,
                              borderRadius: 8,
                              overflow: 'hidden',
                              flexShrink: 0,
                              border: '1px solid var(--color-border)',
                            }}
                          >
                            <ProfileThumb profileId={id} firstName={c?.first_name ?? 'Member'} />
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, overflowWrap: 'anywhere' }}>
                              {displayName}
                              <span style={{ fontWeight: 400, color: 'var(--color-text-secondary)' }}> · Ref {refNo}</span>
                            </div>
                            {details?.mobile ? (
                              <>
                                <div style={{ marginTop: 4, fontSize: 13 }}>
                                  <a href={telHref(details.mobile)} style={{ fontWeight: 600 }}>
                                    {details.mobile}
                                  </a>
                                </div>
                                {details.email ? (
                                  <div style={{ marginTop: 2, fontSize: 12, color: 'var(--color-text-secondary)' }}>
                                    {details.email}
                                  </div>
                                ) : null}
                                {(details.father_name || details.mother_name) && (
                                  <div style={{ marginTop: 4, fontSize: 12, color: 'var(--color-text-secondary)' }}>
                                    {details.father_name ? `Father: ${details.father_name}` : ''}
                                    {details.father_name && details.mother_name ? ' · ' : ''}
                                    {details.mother_name ? `Mother: ${details.mother_name}` : ''}
                                  </div>
                                )}
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                                  <a className="btn btn-secondary" href={telHref(details.mobile)} style={{ padding: '4px 10px', fontSize: 12 }}>
                                    Call
                                  </a>
                                  {wa ? (
                                    <a
                                      className="btn-whatsapp"
                                      href={wa}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      aria-label={`WhatsApp ${details.first_name}`}
                                      style={{ padding: '4px 10px', fontSize: 12 }}
                                    >
                                      WhatsApp
                                    </a>
                                  ) : null}
                                </div>
                              </>
                            ) : (
                              <div style={{ marginTop: 4, fontSize: 12, color: 'var(--color-text-secondary)' }}>
                                Contact details are loading or unavailable.
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </td>
                <td style={{ padding: 8, fontSize: 13 }}>
                  <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    Feedback is anonymous to candidates and helps us improve the service.
                  </p>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {candidateIds.map((cid) => {
                      const key = `${r.id}:${cid}`;
                      const c = candidates.find((x) => x.id === cid);
                      const details = contacts.find((row) => row.profile_id === cid);
                      const name = details?.first_name || c?.first_name || cid.slice(0, 8) + '…';
                      if (feedbackKeys.has(key)) {
                        return (
                          <li key={key} style={{ marginBottom: 4 }}>
                            {name}: <span className="badge badge-success">✓ Submitted</span>
                          </li>
                        );
                      }
                      return (
                        <li key={key} style={{ marginBottom: 4 }}>
                          {name}:{' '}
                          <Link
                            to={`/feedback/${r.id}/${cid}`}
                            className="btn btn-secondary"
                            style={{ padding: '2px 8px', fontSize: 12 }}
                            title="Anonymous to candidates. Helps us improve the service."
                          >
                            Give anonymous feedback
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
