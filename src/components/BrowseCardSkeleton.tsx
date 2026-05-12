export function BrowseCardSkeleton() {
  return (
    <div className="browse-card-skeleton card" aria-hidden>
      <div className="browse-card-skeleton__body">
        <div className="browse-card-skeleton__line browse-card-skeleton__line--title" />
        <div className="browse-card-skeleton__line browse-card-skeleton__line--muted" />
        <div className="browse-card-skeleton__line browse-card-skeleton__line--short" />
        <div className="browse-card-skeleton__actions">
          <div className="browse-card-skeleton__btn" />
          <div className="browse-card-skeleton__btn" />
        </div>
      </div>
    </div>
  );
}
