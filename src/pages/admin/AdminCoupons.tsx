import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

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

function randomCode(len = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export default function AdminCoupons() {
  const [rows, setRows] = useState<Coupon[]>([]);
  const [form, setForm] = useState({
    code: '',
    type: 'free' as 'free' | 'discount_percent',
    discount_percent: '' as string,
    max_uses: '' as string,
    expires_at: '' as string,
    notes: '',
  });

  const load = useCallback(async () => {
    const { data } = await supabase.from('coupons').select('*').order('created_at', { ascending: false });
    setRows((data ?? []) as Coupon[]);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- coupon list from Supabase
    void load();
  }, [load]);

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
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from('coupons').insert({
      code,
      type: form.type,
      discount_percent:
        form.type === 'discount_percent' && form.discount_percent          ? Number(form.discount_percent)
          : null,
      max_uses: form.max_uses ? Number(form.max_uses) : null,
      expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
      notes: form.notes.trim() || null,
      is_active: true,
      created_by: u.user?.id ?? null,
    });
    if (error) {
      alert(error.message);
      return;
    }
    setForm({
      code: '',
      type: 'free',
      discount_percent: '',
      max_uses: '',
      expires_at: '',
      notes: '',
    });
    void load();
  }

  async function revoke(code: string) {
    if (!confirm(`Revoke coupon ${code}?`)) return;
    await supabase.from('coupons').update({ is_active: false }).eq('code', code);
    void load();
  }

  return (
    <div>
      <h1>Coupons</h1>

      <div className="card" style={{ maxWidth: 520, marginBottom: 24 }}>
        <h2 style={{ marginTop: 0 }}>Create coupon</h2>
        <form onSubmit={(e) => void createCoupon(e)} style={{ display: 'grid', gap: 12 }}>
          <div>
            <span className="label">Code</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                placeholder="e.g. SUMMER2026"
                style={{ flex: 1 }}
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
        </form>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, background: 'white' }}>
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
                  {c.expires_at ? new Date(c.expires_at).toLocaleString('en-GB') : '—'}
                </td>
                <td style={{ padding: 8 }}>{c.is_active ? 'Yes' : 'No'}</td>
                <td style={{ padding: 8 }}>
                  {c.is_active && (
                    <button type="button" className="btn btn-secondary" onClick={() => void revoke(c.code)}>
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
