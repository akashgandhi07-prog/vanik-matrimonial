/** Site chrome (logo, Hi / login, log out) lives in `SiteHeader` in App. */
export function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="public-shell">
      <main className="public-main">{children}</main>
      <footer className="public-footer">
        <div className="layout-max layout-max--footer">
          <p>
            Vanik Council. Contact:{' '}
            <a href="mailto:matrimonial@vanikcouncil.uk">matrimonial@vanikcouncil.uk</a>
          </p>
        </div>
      </footer>
    </div>
  );
}
