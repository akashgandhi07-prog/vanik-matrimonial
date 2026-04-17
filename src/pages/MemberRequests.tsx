import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ProfileModal } from '../member/ProfileModal';
import { ProfileThumb } from '../member/ProfileThumb';
import type { ProfileRow } from '../member/memberContext';
import { useMemberArea } from '../member/memberContext';
import { computeMonthlyWindow, computeWeeklyWindow } from '../member/requestQuota';
import { invokeFunction, supabase } from '../lib/supabase';
import { whatsappUrlFromPhone } from '../lib/whatsapp';

type ContactDetailRow = {
  request_id?: string;
  profile_id: string;
  first_name: string;
  full_name: string;
  reference_number: string;
  mobile: string;
  email: string;
  father_name: string;
  mother_name: string;
};

type RequestedProfileRpcRow = {
  request_id: string;
  profile_id: string;
  reference_number: string | null;
  gender: string;
  seeking_gender: 'Male' | 'Female' | 'Both' | null;
  first_name: string;
  age: number | null;
  created_at: string;
  updated_at: string;
  education: string | null;
  job_title: string | null;
  height_cm: number | null;
  diet: string | null;
  religion: string | null;
  community: string | null;
  nationality: string | null;
  place_of_birth: string | null;
  town_country_of_origin: string | null;
  future_settlement_plans: string | null;
  hobbies: string | null;
  photo_url: string | null;
  pending_photo_url: string | null;
  photo_status: string;
  status: string;
  show_on_register: boolean;
  membership_expires_at: string | null;
  rejection_reason: string | null;
  full_name: string | null;
  mobile: string | null;
  email: string | null;
  father_name: string | null;
  mother_name: string | null;
};

function telHref(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, '');
  return cleaned ? `tel:${cleaned}` : `tel:${encodeURIComponent(phone)}`;
}

function friendlyContactsError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const msg = raw.toLowerCase();
  if (
    msg.includes('member_request_profiles') ||
    msg.includes('function public.member_request_profiles') ||
    msg.includes('could not find the function public.member_request_profiles')
  ) {
    return 'Server update required: requested-profile contact lookup is not installed yet. Apply the latest Supabase migration and reload.';
  }
  if (
    msg.includes('member-request-contacts') &&
    (msg.includes('not found') || msg.includes('404'))
  ) {
    return 'Server update required: member-request-contacts function is not deployed in this project.';
  }
  if (
    msg.includes('could not reach edge function') ||
    msg.includes('failed to fetch') ||
    msg.includes('network') ||
    msg.includes('failed to send a request to the edge function')
  ) {
    return 'Contact details are temporarily unavailable. Please try again shortly.';
  }
  if (msg.includes('unauthorized') || msg.includes('not authenticated')) {
    return 'Your session has expired. Please sign in again.';
  }
  return 'Could not load contact details right now.';
}

