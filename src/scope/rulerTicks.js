// Nice-number tick selection for the scope ruler. Pure.

/**
 * Round a raw step up to the nearest 1, 2 or 5 times a power of ten, so labels
 * read as round numbers rather than 3.7241.
 */
export function niceStep(rawStep) {
  if (!(rawStep > 0)) return 1;
  const exp = Math.floor(Math.log10(rawStep));
  const pow = Math.pow(10, exp);
  const frac = rawStep / pow;
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return nice * pow;
}

/**
 * Ticks covering [center - halfSpan, center + halfSpan].
 *
 * The step depends only on the SPAN, never on the centre, so panning does not
 * change it — otherwise labels would renumber themselves as the view scrolls,
 * which reads as flicker.
 */
export function rulerTicks(center, halfSpan, targetCount = 12) {
  if (!(halfSpan > 0) || !(targetCount > 0)) return { step: 1, ticks: [] };

  const step = niceStep((halfSpan * 2) / targetCount);
  const lo = center - halfSpan;
  const hi = center + halfSpan;

  const first = Math.ceil(lo / step) * step;
  const ticks = [];
  for (let v = first; v <= hi + step * 1e-9; v += step) {
    // Snap to the grid: repeated addition drifts, which shows up as labels
    // like "1999.9999999999998".
    const snapped = Math.round(v / step) * step;
    ticks.push({ value: snapped, major: Math.round(snapped / step) % 5 === 0 });
  }
  return { step, ticks };
}

/**
 * Label text for a tick. Trims trailing zeros so 2000, 0.5 and 12.5 all read
 * cleanly without a fixed decimal count.
 */
export function tickLabel(value, step) {
  // Derive the decimal count from the step's PRECISION, not its magnitude:
  // log10 alone gives 0.25 a single decimal and renders 12.25 as "12.3".
  let decimals = 0;
  while (decimals < 6 && Math.abs(Number(step.toFixed(decimals)) - step) > 1e-9) decimals++;
  const s = value.toFixed(decimals);
  // -0 is a real possibility from the snapping above.
  return s === '-0' || Object.is(Number(s), -0) ? '0' : s;
}
