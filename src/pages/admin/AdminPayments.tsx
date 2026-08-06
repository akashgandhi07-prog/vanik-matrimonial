import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { isSupportAdmin } from '../../lib/auth';
import { invokeFunction, supabase } from '../../lib/supabase';

type PaymentRow = {
  checkout_session_id: string;
  auth_user_id: string;
  profile_id: string | null;
  purpose: string;
  payment_status: string;
  amount_total: number | null;
  currency: string | null;
  refund_id: string | null;
  refund_amount: number | null;
  refunded_at: string | null;
  created_at: string;
  member_name: string | null;
  member_reference: string | null;
  member_status: string | null;
  member_hidden_reason: string | null;
  member_expires_at: string | null;
  member_email: string | null;
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtAmount(pence: number | null, currency: string | null): string {
  if (pence == null) return '—';
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: (currency ?? 'gbp').toUpperCase(),
    }).format(pence / 100);
  } catch {
    return `${(pence / 100).toFixed(2)} ${(currency ?? '').toUpperCase()}`;
  }
}

export default function AdminPayments() {
  const [supportOnly, setSupportOnly] = useState(false);
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  /** Session id whose row action is in flight, so its buttons disable. */
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  /** Session id whose member-actions panel is expanded. */
  const [openActions, setOpenActions] = useState<string | null>(null);
  const [freeMonths, setFreeMonths] = useState('1');

  const load = useCallback(async () => {
    setLoadError(null);
    setLoading(true);
    try {
      const res = (await invokeFunction('admin-payments', { action: 'list' })) as {
        payments?: PaymentRow[];
      };
      setRows(res.payments ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load payments');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth
      .getUser()
      .then(({ data }) => {
        if (!cancelled) setSupportOnly(isSupportAdmin(data.user));
      })
      .catch(() => {
        // Fail closed: if the role cannot be read, assume the most restricted
        // (support-only) UI. Server-side checks remain the real gate regardless.
        if (!cancelled) setSupportOnly(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function refund(row: PaymentRow) {
    const fullPounds = row.amount_total != null ? (row.amount_total / 100).toFixed(2) : '';
    const input = window.prompt(
      `Refund amount in pounds for ${row.member_name ?? 'this member'} (paid ${fmtAmount(row.amount_total, row.currency)}).\n` +
        'Leave as-is for a full refund, or lower it for a partial refund.',
      fullPounds
    );
    if (input == null) return;
    const pounds = Number(input.trim());
    if (!Number.isFinite(pounds) || pounds <= 0) {
      alert('Enter a valid amount in pounds, e.g. 25 or 12.50');
      return;
    }
    const pence = Math.round(pounds * 100);
    if (row.amount_total != null && pence > row.amount_total) {
      alert('Refund amount cannot exceed the amount paid.');
      return;
    }
    const isFull = row.amount_total != null && pence === row.amount_total;
    if (
      !window.confirm(
        `Refund ${fmtAmount(pence, row.currency)}${isFull ? ' (full refund)' : ''} to ${
          row.member_name ?? row.member_email ?? 'this member'
        }? This cannot be undone.`
      )
    ) {
      return;
    }
    setRowBusy(row.checkout_session_id);
    try {
      await invokeFunction('admin-payments', {
        action: 'refund',
        checkout_session_id: row.checkout_session_id,
        amount_pence: pence,
      });
      alert(
        'Refund issued. Note: refunding does not change the membership itself - use the Manage actions if you also want to pause, cancel or compensate.'
      );
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Refund failed');
    } finally {
      setRowBusy(null);
    }
  }

  async function memberStatusAction(row: PaymentRow, action: 'hide' | 'unhide' | 'close', confirmMsg: string) {
    if (!row.profile_id) return;
    if (!window.confirm(confirmMsg)) return;
    setRowBusy(row.checkout_session_id);
    try {
      await invokeFunction('admin-update-member-status', { profile_id: row.profile_id, action });
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setRowBusy(null);
    }
  }

  async function addFreeMonths(row: PaymentRow) {
    if (!row.profile_id) return;
    const months = Math.floor(Number(freeMonths));
    if (!Number.isFinite(months) || months < 1 || months > 24) {
      alert('Enter a number of months between 1 and 24');
      return;
    }
    if (!window.confirm(`Add ${months} free month${months === 1 ? '' : 's'} to ${row.member_name ?? 'this member'}'s membership?`)) {
      return;
    }
    setRowBusy(row.checkout_session_id);
    try {
      const res = (await invokeFunction('admin-manage-users', {
        action: 'extend_membership',
        profile_id: row.profile_id,
        months,
      })) as { membership_expires_at?: string; reactivated?: boolean };
      alert(
        `Membership extended to ${fmtDate(res.membership_expires_at ?? null)}.${
          res.reactivated ? ' The account is active again.' : ''
        }`
      );
      setFreeMonths('1');
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to extend membership');
    } finally {
      setRowBusy(null);
    }
  }

  const q = search.trim().toLowerCase();
  const filtered = q
    ? rows.filter((r) =>
        [r.member_name, r.member_reference, r.member_email, r.purpose]
          .filter(Boolean)
          .some((v) => (v as string).toLowerCase().includes(q))
      )
    : rows;

  return (
    <div>
      <h2>Payments</h2>
      <p style={{ color: '#6b7280', maxWidth: 640 }}>
        Every Stripe payment, newest first. Refunds are issued straight to Stripe; pausing, cancelling or adding
        free months uses the same actions as the member page.
      </p>

      {loadError && (
        <div role="alert" style={{ color: 'var(--color-danger)', marginBottom: 12 }}>
          {loadError}
        </div>
      )}

      <input
        type="search"
        placeholder="Search by name, reference, email or purpose"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 16, maxWidth: 380, width: '100%' }}
      />

      {loading ? (
        <p>Loading…</p>
      ) : filtered.length === 0 ? (
        <p>{rows.length === 0 ? 'No payments recorded yet.' : 'No payments match the search.'}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="admin-data-table" style={{ borderCollapse: 'collapse', fontSize: 14, background: 'white' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: 8 }}>Date</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Member</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Purpose</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Amount</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Status</th>
                {!supportOnly && <th style={{ textAlign: 'left', padding: 8 }} />}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const busy = rowBusy === r.checkout_session_id;
                const open = openActions === r.checkout_session_id;
                const refunded = r.refund_id != null;
                const paused = r.member_hidden_reason != null;
                const closed = r.member_status === 'closed';
                return (
                  <Fragment key={r.checkout_session_id}>
                    <tr style={{ borderTop: '1px solid #e5e7eb' }}>
                      <td style={{ padding: 8, whiteSpace: 'nowrap' }}>{fmtDate(r.created_at)}</td>
                      <td style={{ padding: 8 }}>
                        {r.profile_id ? (
                          <Link to={`/admin/members/${r.profile_id}`}>
                            {r.member_name ?? 'Member'}
                            {r.member_reference ? ` (${r.member_reference})` : ''}
                          </Link>
                        ) : (
                          <span style={{ color: '#6b7280' }}>No profile yet</span>
                        )}
                        {r.member_email && (
                          <div style={{ color: '#6b7280', fontSize: 13 }}>{r.member_email}</div>
                        )}
                      </td>
                      <td style={{ padding: 8, textTransform: 'capitalize' }}>{r.purpose}</td>
                      <td style={{ padding: 8, whiteSpace: 'nowrap' }}>{fmtAmount(r.amount_total, r.currency)}</td>
                      <td style={{ padding: 8 }}>
                        {refunded ? (
                          <span style={{ color: 'var(--color-danger)' }}>
                            Refunded {fmtAmount(r.refund_amount, r.currency)}
                            <div style={{ fontSize: 13 }}>{fmtDate(r.refunded_at)}</div>
                          </span>
                        ) : (
                          <span style={{ color: 'var(--color-success)' }}>Paid</span>
                        )}
                        {r.member_status && (
                          <div style={{ color: '#6b7280', fontSize: 13, textTransform: 'capitalize' }}>
                            Member: {r.member_status}
                            {paused && !closed ? ' (hidden)' : ''}
                          </div>
                        )}
                      </td>
                      {!supportOnly && (
                        <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                          {!refunded && (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              style={{ padding: '4px 12px', fontSize: 13, marginRight: 8 }}
                              disabled={busy}
                              onClick={() => void refund(r)}
                            >
                              {busy ? 'Working…' : 'Refund…'}
                            </button>
                          )}
                          {r.profile_id && (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              style={{ padding: '4px 12px', fontSize: 13 }}
                              disabled={busy}
                              onClick={() => setOpenActions(open ? null : r.checkout_session_id)}
                            >
                              {open ? 'Close' : 'Manage'}
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                    {!supportOnly && open && r.profile_id && (
                      <tr key={`${r.checkout_session_id}-actions`} style={{ background: '#f9fafb' }}>
                        <td colSpan={6} style={{ padding: '10px 8px' }}>
                          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                            {!closed &&
                              (paused ? (
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  style={{ padding: '4px 12px', fontSize: 13 }}
                                  disabled={busy}
                                  onClick={() =>
                                    void memberStatusAction(
                                      r,
                                      'unhide',
                                      `Restore ${r.member_name ?? 'this member'} to the register?`
                                    )
                                  }
                                >
                                  Unpause (show on register)
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  style={{ padding: '4px 12px', fontSize: 13 }}
                                  disabled={busy}
                                  onClick={() =>
                                    void memberStatusAction(
                                      r,
                                      'hide',
                                      `Pause ${r.member_name ?? 'this member'}? They stay a member but are hidden from the register until unpaused.`
                                    )
                                  }
                                >
                                  Pause (hide from register)
                                </button>
                              ))}
                            {!closed && (
                              <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ padding: '4px 12px', fontSize: 13, color: 'var(--color-danger)' }}
                                disabled={busy}
                                onClick={() =>
                                  void memberStatusAction(
                                    r,
                                    'close',
                                    `Cancel ${r.member_name ?? 'this member'}'s membership? Their account closes and their data is deleted after 90 days unless they renew.`
                                  )
                                }
                              >
                                Cancel membership
                              </button>
                            )}
                            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                              <input
                                type="number"
                                min={1}
                                max={24}
                                value={freeMonths}
                                onChange={(e) => setFreeMonths(e.target.value)}
                                style={{ width: 64 }}
                                aria-label="Free months to add"
                              />
                              <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ padding: '4px 12px', fontSize: 13 }}
                                disabled={busy}
                                onClick={() => void addFreeMonths(r)}
                              >
                                Add free months
                              </button>
                            </span>
                            <span style={{ color: '#6b7280', fontSize: 13 }}>
                              Expires: {fmtDate(r.member_expires_at)}
                            </span>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