export default function MemberRequests() {
  const { profile, candidates, requests, feedbackKeys, bookmarks, toggleBookmark } = useMemberArea();
  const [contactsByRequest, setContactsByRequest] = useState<Record<string, ContactDetailRow[]>>({});
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [profilesById, setProfilesById] = useState<Record<string, ProfileRow>>({});
  const [selectedProfile, setSelectedProfile] = useState<{
    profile: ProfileRow;
    contactDetails?: {
      mobile?: string | null;
      email?: string | null;
    };
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (requests.length === 0) {
      setContactsByRequest({});
      setProfilesById({});
      setContactsError(null);
      return () => {
        cancelled = true;
      };
    }

    async function loadContacts() {
      setContactsLoading(true);
      setContactsError(null);
      try {
        const requestIds = requests.map((r) => r.id);
        const { data: rpcRows, error: rpcErr } = await supabase.rpc('member_request_profiles', {
          p_request_ids: requestIds,
        });
        if (!rpcErr && Array.isArray(rpcRows)) {
          if (cancelled) return;
          const byRequest: Record<string, ContactDetailRow[]> = {};
          const byProfile: Record<string, ProfileRow> = {};
          for (const row of rpcRows as RequestedProfileRpcRow[]) {
            const contact: ContactDetailRow = {
              request_id: row.request_id,
              profile_id: row.profile_id,
              first_name: row.first_name,
              full_name: row.full_name ?? row.first_name,
              reference_number: row.reference_number ?? '',
              mobile: row.mobile ?? '',
              email: row.email ?? '',
              father_name: row.father_name ?? '',
              mother_name: row.mother_name ?? '',
            };
            if (!byRequest[row.request_id]) byRequest[row.request_id] = [];
            byRequest[row.request_id].push(contact);
            byProfile[row.profile_id] = {
              id: row.profile_id,
              reference_number: row.reference_number,
              gender: row.gender,
              seeking_gender: row.seeking_gender ?? undefined,
              first_name: row.first_name,
              age: row.age,
              created_at: row.created_at,
              updated_at: row.updated_at,
              education: row.education,
              job_title: row.job_title,
              height_cm: row.height_cm,
              diet: row.diet,
              religion: row.religion,
              community: row.community,
              nationality: row.nationality,
              place_of_birth: row.place_of_birth,
              town_country_of_origin: row.town_country_of_origin,
              future_settlement_plans: row.future_settlement_plans,
              hobbies: row.hobbies,
              photo_url: row.photo_url,
              pending_photo_url: row.pending_photo_url,
              photo_status: row.photo_status,
              status: row.status,
              show_on_register: row.show_on_register,
              membership_expires_at: row.membership_expires_at,
              rejection_reason: row.rejection_reason,
            };
          }
          setContactsByRequest(byRequest);
          setProfilesById(byProfile);
          return;
        }

        const rpcMessage = rpcErr?.message ?? 'RPC failed';
        // Fallback to edge function if RPC is unavailable (e.g. migration not applied yet).
        let res: { contacts_by_request?: Record<string, ContactDetailRow[]> } | null = null;
        let edgeMessage: string | null = null;
        try {
          res = (await invokeFunction('member-request-contacts', {
            request_ids: requestIds,
          })) as {
            contacts_by_request?: Record<string, ContactDetailRow[]>;
          };
        } catch (edgeErr) {
          edgeMessage = edgeErr instanceof Error ? edgeErr.message : String(edgeErr ?? '');
        }
        if (!res) {
          throw new Error(`RPC: ${rpcMessage}. EDGE: ${edgeMessage ?? 'unknown failure'}`);
        }
        if (cancelled) return;
        setContactsByRequest((res.contacts_by_request ?? {}) as Record<string, ContactDetailRow[]>);

        // Best-effort profile fallback from browse cache and direct profile query.
        const ids = [...new Set(requests.flatMap((r) => (Array.isArray(r.candidate_ids) ? (r.candidate_ids as string[]) : [])))];
        const fromCandidates: Record<string, ProfileRow> = {};
        for (const c of candidates) fromCandidates[c.id] = c;
        const missing = ids.filter((id) => !fromCandidates[id]);
        if (missing.length === 0) {
          setProfilesById(fromCandidates);
          return;
        }
        const { data } = await supabase.from('profiles').select('*').in('id', missing);
        if (cancelled) return;
        const merged: Record<string, ProfileRow> = { ...fromCandidates };
        for (const row of (data ?? []) as ProfileRow[]) merged[row.id] = row;
        setProfilesById(merged);
      } catch (e) {
        if (cancelled) return;
        setContactsError(friendlyContactsError(e));
      } finally {
        if (!cancelled) setContactsLoading(false);
      }
    }

    void loadContacts();
    return () => {
      cancelled = true;
    };
  }, [requests, candidates]);

  const weeklyWindow = useMemo(() => computeWeeklyWindow(requests), [requests]);

  const monthlyWindow = useMemo(() => computeMonthlyWindow(requests), [requests]);

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
        Everything you requested is shown here, so you can call or message directly from this screen.
        Limits: up to <strong>3</strong> distinct profiles per rolling 7-day window, and up to{' '}
        <strong>6 distinct profiles</strong> per calendar month (asking again for someone you already requested this
        month does not use
        an extra monthly slot once the 7-day cooldown has passed). If you still owe feedback on introductions older than
        21 days, new requests are blocked until that feedback is submitted.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0 16px' }}>
        <div
          style={{
            flex: '1 1 200px',
            padding: '10px 12px',
            borderRadius: 10,
            border: `1px solid ${weeklyWindow.locked ? 'rgba(217,119,6,0.3)' : 'var(--color-border)'}`,
            background: weeklyWindow.locked ? 'rgba(217,119,6,0.08)' : 'var(--color-surface)',
            fontSize: 13,
            color: weeklyWindow.locked ? 'var(--color-warning)' : 'var(--color-text-secondary)',
          }}
        >
          {weeklyWindow.locked ? (
            <>All 3 weekly slots used. Resets {weeklyWindow.resetAt ?? 'soon'}.</>
          ) : (
            <>This week: {weeklyWindow.used}/3 distinct profiles · {weeklyWindow.remaining} remaining</>
          )}
        </div>
        <div
          style={{
            flex: '1 1 200px',
            padding: '10px 12px',
            borderRadius: 10,
            border: `1px solid ${monthlyWindow.locked ? 'rgba(217,119,6,0.3)' : 'var(--color-border)'}`,
            background: monthlyWindow.locked ? 'rgba(217,119,6,0.08)' : 'var(--color-surface)',
            fontSize: 13,
            color: monthlyWindow.locked ? 'var(--color-warning)' : 'var(--color-text-secondary)',
          }}
        >
          {monthlyWindow.locked ? (
            <>All 6 monthly slots used. Resets {monthlyWindow.resetAt}.</>
          ) : (
            <>This month: {monthlyWindow.used}/6 distinct profiles · {monthlyWindow.remaining} remaining</>
          )}
        </div>
      </div>
      {contactsLoading && (
        <p style={{ marginTop: 0, fontSize: 13, color: 'var(--color-text-secondary)' }}>Loading requested contact details...</p>
      )}
      {contactsError && (
        <p style={{ marginTop: 0, fontSize: 13, color: 'var(--color-danger)' }}>
          {contactsError} Existing request history is still shown below.
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
                      const candidateProfile = profilesById[id];
                      const details = contacts.find((row) => row.profile_id === id);
                      const displayName = details?.full_name || (c ? c.first_name : `Member ${id.slice(0, 8)}...`);
                      const wa = details?.mobile ? whatsappUrlFromPhone(details.mobile) : null;
                      const hasContactDetails = !!(
                        details?.mobile ||
                        details?.email ||
                        details?.father_name ||
                        details?.mother_name
                      );
                      const openProfile = candidateProfile
                        ? () =>
                            setSelectedProfile({
                              profile: candidateProfile,
                              contactDetails: details
                                ? {
                                    mobile: details.mobile,
                                    email: details.email,
                                  }
                                : undefined,
                            })
                        : undefined;

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
                            cursor: openProfile ? 'pointer' : undefined,
                          }}
                          onClick={openProfile}
                          role={openProfile ? 'button' : undefined}
                          tabIndex={openProfile ? 0 : undefined}
                          onKeyDown={openProfile ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProfile(); } } : undefined}
                          aria-label={openProfile ? `View full profile for ${displayName}` : undefined}
                        >
                          <div
                            style={{
                              width: 48,
                              height: 48,
                              borderRadius: 8,
                              overflow: 'hidden',
                              flexShrink: 0,
                              border: '1px solid var(--color-border)',
                            }}
                          >
                            <ProfileThumb profileId={id} firstName={c?.first_name ?? 'Member'} />
                          </div>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, overflowWrap: 'anywhere' }}>
                              {displayName}
                            </div>
                            {hasContactDetails ? (
                              <>
                                {details?.mobile ? (
                                  <div style={{ marginTop: 4, fontSize: 13 }}>
                                    <a
                                      href={telHref(details.mobile)}
                                      style={{ fontWeight: 600 }}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {details.mobile}
                                    </a>
                                  </div>
                                ) : null}
                                {details.email ? (
                                  <div style={{ marginTop: 2, fontSize: 12, color: 'var(--color-text-secondary)' }}>
                                    <a
                                      href={`mailto:${encodeURIComponent(details.email)}`}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {details.email}
                                    </a>
                                  </div>
                                ) : null}
                                <div
                                  style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {details.mobile ? (
                                    <a className="btn btn-secondary" href={telHref(details.mobile)} style={{ padding: '4px 10px', fontSize: 12 }}>
                                      Call
                                    </a>
                                  ) : null}
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
                                  {openProfile ? (
                                    <button
                                      type="button"
                                      className="btn btn-primary"
                                      style={{ padding: '4px 10px', fontSize: 12 }}
                                      onClick={(e) => { e.stopPropagation(); openProfile(); }}
                                    >
                                      View full profile
                                    </button>
                                  ) : null}
                                </div>
                              </>
                            ) : (
                              <div style={{ marginTop: 4, fontSize: 12, color: 'var(--color-text-secondary)' }}>
                                {contactsLoading ? 'Loading contact details…' : 'Contact details not yet available.'}
                                {openProfile && (
                                  <button
                                    type="button"
                                    className="btn btn-secondary"
                                    style={{ marginLeft: 8, padding: '2px 8px', fontSize: 12 }}
                                    onClick={(e) => { e.stopPropagation(); openProfile(); }}
                                  >
                                    View profile
                                  </button>
                                )}
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
                    For admin &amp; safeguarding purposes only — never seen by candidates.
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
                            title="Admin-only feedback. Reviewed by the register team and never sent to candidates."
                          >
                            Give admin-only feedback
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
      {selectedProfile && (
        <ProfileModal
          candidate={selectedProfile.profile}
          contactDetails={selectedProfile.contactDetails}
          inTray={false}
          trayFull={false}
          blocked
          bookmarked={bookmarks.includes(selectedProfile.profile.id)}
          allowRequestAction={false}
          onClose={() => setSelectedProfile(null)}
          onToggleBookmark={() => void toggleBookmark(selectedProfile.profile.id)}
          onToggleTray={() => {}}
        />
      )}
    </div>
  );
}
