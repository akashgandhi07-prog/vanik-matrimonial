import { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { invokeFunction, supabase } from '../../lib/supabase';
import { MfaEnroll } from './MfaEnroll';
import { useAdminGuard } from './useAdminGuard';

const navCls = ({ isActive }: { isActive: boolean }) =>
  isActive ? 'btn btn-primary' : 'btn btn-secondary';

export default function AdminLayout() {
  const navigate = useNavigate();
  const { ok, mfaOk, denyReason, refresh, adminRole } = useAdminGuard();
  const [wide, setWide] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 900px)').matches : true
  );

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 900px)');
    const fn = () => setWide(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);

  // Email health check: surfaces send failures and bounces in-app, because an
  // email alert about email being broken would never arrive.
  const [emailProblems, setEmailProblems] = useState(0);
  useEffect(() => {
    if (ok !== true || mfaOk !== true) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = (await invokeFunction('admin-manage-users', { action: 'email_health' })) as {
          failed?: number;
          undelivered?: number;
        };
        if (!cancelled) setEmailProblems((res.failed ?? 0) + (res.undelivered ?? 0));
      } catch {
        /* banner is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ok, mfaOk]);

  if (ok === false) {
    if (denyReason === 'anon') {
      return <Navigate to="/login?next=%2Fadmin" replace />;
    }
    return <Navigate to="/dashboard/browse" replace />;
  }
  if (ok === null || mfaOk === null) {
    return <div className="layout-max">Loading…</div>;
  }
  if (!mfaOk) {
    return <MfaEnroll onDone={() => void refresh()} />;
  }

  return (
    <>
      {emailProblems > 0 && (
        <div
          role="alert"
          style={{
            width: '100%',
            background: 'rgba(185,28,28,0.08)',
            borderBottom: '1px solid rgba(185,28,28,0.35)',
            color: 'var(--color-danger)',
            padding: '10px 20px',
            fontSize: 14,
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          <strong>
            {emailProblems} email{emailProblems === 1 ? '' : 's'} failed to send or deliver in the last 48 hours.
          </strong>
          <NavLink to="/admin/email-log" className="btn btn-secondary" style={{ padding: '4px 12px', fontSize: 13 }}>
            Open Email log
          </NavLink>
        </div>
      )}
    <div className="admin-layout">
      {!wide && (
        <div className="admin-mobile-bar">
          <strong className="admin-mobile-title">Admin</strong>
          <div className="admin-mobile-nav">
            <NavLink to="/admin" end className={navCls}>
              Overview
            </NavLink>
            <NavLink to="/admin/members" className={navCls}>
              Members
            </NavLink>
            <NavLink to="/admin/requests" className={navCls}>
              Requests
            </NavLink>
            <NavLink to="/admin/feedback" className={navCls}>
              Feedback
            </NavLink>
            <NavLink to="/admin/analytics" className={navCls}>
              Analytics
            </NavLink>
            {adminRole !== 'support' && (
              <NavLink to="/admin/add-member" className={navCls}>
                Add member
              </NavLink>
            )}
            <NavLink to="/admin/scheduled-jobs" className={navCls}>
              Scheduled jobs
            </NavLink>
            <NavLink to="/admin/payments" className={navCls}>
              Payments
            </NavLink>
            <NavLink to="/admin/coupons" className={navCls}>
              Coupons
            </NavLink>
            <NavLink to="/admin/email-log" className={navCls}>
              Email log
            </NavLink>
            <NavLink to="/admin/email-export" className={navCls}>
              Export emails
            </NavLink>
            <NavLink to="/admin/error-log" className={navCls}>
              Error log
            </NavLink>
            <NavLink to="/admin/settings" className={navCls}>
              Settings
            </NavLink>
            <NavLink to="/" replace className="btn btn-secondary">
              Exit admin
            </NavLink>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                void (async () => {
                  try {
                    await supabase.auth.signOut();
                  } catch {
                    /* still leave */
                  }
                  navigate('/', { replace: true });
                })();
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      )}
      {wide && <aside id="admin-sidebar" className="admin-sidebar">
        <strong className="admin-sidebar-title">Admin</strong>
        <NavLink to="/admin" end className={navCls}>
          Overview
        </NavLink>
        <NavLink to="/admin/members" className={navCls}>
          Members
        </NavLink>
        <NavLink to="/admin/requests" className={navCls}>
          Requests
        </NavLink>
        <NavLink to="/admin/feedback" className={navCls}>
          Feedback
        </NavLink>
        <NavLink to="/admin/analytics" className={navCls}>
          Analytics
        </NavLink>
        {adminRole !== 'support' && (
          <NavLink to="/admin/add-member" className={navCls}>
            Add member
          </NavLink>
        )}
        <NavLink to="/admin/scheduled-jobs" className={navCls}>
          Scheduled jobs
        </NavLink>
        <NavLink to="/admin/payments" className={navCls}>
          Payments
        </NavLink>
        <NavLink to="/admin/coupons" className={navCls}>
          Coupons
        </NavLink>
        <NavLink to="/admin/email-log" className={navCls}>
          Email log
        </NavLink>
        <NavLink to="/admin/email-export" className={navCls}>
          Export emails
        </NavLink>
        <NavLink to="/admin/error-log" className={navCls}>
          Error log
        </NavLink>
        <NavLink to="/admin/settings" className={navCls}>
          Settings
        </NavLink>
        <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <NavLink to="/" replace className="btn btn-secondary">
            Exit admin
          </NavLink>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              void (async () => {
                try {
                  await supabase.auth.signOut();
                } catch {
                  /* still leave */
                }
                navigate('/', { replace: true });
              })();
            }}
          >
            Sign out
          </button>
        </div>
      </aside>}
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
    </>
  );
}
