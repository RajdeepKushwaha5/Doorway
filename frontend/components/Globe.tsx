/**
 * A slowly turning wireframe globe.
 *
 * Meridians and parallels drawn as SVG, spun by animating the meridian widths
 * rather than rendering a sphere. No library, no canvas, no WebGL context, and
 * it settles into a still globe when a reader has asked for reduced motion,
 * which a rendered scene would not do on its own.
 *
 * Decorative only, so it is hidden from assistive technology entirely.
 */
export function Globe() {
  const parallels = [0.18, 0.42, 0.62, 0.78, 0.9];

  return (
    <svg className="globe" viewBox="0 0 200 200" aria-hidden focusable="false">
      <g className="globe__sphere" fill="none" stroke="currentColor" strokeWidth="0.7">
        <circle cx="100" cy="100" r="82" strokeWidth="1.1" />

        {/* Parallels: fixed ellipses, widest at the equator. */}
        {parallels.map((ratio) => {
          const ry = 82 * Math.sqrt(1 - ratio * ratio);
          return (
            <g key={ratio}>
              <ellipse cx="100" cy={100 - 82 * ratio} rx={82 * Math.sqrt(1 - ratio * ratio)} ry={ry * 0.16} />
              <ellipse cx="100" cy={100 + 82 * ratio} rx={82 * Math.sqrt(1 - ratio * ratio)} ry={ry * 0.16} />
            </g>
          );
        })}
        <ellipse cx="100" cy="100" rx="82" ry="13" />

        {/* Meridians: each narrows and widens out of phase, which reads as
            rotation without any of the cost of computing one. */}
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <ellipse key={index} className="globe__meridian" cx="100" cy="100" rx="82" ry="82" />
        ))}
      </g>
    </svg>
  );
}
