import { useEffect, useMemo, useState } from 'react';
import { ProfileThumb } from '../member/ProfileThumb';
import { ProfileModal } from '../member/ProfileModal';
import type { ProfileRow } from '../member/memberContext';
import { useMemberArea } from '../member/memberContext';
import { supabase } from '../lib/supabase';

function isProfileVisibleToMember(p: ProfileRow): boolean {
  if (p.status !== 'active') return false;
  if (!p.show_on_register) return false;
  if (!p.membership_expires_at || new Date(p.membership_expires_at) <= new Date()) return false;
  return true;
}

export default function MemberSaved() {
  const { profile, bookmarks, toggleBookmark, requests } = useMemberArea();
  const [rows, setRows] = useState<ProfileRow[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<ProfileRow | null>(null);

  const requestedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of requests) {
      for (const cid of (r.candidate_ids as string[]) ?? []) ids.add(cid);
    }
    return ids;
  }, [requests]);

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
      const { data } = await supabase.from('profiles').select('*').in('id', bookmarks);
      if (!cancelled) setRows((data ?? []) as ProfileRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [profile, bookmarks]);

  if (!profile) return null;

  const byId = new Map(rows.map((r) => [r.id, r]));

  return (
    <div className="member-saved-grid">
      {bookmarks.length === 0 && <p style={{ color: 'var(--color-text-secondary)' }}>No saved profiles yet.</p>}
      {bookmarks.map((id) => {
        const c = byId.get(id);
        const available = c && isProfileVisibleToMember(c);
        const alreadyRequested = requestedIds.has(id);

        if (c && !available) {
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
        if (!c) {
          return (
            <div
              key={id}
              className="card member-saved-card member-saved-card--unavailable"
              style={{ opacity: 0.65, padding: 16 }}
            >
              <div
                role="img"
                aria-label="Profile unavailable"
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
        return (
          <div
            key={id}
            className="card member-saved-card"
            style={{ padding: 0, overflow: 'hidden', cursor: 'pointer' }}
            onClick={() => setSelectedProfile(c)}
          >
            <div style={{ position: 'relative' }}>
              {/* Show real photo only once contact details have been requested */}
              <ProfileThumb
                profileId={c.id}
                firstName={c.first_name}
                anonymous={!alreadyRequested}
              />
              {alreadyRequested && (
                <span
                  className="badge badge-success"
                  style={{ position: 'absolute', top: 10, left: 10, zIndex: 1, background: 'rgba(22,163,74,0.9)' }}
                >
                  Details requested
                </span>
              )}
            </div>
            <div style={{ padding: '12px 14px 14px' }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 17 }}>
                {/* Show name only once contact details have been requested */}
                {alreadyRequested
                  ? `${c.first_name}${c.age ? `, ${c.age}` : ''}`
                  : (c.age ? `Age ${c.age}` : '')}
              </h3>
              {alreadyRequested && (
                <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--color-text-secondary)' }}>
                  Contact details are available under My requests.
                </p>
              )}
              <button
                type="button"
                className="btn btn-secondary"
                style={{ marginTop: 10, width: '100%' }}
                onClick={(e) => { e.stopPropagation(); void toggleBookmark(id); }}
              >
                Remove from saved
              </button>
            </div>
          </div>
        );
      })}
      {selectedProfile && (
        <ProfileModal
          candidate={selectedProfile}
          anonymous={!requestedIds.has(selectedProfile.id)}
          inTray={false}
          trayFull={false}
          blocked={requestedIds.has(selectedProfile.id)}
          bookmarked={bookmarks.includes(selectedProfile.id)}
          allowRequestAction={false}
          onClose={() => setSelectedProfile(null)}
          onToggleBookmark={() => void toggleBookmark(selectedProfile.id)}
          onToggleTray={() => {}}
        />
      )}
    </div>
  );
}
