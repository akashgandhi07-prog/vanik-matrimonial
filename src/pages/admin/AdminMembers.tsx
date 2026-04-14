import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

type Profile = {
  id: string;
  reference_number: string | null;
  first_name: string;
  gender: string;
  status: string;
  community: string | null;
  age: number | null;
  membership_expires_at: string | null;
  last_request_at: string | null;
  photo_url: string | null;
  pending_photo_url: string | null;
  photo_status: string;
};

const FILTERS = ['all', 'pending', 'active', 'expired', 'rejected', 'archived', 'matched', 'lapsed90'] as const;

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export default function AdminMembers() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filterParam = searchParams.get('filter');
  const filter: (typeof FILTERS)[number] =
    filterParam && (FILTERS as readonly string[]).includes(filterParam)
      ? (filterParam as (typeof FILTERS)[number])
      : 'all';
  const [search, setSearch] = useState('');
  const [members, setMembers] = useState<Profile[]>([]);
  const [emailByProfileId, setEmailByProfileId] = useState<Record<string, string>>({});

  const loadMembers = useCallback(async () => {
    const lapseCutoff = new Date(Date.now() - 90 * 864e5).toISOString();
    let q = supabase.from('profiles').select('*').order('created_at', { ascending: false });
    if (filter === 'pending') q = q.eq('status', 'pending_approval');
    else if (filter === 'active') q = q.eq('status', 'active');
    else if (filter === 'expired') q = q.eq('status', 'expired');
    else if (filter === 'rejected') q = q.eq('status', 'rejected');
    else if (filter === 'archived') q = q.eq('status', 'archived');
    else if (filter === 'matched') q = q.eq('status', 'matched');
    else if (filter === 'lapsed90') {
      q = q.eq('status', 'expired').lt('membership_expires_at', lapseCutoff);
    }
    const { data } = await q;
    const profiles = (data ?? []) as Profile[];
    setMembers(profiles);

    // Fetch emails from member_private for these profile IDs
    if (profiles.length > 0) {
      const ids = profiles.map((p) => p.id);
      const { data: privateData } = await supabase
        .from('member_private')
        .select('profile_id, email')
        .in('profile_id', ids);
      const map: Record<string, string> = {};
      for (const row of (privateData ?? []) as { profile_id: string; email: string }[]) {
        map[row.profile_id] = row.email ?? '';
      }
      setEmailByProfileId(map);
    }
  }, [filter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loadMembers updates list from Supabase
    void loadMembers();
  }, [loadMembers]);

  function changeFilter(f: (typeof FILTERS)[number]) {
    setSearchParams(f === 'all' ? {} : { filter: f });
  }

  const filteredMembers = useMemo(() => {
    return members.filter((m) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        (m.reference_number?.toLowerCase().includes(q) ?? false) ||
        m.first_name.toLowerCase().includes(q) ||
        (emailByProfileId[m.id]?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [members, search, emailByProfileId]);

  return (
    <div>
      <h1>Members</h1>
      <input
        placeholder="Search reference, name or email"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ maxWidth: 320, marginBottom: 12 }}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={filter === f ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() => changeFilter(f)}
          >
            {f === 'lapsed90' ? 'lapsed 90+' : f}
          </button>
        ))}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, background: 'white' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
              <th style={{ padding: 8 }}>Ref</th>
              <th style={{ padding: 8 }}>Name</th>
              <th style={{ padding: 8 }}>Gender</th>
              <th style={{ padding: 8 }}>Age</th>
              <th style={{ padding: 8 }}>Community</th>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8 }}>Expires</th>
              <th style={{ padding: 8 }}>Last request</th>
              <th style={{ padding: 8 }}>Notes</th>
              <th style={{ padding: 8 }} />
            </tr>
          </thead>
          <tbody>
            {filteredMembers.map((m) => (
              <tr key={m.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={{ padding: 8 }}>{m.reference_number}</td>
                <td style={{ padding: 8 }}>{m.first_name}</td>
                <td style={{ padding: 8 }}>{m.gender}</td>
                <td style={{ padding: 8 }}>{m.age}</td>
                <td style={{ padding: 8 }}>{m.community}</td>
                <td style={{ padding: 8 }}>{m.status}</td>
                <td style={{ padding: 8 }}>{fmtDate(m.membership_expires_at)}</td>
                <td style={{ padding: 8 }}>{fmtDate(m.last_request_at)}</td>
                <td style={{ padding: 8 }}>
                  {m.pending_photo_url && (
                    <span className="badge badge-warning" style={{ whiteSpace: 'nowrap' }}>
                      Photo pending review
                    </span>
                  )}
                </td>
                <td style={{ padding: 8 }}>
                  <Link to={`/admin/members/${m.id}`}>View</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
