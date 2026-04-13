import { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet } from 'react-router-dom';
import { MfaEnroll } from './MfaEnroll';
import { useAdminGuard } from './useAdminGuard';

const navCls = ({ isActive }: { isActive: boolean }) =>
  isActive ? 'btn btn-primary' : 'btn btn-secondary';

export default function AdminLayout() {
  const { ok, mfaOk, denyReason, refresh } = useAdminGuard();
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
        <NavLink to="/admin/coupons" className={navCls} onClick={() => setSidebarOpen(false)}>
          Coupons
        </NavLink>
        <NavLink to="/admin/email-log" className={navCls} onClick={() => setSidebarOpen(false)}>
          Email log
        </NavLink>
        <NavLink to="/admin/settings" className={navCls} onClick={() => setSidebarOpen(false)}>
          Settings
        </NavLink>
        <NavLink to="/dashboard/browse" className="btn btn-secondary" style={{ marginTop: 24 }} onClick={() => setSidebarOpen(false)}>
          Exit admin
        </NavLink>
      </aside>
      <main className="admin-main table-scroll">
        <Outlet />
      </main>
    </div>
  );
}
