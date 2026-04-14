import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { MemberAuthGate, MemberDataProvider, useMemberArea } from '../member/memberContext';

function daysBetween(a: Date, b: Date) {
  return Math.ceil((b.getTime() - a.getTime()) / 86400000);
}

function MemberLayoutBody() {
  const navigate = useNavigate();
  const { profile } = useMemberArea();

  async function signOut() {
    try {
      await supabase.auth.signOut();
    } catch {
      /* still leave the dashboard */
    }
    navigate('/', { replace: true });
  }

  if (!profile) return null;

  const exp = profile.membership_expires_at ? new Date(profile.membership_expires_at) : null;
  const daysToExp = exp ? daysBetween(new Date(), exp) : null;
  const showAmber = daysToExp != null && daysToExp <= 30 && daysToExp > 7;
  const showRed = daysToExp != null && daysToExp <= 7 && daysToExp >= 0;

  const navCls = ({ isActive }: { isActive: boolean }) =>
    isActive ? 'btn btn-primary' : 'btn btn-secondary';

  return (
    <div className="member-dashboard-root" style={{ paddingBottom: 24 }}>
      <header
        className="member-dashboard-header"
        style={{
          background: 'white',
          borderBottom: '1px solid var(--color-border)',
          padding: '16px 20px',
        }}
      >
        <div className="layout-max member-dashboard-header-inner">
          <div style={{ flex: 1, minWidth: 200 }}>
            <strong>Welcome back, {profile.first_name}</strong>
            {profile.reference_number && (
              <span style={{ color: 'var(--color-text-secondary)', marginLeft: 12, fontSize: 13 }}>
                Ref: {profile.reference_number}
              </span>
            )}
            {exp && (
              <span style={{ color: 'var(--color-text-secondary)', marginLeft: 12, fontSize: 13 }}>
                Membership expires{' '}
                {exp.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            )}
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
        {showAmber && (
          <div
            className="layout-max"
            style={{
              marginTop: 12,
              padding: '10px 16px',
              background: 'rgba(217, 119, 6, 0.12)',
              borderRadius: 8,
              color: 'var(--color-warning)',
              fontSize: 14,
            }}
          >
            Your membership expires in {daysToExp} days. Renew to keep access.{' '}
            <NavLink to="/renew-membership" className="btn btn-primary" style={{ marginLeft: 8, padding: '4px 12px', fontSize: 13 }}>
              Renew online
            </NavLink>
          </div>
        )}
        {showRed && (
          <div
            className="layout-max"
            style={{
              marginTop: 12,
              padding: '10px 16px',
              background: 'rgba(220, 38, 38, 0.1)',
              borderRadius: 8,
              color: 'var(--color-danger)',
              fontSize: 14,
            }}
          >
            Your membership expires in {daysToExp} days. After this date your profile will be hidden.{' '}
            <NavLink to="/renew-membership" className="btn btn-primary" style={{ marginLeft: 8, padding: '4px 12px', fontSize: 13 }}>
              Renew online
            </NavLink>
          </div>
        )}
      </header>

      <div className="layout-max member-dashboard-main" style={{ marginTop: 20 }}>
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
