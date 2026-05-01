import { useCallback, useEffect, useState } from 'react';
import { isSupportAdmin } from '../../lib/auth';
import { invokeFunction, supabase } from '../../lib/supabase';

type UsageRow = {
  profile_id: string;
  coupon_used: string;
  profiles: {
    first_name: string;
    reference_number: string | null;
    created_at: string;
  } | null;
};

type Coupon = {
  code: string;
  type: string;
  discount_percent: number | null;
  max_uses: number | null;
  use_count: number;
  expires_at: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
};

function randomCode(len = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

export default function AdminCoupons() {
  const [supportOnly, setSupportOnly] = useState(false);
  const [rows, setRows] = useState<Coupon[]>([]);
  const [usageRows, setUsageRows] = useState<UsageRow[]>([]);
  const [usageFilter, setUsageFilter] = useState<string>('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState({
    code: '',
    type: 'free' as 'free' | 'discount_percent',
    discount_percent: '' as string,
    max_uses: '' as string,
    expires_at: '' as string,
    notes: '',
  });

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = (await invokeFunction('admin-manage-users', { action: 'coupons_data' })) as {
        coupons?: Coupon[];
        usage?: UsageRow[];
      };
      setRows((res.coupons ?? []) as Coupon[]);
      setUsageRows((res.usage ?? []) as UsageRow[]);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load coupons');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- coupon list from Edge Function
    void load();
  }, [load]);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      setSupportOnly(isSupportAdmin(data.user));
    });
  }, []);

  async function createCoupon(e: React.FormEvent) {
    e.preventDefault();
    const code = form.code.trim().toUpperCase();
    if (!code) return;
    if (form.type === 'discount_percent') {
      const n = Number(form.discount_percent);
      if (!Number.isFinite(n) || n < 1 || n > 100) {
        alert('Enter a discount between 1 and 100');
        return;
      }
    }
    try {
      await invokeFunction('admin-manage-users', {
        action: 'create_coupon',
        code,
        type: form.type,
        discount_percent: form.type === 'discount_percent' && form.discount_percent ? form.discount_percent : undefined,
        max_uses: form.max_uses || undefined,
        expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : undefined,
        notes: form.notes.trim() || undefined,
      });
      setForm({
        code: '',
        type: 'free',
        discount_percent: '',
        max_uses: '',
        expires_at: '',
        notes: '',
      });
      void load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create coupon');
    }
  }

  async function revoke(code: string) {
    if (!confirm(`Revoke coupon ${code}?`)) return;
    try {
      await invokeFunction('admin-manage-users', { action: 'revoke_coupon', code });
      void load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to revoke');
    }
  }

  return (
    <div>
      <h1>Coupons</h1>
      {loadError && <p style={{ color: 'var(--color-danger)', marginBottom: 16 }}>{loadError}</p>}

      <div className="card" style={{ maxWidth: 520, marginBottom: 24 }}>
        <h2 style={{ marginTop: 0 }}>Create coupon</h2>
        {supportOnly && (
          <p className="field-hint" style={{ marginBottom: 12 }}>
            Support admins cannot create or revoke coupons.
          </p>
        )}
        <form onSubmit={(e) => void createCoupon(e)} style={{ display: 'grid', gap: 12 }}>
          <fieldset disabled={supportOnly} style={{ border: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
            <p className="field-hint" style={{ margin: '0 0 8px' }}>
              Use at least 10 characters, letters and numbers only (A–Z, 0–9). Use Generate for a random code.
            </p>
            <div>
              <span className="label">Code</span>
            <div className="flex-input-with-btn">
              <input
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                placeholder="e.g. SUMMER2026"
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setForm((f) => ({ ...f, code: randomCode() }))}
              >
                Generate
              </button>
            </div>
          </div>
          <div>
            <span className="label">Type</span>
            <select
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as typeof f.type }))}
            >
              <option value="free">Free (membership)</option>
              <option value="discount_percent">Discount %</option>
            </select>
          </div>
          {form.type === 'discount_percent' && (
            <div>
              <span className="label">Discount %</span>
              <input
                type="number"
                min={1}
                max={100}
                value={form.discount_percent}
                onChange={(e) => setForm((f) => ({ ...f, discount_percent: e.target.value }))}
              />
            </div>
          )}
          <div>
            <span className="label">Max uses (optional)</span>
            <input
              type="number"
              min={1}
              value={form.max_uses}
              onChange={(e) => setForm((f) => ({ ...f, max_uses: e.target.value }))}
            />
          </div>
          <div>
            <span className="label">Expires (optional)</span>
            <input
              type="datetime-local"
              value={form.expires_at}
              onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value }))}
            />
          </div>
          <div>
            <span className="label">Notes</span>
            <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} />
          </div>
          <button type="submit" className="btn btn-primary">
            Create
          </button>
          </fieldset>
        </form>
      </div>

      <div className="table-scroll">
        <table className="admin-data-table" style={{ borderCollapse: 'collapse', fontSize: 14, background: 'white' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
              <th style={{ textAlign: 'left', padding: 8 }}>Code</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Type</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Uses</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Expires</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Active</th>
              <th style={{ textAlign: 'left', padding: 8 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.code} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={{ padding: 8 }}>
                  <strong>{c.code}</strong>
                </td>
                <td style={{ padding: 8 }}>
                  {c.type}
                  {c.discount_percent != null ? ` (${c.discount_percent}%)` : ''}
                </td>
                <td style={{ padding: 8 }}>
                  {c.use_count}
                  {c.max_uses != null ? ` / ${c.max_uses}` : ''}
                </td>
                <td style={{ padding: 8 }}>
                  {c.expires_at ? new Date(c.expires_at).toLocaleString('en-GB') : '-'}
                </td>
                <td style={{ padding: 8 }}>{c.is_active ? 'Yes' : 'No'}</td>
                <td style={{ padding: 8 }}>
                  {c.is_active && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={supportOnly}
                      onClick={() => void revoke(c.code)}
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ marginTop: 32 }}>Usage history</h2>

      <div style={{ marginBottom: 12 }}>
        <span className="label">Filter by coupon code</span>
        <select
          value={usageFilter}
          onChange={(e) => setUsageFilter(e.target.value)}
          style={{ width: 'min(100%, 280px)' }}
        >
          <option value="">All coupons</option>
          {[...new Set(usageRows.map((u) => u.coupon_used))].sort().map((code) => (
            <option key={code} value={code}>{code}</option>
          ))}
        </select>
      </div>

      {usageRows.length === 0 ? (
        <p style={{ color: '#6b7280' }}>No coupon usage recorded yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="admin-data-table" style={{ borderCollapse: 'collapse', fontSize: 14, background: 'white' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                <th style={{ textAlign: 'left', padding: 8 }}>Coupon code</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Member name</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Ref</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Date registered</th>
              </tr>
            </thead>
            <tbody>
              {usageRows
                .filter((u) => !usageFilter || u.coupon_used === usageFilter)
                .map((u) => (
                  <tr key={u.profile_id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: 8 }}>
                      <strong>{u.coupon_used}</strong>
                    </td>
                    <td style={{ padding: 8 }}>{u.profiles?.first_name ?? '-'}</td>
                    <td style={{ padding: 8 }}>{u.profiles?.reference_number ?? '-'}</td>
                    <td style={{ padding: 8 }}>
                      {u.profiles?.created_at
                        ? new Date(u.profiles.created_at).toLocaleDateString('en-GB')
                        : '-'}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
