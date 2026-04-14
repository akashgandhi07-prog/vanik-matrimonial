import { NavLink, Outlet } from 'react-router-dom';
import { MemberAuthGate, MemberDataProvider, useMemberArea } from '../member/memberContext';

function daysBetween(a: Date, b: Date) {
  return Math.ceil((b.getTime() - a.getTime()) / 86400000);
}

function MemberLayoutBody() {
  const { profile } = useMemberArea();

  if (!profile) return null;

  const exp = profile.membership_expires_at ? new Date(profile.membership_expires_at) : null;
  const daysToExp = exp ? daysBetween(new Date(), exp) : null;
  const showAmber = daysToExp != null && daysToExp <= 30 && daysToExp > 7;
  const showRed = daysToExp != null && daysToExp <= 7 && daysToExp >= 0;

  const navCls = ({ isActive }: { isActive: boolean }) =>
    isActive ? 'btn btn-primary' : 'btn btn-secondary';

  return (
    <div className="member-dashboard-root" style={{ paddingBottom: 24 }}>
      <header className="member-dashboard-header member-dashboard-header--bar">
        <div className="layout-max member-dashboard-header-inner">
          <div className="member-dashboard-header-meta">
            <strong className="member-dashboard-header-title">Member area</strong>
            {(profile.reference_number || exp) && (
              <div className="member-dashboard-header-sub">
                {profile.reference_number && <span>Ref: {profile.reference_number}</span>}
                {exp && (
                  <span>
                    Membership expires{' '}
                    {exp.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        {showAmber && (
          <div className="layout-max member-dashboard-renew-banner renew-banner renew-banner--amber">
            <span>Your membership expires in {daysToExp} days. Renew to keep access.</span>
            <NavLink to="/renew-membership" className="btn btn-primary" style={{ padding: '4px 12px', fontSize: 13 }}>
              Renew online
            </NavLink>
          </div>
        )}
        {showRed && (
          <div className="layout-max member-dashboard-renew-banner renew-banner renew-banner--urgent">
            <span>Your membership expires in {daysToExp} days. After this date your profile will be hidden.</span>
            <NavLink to="/renew-membership" className="btn btn-primary" style={{ padding: '4px 12px', fontSize: 13 }}>
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
