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
