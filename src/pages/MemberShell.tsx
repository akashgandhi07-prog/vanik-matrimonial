import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { MemberAuthGate, MemberDataProvider, useMemberArea } from '../member/memberContext';

const DASHBOARD_BROWSE_TIP_KEY = 'vanik_dashboard_browse_tip_v1';

function daysBetween(a: Date, b: Date) {
  return Math.ceil((b.getTime() - a.getTime()) / 86400000);
}

function MemberLayoutBody() {
  const location = useLocation();
  const { profile, loadAll } = useMemberArea();
  const [searchParams, setSearchParams] = useSearchParams();
  const [renewalPaidNotice, setRenewalPaidNotice] = useState(false);
  const [browseTipDismissed, setBrowseTipDismissed] = useState(() => {
    try {
      return typeof localStorage !== 'undefined' && Boolean(localStorage.getItem(DASHBOARD_BROWSE_TIP_KEY));
    } catch {
      return false;
    }
  });

  const showBrowseTip = location.pathname === '/dashboard/browse' && !browseTipDismissed;

  function dismissBrowseTip() {
    try {
      localStorage.setItem(DASHBOARD_BROWSE_TIP_KEY, '1');
    } catch {
      /* ignore */
    }
    setBrowseTipDismissed(true);
  }

  useEffect(() => {
    if (searchParams.get('checkout') !== 'success') return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Stripe return URL triggers one-shot toast before params are stripped
    setRenewalPaidNotice(true);
    const next = new URLSearchParams(searchParams);
    next.delete('checkout');
    next.delete('session_id');
    setSearchParams(next, { replace: true });
    void loadAll();
  }, [searchParams, setSearchParams, loadAll]);

  if (!profile) return null;

  const exp = profile.membership_expires_at ? new Date(profile.membership_expires_at) : null;
  const daysToExp = exp ? daysBetween(new Date(), exp) : null;
  const showAmber = daysToExp != null && daysToExp <= 30 && daysToExp > 7;
  const showRed = daysToExp != null && daysToExp <= 7 && daysToExp >= 0;
  const expiryClose = daysToExp != null && daysToExp <= 14 && daysToExp >= 0;
  const expDateLabel = exp
    ? exp.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : '';
  const daysLeftLabel =
    daysToExp == null ? '' : daysToExp <= 0 ? 'today' : daysToExp === 1 ? 'in 1 day' : `in ${daysToExp} days`;

  const navCls = ({ isActive }: { isActive: boolean }) =>
    isActive ? 'btn btn-primary' : 'btn btn-secondary';

  return (
    <div className="member-dashboard-root" style={{ paddingBottom: 24 }}>
      <header className="member-dashboard-header member-dashboard-header--bar">
        <div className="layout-max member-dashboard-header-inner">
          <div className="member-dashboard-header-meta">
            <strong className="member-dashboard-header-title">Member area</strong>
            {exp && (
              <div className="member-dashboard-header-sub">
                {expiryClose ? (
                  <strong style={{ color: 'var(--color-danger)' }}>
                    Membership expires {daysLeftLabel} — {expDateLabel}
                  </strong>
                ) : (
                  <span>
                    Membership expires{' '}
                    {exp.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                )}
              </div>
            )}
          </div>
          <nav className="member-dashboard-nav" aria-label="Member dashboard">
            {(
              [
                ['/dashboard/browse', 'Browse'],
                ['/dashboard/saved', 'Saved profiles'],
                ['/dashboard/requests', 'My requests'],
                ['/dashboard/my-profile', 'My profile'],
              ] as const
            ).map(([to, label]) => (
              <NavLink key={to} to={to} className={navCls}>
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
        {showAmber && (
          <div className="layout-max member-dashboard-renew-banner renew-banner renew-banner--amber">
            <span>
              Your membership expires on <strong>{expDateLabel}</strong> ({daysLeftLabel}). To keep using
              Vanik Council and stay visible to other members, renew for £10/year.
            </span>
            <NavLink to="/renew-membership" className="btn btn-primary" style={{ padding: '4px 12px', fontSize: 13 }}>
              Renew for £10
            </NavLink>
          </div>
        )}
        {showRed && (
          <div className="layout-max member-dashboard-renew-banner renew-banner renew-banner--urgent">
            <span>
              Your membership expires <strong>{daysLeftLabel}</strong>, on <strong>{expDateLabel}</strong>. After
              this date your profile will be hidden from other members. Renew for £10/year to keep your access.
            </span>
            <NavLink to="/renew-membership" className="btn btn-primary" style={{ padding: '4px 12px', fontSize: 13 }}>
              Renew for £10
            </NavLink>
          </div>
        )}
      </header>

      {renewalPaidNotice && (
        <div className="layout-max" style={{ marginTop: 12 }}>
          <div
            className="card"
            role="status"
            style={{
              padding: '10px 14px',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 10,
              justifyContent: 'space-between',
              background: 'rgba(22, 163, 74, 0.08)',
              border: '1px solid rgba(22, 163, 74, 0.35)',
              fontSize: 14,
            }}
          >
            <span>
              Payment received. Your membership should update within a few moments - refresh if your expiry date
              looks unchanged.
            </span>
            <button type="button" className="btn btn-secondary" onClick={() => setRenewalPaidNotice(false)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="layout-max member-dashboard-main" style={{ marginTop: 16 }}>
        {showBrowseTip && (
          <div
            className="member-dashboard-tip card"
            role="status"
            style={{
              marginBottom: 14,
              padding: '12px 14px',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 12,
              justifyContent: 'space-between',
              border: '1px solid rgba(30, 58, 95, 0.18)',
              background: 'rgba(248, 250, 252, 0.95)',
              fontSize: 14,
              lineHeight: 1.45,
            }}
          >
            <span style={{ flex: '1 1 220px', margin: 0 }}>
              <strong>Quick tip:</strong> Tap <strong>+ Request</strong> to add people to your tray, then submit one batch to ask for contact details (weekly and monthly limits apply).
            </span>
            <button type="button" className="btn btn-secondary" style={{ flexShrink: 0 }} onClick={dismissBrowseTip}>
              Got it
            </button>
          </div>
        )}
        <Outlet />
      </div>
    </div>
  );
}

function Inner() {
  return (
    <MemberAuthGate>
      <MemberLayoutBody />
    </MemberAuthGate>
  );
}

export default function MemberShell() {
  return (
    <MemberDataProvider>
      <Inner />
    </MemberDataProvider>
  );
}
