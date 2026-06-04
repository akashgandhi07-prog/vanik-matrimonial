import { useEffect, useId, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useSiteSession } from './SessionContext';

export function SiteHeader() {
  const { user, greetingName, isAdmin, ready, refresh } = useSiteSession();
  const navigate = useNavigate();
  const location = useLocation();
  const narrowNav = useMediaQuery('(max-width: 720px)');
  const [menuOpen, setMenuOpen] = useState(false);
  const drawerTitleId = useId();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- close drawer on route change
    setMenuOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  async function signOut() {
    try {
      await supabase.auth.signOut();
    } catch {
      /* still leave signed-out UX */
    }
    try {
      await refresh();
    } catch {
      /* refresh can fail transiently; still continue to public landing */
    }
    navigate('/', { replace: true });
  }

  const hi = greetingName || 'there';

  const navLinks = !ready ? (
    <span className="public-nav-link" style={{ opacity: 0.6 }}>
      …
    </span>
  ) : !user ? (
    <>
      <Link to="/demo" className="public-nav-link" onClick={() => setMenuOpen(false)}>
        Browse Profiles
      </Link>
      <Link to="/login" className="public-nav-link" onClick={() => setMenuOpen(false)}>
        Member login
      </Link>
      <Link to="/register" className="public-nav-link public-nav-link--emphasis" onClick={() => setMenuOpen(false)}>
        Register
      </Link>
    </>
  ) : (
    <>
      <span className="public-nav-link public-nav-drawer-greeting">Hi, {hi}</span>
      {isAdmin ? (
        <Link to="/admin" className="public-nav-link" onClick={() => setMenuOpen(false)}>
          Admin
        </Link>
      ) : (
        <Link to="/dashboard/browse" className="public-nav-link" onClick={() => setMenuOpen(false)}>
          My dashboard
        </Link>
      )}
      <button type="button" className="public-nav-link public-nav-link--button" onClick={() => void signOut()}>
        Log out
      </button>
    </>
  );

  const feedbackLink = (
    <Link to="/app-feedback" className="public-nav-link public-nav-link--icon" onClick={() => setMenuOpen(false)}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={18}
        height={18}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx={12} cy={12} r={9} />
        <path d="M9 9h.01M15 9h.01M8 14s1.5 2 4 2 4-2 4-2" />
      </svg>
      Feedback
    </Link>
  );

  return (
    <header className="public-header">
      <div className="layout-max layout-max--header public-header-inner">
        <Link to="/" className="public-logo">
          Vanik Matrimonial Register
        </Link>
        {narrowNav ? (
          <>
            <button
              type="button"
              className="public-nav-menu-btn"
              aria-expanded={menuOpen}
              aria-controls="public-nav-drawer"
              onClick={() => setMenuOpen((o) => !o)}
            >
              <span className="public-nav-menu-btn-icon" aria-hidden>
                <span />
                <span />
                <span />
              </span>
              <span className="public-nav-menu-btn-label">Menu</span>
            </button>
            {menuOpen ? (
              <>
                <button
                  type="button"
                  className="public-nav-drawer-backdrop"
                  aria-label="Close menu"
                  onClick={() => setMenuOpen(false)}
                />
                <nav
                  id="public-nav-drawer"
                  className="public-nav-drawer"
                  aria-label="Main"
                  aria-labelledby={drawerTitleId}
                >
                  <div className="public-nav-drawer-head">
                    <span id={drawerTitleId} className="public-nav-drawer-title">
                      Menu
                    </span>
                    <button type="button" className="btn btn-secondary public-nav-drawer-close" onClick={() => setMenuOpen(false)}>
                      Close
                    </button>
                  </div>
                  <div className="public-nav-drawer-links">
                    {feedbackLink}
                    {navLinks}
                  </div>
                </nav>
              </>
            ) : null}
          </>
        ) : (
          <nav className="public-nav" aria-label="Main">
            {feedbackLink}
            {navLinks}
          </nav>
        )}
      </div>
    </header>
  );
}
