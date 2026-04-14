import { Link } from 'react-router-dom';

export function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="public-shell">
      <header className="public-header">
        <div className="layout-max layout-max--header public-header-inner">
          <Link to="/" className="public-logo">
            Vanik Matrimonial Register
          </Link>
          <nav className="public-nav" aria-label="Main">
            <Link to="/login" className="public-nav-link">
              Member login
            </Link>
            <Link to="/register" className="public-nav-link public-nav-link--emphasis">
              Register
            </Link>
          </nav>
        </div>
      </header>
      <main className="public-main">{children}</main>
      <footer className="public-footer">
        <div className="layout-max layout-max--footer">
          <p>
            Vanik Council. Contact:{' '}
            <a href="mailto:register@vanikmatrimonial.co.uk">register@vanikmatrimonial.co.uk</a>
          </p>
        </div>
      </footer>
    </div>
  );
}
