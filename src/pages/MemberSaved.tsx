import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ProfileCard from '../components/ProfileCard';
import { cmToFeetInches } from '../lib/heights';
import { isProfileListedOnRegister } from '../lib/memberStatus';
import { supabase } from '../lib/supabase';
import { ProfileModal } from '../member/ProfileModal';
import { ProfileThumb } from '../member/ProfileThumb';
import { RequestTrayBar } from '../member/RequestTrayBar';
import type { ProfileRow } from '../member/memberContext';
import { useMemberArea } from '../member/memberContext';

export default function MemberSaved() {
  const {
    profile,
    bookmarks,
    toggleBookmark,
    requests,
    requestersOfMe,
    tray,
    toggleTray,
    trayMax,
    atTrayCapacity,
    feedbackBlocking,
  } = useMemberArea();
  const [rows, setRows] = useState<ProfileRow[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<ProfileRow | null>(null);

  const requestedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of requests) {
      for (const cid of (r.candidate_ids as string[]) ?? []) ids.add(cid);
    }
    return ids;
  }, [requests]);

  const requesterIds = useMemo(() => new Set(requestersOfMe.map((r) => r.id)), [requestersOfMe]);

  useEffect(() => {
    let cancelled = false;
    if (!profile || bookmarks.length === 0) {
      queueMicrotask(() => {
        if (!cancelled) setRows([]);
      });
      return () => {
        cancelled = true;
      };
    }
    void (async () => {
      const { data } = await supabase
        .from('profiles')
        .select(
          'id, reference_number, gender, seeking_gender, first_name, age, created_at, updated_at, education, job_title, height_cm, weight_kg, diet, religion, community, nationality, place_of_birth, town_country_of_origin, future_settlement_plans, hobbies, photo_status, status, hidden_reason, membership_expires_at, contact_request_quota_bonus'
        )
        .in('id', bookmarks);
      if (!cancelled) setRows((data ?? []) as ProfileRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [profile, bookmarks]);

  if (!profile) return null;

  const byId = new Map(rows.map((r) => [r.id, r]));
  const trayPaddingBottom = tray.length > 0 ? 'var(--member-tray-height, 100px)' : undefined;

  return (
    <div style={{ paddingBottom: trayPaddingBottom }}>
      {bookmarks.length > 0 && (
        <div className="member-browse-result-line" style={{ marginBottom: 14 }}>
          <span>
            {bookmarks.length} saved profile{bookmarks.length === 1 ? '' : 's'} · You can add people to your request
            tray and submit directly from here.
          </span>
          {atTrayCapacity && trayMax > 0 && (
            <span className="member-browse-result-line-warn">
              Max selected ({tray.length}/{trayMax}). Submit or remove someone to add another.
            </span>
          )}
        </div>
      )}
      <div className="member-browse-cards">
        {bookmarks.length === 0 && (
          <div className="member-browse-empty" style={{ gridColumn: '1 / -1' }}>
            <p className="member-browse-empty-title">No saved profiles yet</p>
            <p className="member-browse-empty-desc">
              Save profiles while you <Link to="/dashboard/browse">browse the register</Link> to shortlist people and
              request their contact details when you are ready.
            </p>
          </div>
        )}
        {bookmarks.map((id) => {
          const c = byId.get(id);
          const alreadyRequested = requestedIds.has(id);
          const requestedMe = requesterIds.has(id);
          const introduced = alreadyRequested || requestedMe;
          const available = c && (isProfileListedOnRegister(c) || introduced);

          if (!c || !available) {
            return (
              <div
                key={id}
                className="card member-saved-card member-saved-card--unavailable"
                style={{ opacity: 0.65, padding: 16 }}
              >
                <div
                  role="img"
                  aria-label="Profile no longer available"
                  style={{
                    aspectRatio: '1',
                    background: '#e5e7eb',
                    borderRadius: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 13,
                    color: 'var(--color-text-secondary)',
                    textAlign: 'center',
                    padding: 8,
                  }}
                >
                  No longer available
                </div>
                <p style={{ margin: '12px 0 4px', fontWeight: 600 }}>Saved profile</p>
                <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: 0 }}>
                  This profile is no longer visible on the register (inactive, expired, or hidden).
                </p>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ marginTop: 12 }}
                  onClick={() => void toggleBookmark(id)}
                >
                  Remove from saved
                </button>
              </div>
            );
          }

          if (introduced) {
            return (
              <div
                key={id}
                className="card member-saved-card"
                style={{ padding: 0, overflow: 'hidden', cursor: 'pointer', display: 'flex', flexDirection: 'column' }}
                onClick={() => setSelectedProfile(c)}
              >
                <div style={{ position: 'relative' }}>
                  <ProfileThumb profileId={c.id} firstName={c.first_name} className="member-saved-photo" />
                  <span
                    className="badge badge-success"
                    style={{ position: 'absolute', top: 10, left: 10, zIndex: 1, background: 'rgba(22,163,74,0.9)' }}
                  >
                    {requestedMe ? 'Requested your details' : 'Details requested'}
                  </span>
                </div>
                <div style={{ padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', flex: 1 }}>
                  <h3 style={{ margin: '0 0 4px', fontSize: 17 }}>
                    {c.first_name}
                    {c.age ? `, ${c.age}` : ''}
                  </h3>
                  {c.job_title && (
                    <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--color-text-secondary)' }}>
                      {c.job_title}
                      {c.place_of_birth ? ` · ${c.place_of_birth}` : ''}
                    </p>
                  )}
                  <p style={{ margin: '6px 0 12px', fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    Contact details are available under My requests.
                  </p>
                  <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ flex: 1, padding: '8px 10px', fontSize: 13 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        void toggleBookmark(id);
                      }}
                    >
                      Remove
                    </button>
                    <Link
                      to="/dashboard/requests"
                      state={
                        requestedMe
                          ? { tab: 'interested', focusProfileId: c.id }
                          : { focusProfileId: c.id }
                      }
                      className="btn btn-primary"
                      style={{ flex: 1, padding: '8px 10px', fontSize: 13, textDecoration: 'none' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      Open in My requests
                    </Link>
                  </div>
                </div>
              </div>
            );
          }

          const inTray = tray.includes(c.id);
          const note = feedbackBlocking ? (
            <span className="profile-card-note--warn">
              Request unavailable until pending feedback is submitted.
            </span>
          ) : trayMax === 0 ? (
            <span className="profile-card-note--warn">
              Request unavailable while weekly/monthly quota is full.
            </span>
          ) : null;

          return (
            <ProfileCard
              key={c.id}
              age={c.age}
              gender={c.gender}
              profession={c.job_title}
              height={c.height_cm != null ? cmToFeetInches(c.height_cm) : null}
              diet={c.diet}
              location={c.place_of_birth}
              religion={c.religion}
              nationality={c.nationality}
              education={c.education}
              hobbies={c.hobbies}
              settlement={c.future_settlement_plans}
              onOpen={() => setSelectedProfile(c)}
              note={note}
              actions={
                <>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleBookmark(c.id);
                    }}
                  >
                    ★ Remove saved
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!inTray && (atTrayCapacity || feedbackBlocking)}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleTray(c.id);
                    }}
                  >
                    {inTray ? '✕ Remove' : '+ Request'}
                  </button>
                </>
              }
            />
          );
        })}
      </div>

      <RequestTrayBar extraProfiles={rows} />

      {selectedProfile && (
        <ProfileModal
          candidate={selectedProfile}
          anonymous={!requestedIds.has(selectedProfile.id) && !requesterIds.has(selectedProfile.id)}
          contactDetails={(() => {
            const r = requestersOfMe.find((x) => x.id === selectedProfile.id);
            return r?.mobile ? { mobile: r.mobile, linkedin_url: r.linkedin_url } : undefined;
          })()}
          inTray={tray.includes(selectedProfile.id)}
          trayFull={atTrayCapacity}
          trayCapacity={trayMax}
          feedbackRequiredBeforeRequests={feedbackBlocking}
          blocked={requestedIds.has(selectedProfile.id) || requesterIds.has(selectedProfile.id)}
          bookmarked={bookmarks.includes(selectedProfile.id)}
          allowRequestAction={!requesterIds.has(selectedProfile.id)}
          showRequestFromBrowseHint={false}
          onClose={() => setSelectedProfile(null)}
          onToggleBookmark={() => void toggleBookmark(selectedProfile.id)}
          onToggleTray={() => toggleTray(selectedProfile.id)}
        />
      )}
    </div>
  );
}
