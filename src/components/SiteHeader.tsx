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
    <Link to="/app-feedback" className="public-nav-link" onClick={() => setMenuOpen(false)}>
      Feedback
    </Link>
  );

  return (
    <header className="public-header">
      <div className="layout-max layout-max--header public-header-inner">
        <Link to="/" className="public-logo">
          <span className="public-logo-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" rx="8" fill="#7b2e3b" />
              <path
                d="M9.5 9.5 16 22.5 22.5 9.5"
                fill="none"
                stroke="#c79433"
                strokeWidth="3.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span>Vanik Matrimonial Register</span>
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
