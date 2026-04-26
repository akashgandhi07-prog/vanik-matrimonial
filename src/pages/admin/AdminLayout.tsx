import { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { MfaEnroll } from './MfaEnroll';
import { useAdminGuard } from './useAdminGuard';

const navCls = ({ isActive }: { isActive: boolean }) =>
  isActive ? 'btn btn-primary' : 'btn btn-secondary';

export default function AdminLayout() {
  const navigate = useNavigate();
  const { ok, mfaOk, denyReason, refresh, adminRole } = useAdminGuard();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [wide, setWide] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 900px)').matches : true
  );

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 900px)');
    const fn = () => {
      setWide(mq.matches);
      if (mq.matches) setSidebarOpen(false);
    };
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);

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

  const showDrawer = !wide && sidebarOpen;

  return (
    <div className="admin-layout">
      {!wide && (
        <div className="admin-mobile-bar">
          <button
            type="button"
            className="btn btn-secondary"
            aria-expanded={sidebarOpen}
            aria-controls="admin-sidebar"
            onClick={() => setSidebarOpen((o) => !o)}
          >
            Menu
          </button>
          <strong style={{ marginLeft: 12 }}>Admin</strong>
        </div>
      )}
      {showDrawer && (
        <button
          type="button"
          className="admin-sidebar-backdrop"
          aria-label="Close menu"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside
        id="admin-sidebar"
        className={`admin-sidebar ${showDrawer ? 'admin-sidebar--open' : ''}`}
      >
        <strong className="admin-sidebar-title">Admin</strong>
        <NavLink to="/admin" end className={navCls} onClick={() => setSidebarOpen(false)}>
          Overview
        </NavLink>
        <NavLink to="/admin/members" className={navCls} onClick={() => setSidebarOpen(false)}>
          Members
        </NavLink>
        <NavLink to="/admin/requests" className={navCls} onClick={() => setSidebarOpen(false)}>
          Requests
        </NavLink>
        <NavLink to="/admin/feedback" className={navCls} onClick={() => setSidebarOpen(false)}>
          Feedback
        </NavLink>
        {adminRole !== 'support' && (
          <NavLink to="/admin/add-member" className={navCls} onClick={() => setSidebarOpen(false)}>
            Add member
          </NavLink>
        )}
        <NavLink to="/admin/scheduled-jobs" className={navCls} onClick={() => setSidebarOpen(false)}>
          Scheduled jobs
        </NavLink>
        <NavLink to="/admin/coupons" className={navCls} onClick={() => setSidebarOpen(false)}>
          Coupons
        </NavLink>
        <NavLink to="/admin/email-log" className={navCls} onClick={() => setSidebarOpen(false)}>
          Email log
        </NavLink>
        <NavLink to="/admin/email-export" className={navCls} onClick={() => setSidebarOpen(false)}>
          Export emails
        </NavLink>
        <NavLink to="/admin/settings" className={navCls} onClick={() => setSidebarOpen(false)}>
          Settings
        </NavLink>
        <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <NavLink
            to="/"
            replace
            className="btn btn-secondary"
            onClick={() => setSidebarOpen(false)}
          >
            Exit admin
          </NavLink>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setSidebarOpen(false);
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
      </aside>
      <main className="admin-main table-scroll">
        <Outlet />
      </main>
    </div>
  );
}
