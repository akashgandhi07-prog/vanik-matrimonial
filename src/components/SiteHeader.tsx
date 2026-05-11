import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSiteSession } from './SessionContext';

export function SiteHeader() {
  const { user, greetingName, isAdmin, ready, refresh } = useSiteSession();
  const navigate = useNavigate();

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

  return (
    <header className="public-header">
      <div className="layout-max layout-max--header public-header-inner">
        <Link to="/" className="public-logo">
          Vanik Matrimonial Register
        </Link>
        <nav className="public-nav" aria-label="Main">
          <Link to="/app-feedback" className="public-nav-link public-nav-link--icon">
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
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 8.25-8.57h.5a8.53 8.53 0 0 1 8.35 8.37z" />
              <path d="M9 10h.01M15 10h.01M9.09 13.76a5 5 0 0 1 5.83 0" />
            </svg>
            Feedback
          </Link>
          {!ready ? (
            <span className="public-nav-link" style={{ opacity: 0.6 }}>
              …
            </span>
          ) : !user ? (
            <>
              <Link to="/demo" className="public-nav-link">
                Browse Profiles
              </Link>
              <Link to="/login" className="public-nav-link">
                Member login
              </Link>
              <Link to="/register" className="public-nav-link public-nav-link--emphasis">
                Register
              </Link>
            </>
          ) : (
            <>
              <span className="public-nav-link" style={{ cursor: 'default' }}>
                Hi, {hi}
              </span>
              {isAdmin ? (
                <Link to="/admin" className="public-nav-link">
                  Admin
                </Link>
              ) : (
                <Link to="/dashboard/browse" className="public-nav-link">
                  My dashboard
                </Link>
              )}
              <button type="button" className="public-nav-link public-nav-link--button" onClick={() => void signOut()}>
                Log out
              </button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
