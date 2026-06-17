// Decorative mandala / lotus medallion for the landing hero.
// Pure SVG, themed to the burgundy + gold palette. No external assets.

const C = 220; // centre

function ring(count: number, d: string, offset = 0, props: Record<string, unknown> = {}) {
  return Array.from({ length: count }, (_, i) => (
    <path
      key={i}
      d={d}
      transform={`rotate(${offset + i * (360 / count)} ${C} ${C})`}
      {...props}
    />
  ));
}

export default function HeroArt() {
  const gold = '#c79433';
  const goldDeep = '#a5741f';
  const cream = '#f6ecd8';
  const burgundy = '#7b2e3b';

  // Petal paths (pointing up, rotated into rings).
  const outerPetal = 'M220 150 C 196 118, 198 72, 220 38 C 242 72, 244 118, 220 150 Z';
  const innerPetal = 'M220 168 C 206 146, 208 112, 220 92 C 232 112, 234 146, 220 168 Z';
  const corePetal = 'M220 198 C 213 186, 214 168, 220 158 C 226 168, 227 186, 220 198 Z';

  return (
    <svg
      viewBox="0 0 440 440"
      role="img"
      aria-label="Decorative mandala emblem"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* concentric guide rings */}
      <circle cx={C} cy={C} r="206" fill="none" stroke={gold} strokeWidth="1" opacity="0.35" />
      <circle cx={C} cy={C} r="198" fill="none" stroke={gold} strokeWidth="2" opacity="0.55" />
      <circle
        cx={C}
        cy={C}
        r="188"
        fill="none"
        stroke={gold}
        strokeWidth="1.5"
        opacity="0.4"
        strokeDasharray="2 9"
        strokeLinecap="round"
      />

      {/* outer lotus ring */}
      {ring(16, outerPetal, 0, {
        fill: cream,
        fillOpacity: 0.55,
        stroke: gold,
        strokeWidth: 1.25,
        strokeOpacity: 0.7,
      })}

      {/* inner lotus ring, interleaved */}
      {ring(16, innerPetal, 360 / 32, {
        fill: burgundy,
        fillOpacity: 0.08,
        stroke: goldDeep,
        strokeWidth: 1.25,
        strokeOpacity: 0.65,
      })}

      {/* centre medallion */}
      <circle cx={C} cy={C} r="62" fill="#ffffff" stroke={gold} strokeWidth="1.5" />
      <circle cx={C} cy={C} r="50" fill={burgundy} />
      <circle cx={C} cy={C} r="50" fill="none" stroke={gold} strokeWidth="2" opacity="0.85" />

      {/* core flower on the medallion */}
      {ring(8, corePetal, 0, { fill: cream, fillOpacity: 0.92 })}
      {ring(8, corePetal, 360 / 16, { fill: gold, fillOpacity: 0.5 })}
      <circle cx={C} cy={C} r="9" fill={cream} stroke={goldDeep} strokeWidth="1" />
    </svg>
  );
}
