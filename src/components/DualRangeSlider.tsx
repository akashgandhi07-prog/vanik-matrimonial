import { useMemo, type ChangeEvent } from 'react';

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

export type DualRangeSliderProps = {
  min: number;
  max: number;
  step?: number;
  value: [number, number];
  onChange: (next: [number, number]) => void;
  formatValue: (n: number) => string;
  minLabel: React.ReactNode;
  maxLabel: React.ReactNode;
  lowAriaLabel: string;
  highAriaLabel: string;
};

export function DualRangeSlider({
  min,
  max,
  step = 1,
  value,
  onChange,
  formatValue,
  minLabel,
  maxLabel,
  lowAriaLabel,
  highAriaLabel,
}: DualRangeSliderProps) {
  const [low, high] = value;

  const { leftPct, widthPct } = useMemo(() => {
    const span = max - min;
    if (span <= 0) return { leftPct: 0, widthPct: 0 };
    const p1 = ((low - min) / span) * 100;
    const p2 = ((high - min) / span) * 100;
    return { leftPct: p1, widthPct: Math.max(0, p2 - p1) };
  }, [low, high, min, max]);

  const zMin = low + step >= high ? 5 : 3;
  const zMax = low + step >= high ? 3 : 4;

  function onLowChange(e: ChangeEvent<HTMLInputElement>) {
    const raw = Number(e.target.value);
    if (Number.isNaN(raw)) return;
    const next = clamp(raw, min, max);
    onChange([Math.min(next, high), high]);
  }

  function onHighChange(e: ChangeEvent<HTMLInputElement>) {
    const raw = Number(e.target.value);
    if (Number.isNaN(raw)) return;
    const next = clamp(raw, min, max);
    onChange([low, Math.max(next, low)]);
  }

  return (
    <div className="member-dual-range">
      <div className="member-dual-range__meta" aria-hidden>
        <span className="member-dual-range__edge">{minLabel}</span>
        <span className="member-dual-range__range-label">
          <span className="member-dual-range__value">{formatValue(low)}</span>
          <span className="member-dual-range__sep">-</span>
          <span className="member-dual-range__value">{formatValue(high)}</span>
        </span>
        <span className="member-dual-range__edge">{maxLabel}</span>
      </div>
      <div className="member-dual-range__sliders">
        <div className="member-dual-range__track-wrap">
          <div className="member-dual-range__track-bg" />
          <div
            className="member-dual-range__track-fill"
            style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
          />
          <input
            type="range"
            className="member-dual-range__input member-dual-range__input--low"
            style={{ zIndex: zMin }}
            min={min}
            max={max}
            step={step}
            value={low}
            onChange={onLowChange}
            aria-label={lowAriaLabel}
          />
          <input
            type="range"
            className="member-dual-range__input member-dual-range__input--high"
            style={{ zIndex: zMax }}
            min={min}
            max={max}
            step={step}
            value={high}
            onChange={onHighChange}
            aria-label={highAriaLabel}
          />
        </div>
      </div>
    </div>
  );
}
