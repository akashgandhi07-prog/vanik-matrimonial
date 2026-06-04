type VanikCouncilLogoProps = {
  className?: string;
  /** When set, wraps the image in a link (e.g. council site or app home). */
  href?: string;
  /** Show "Vanik Matrimonial Register" beside the logo (public header). */
  showRegisterName?: boolean;
};

export function VanikCouncilLogo({
  className = '',
  href,
  showRegisterName = false,
}: VanikCouncilLogoProps) {
  const img = (
    <img
      src="/vanik-council-logo.jpg"
      alt="Vanik Council"
      className="vanik-council-logo__img"
      width={174}
      height={36}
      decoding="async"
    />
  );

  const inner = (
    <>
      {href ? (
        <a
          href={href}
          className="vanik-council-logo__mark"
          {...(href.startsWith('http')
            ? { target: '_blank', rel: 'noopener noreferrer' }
            : {})}
        >
          {img}
        </a>
      ) : (
        <span className="vanik-council-logo__mark">{img}</span>
      )}
      {showRegisterName ? (
        <span className="vanik-council-logo__register">Vanik Matrimonial Register</span>
      ) : null}
    </>
  );

  return <div className={['vanik-council-logo', className].filter(Boolean).join(' ')}>{inner}</div>;
}
