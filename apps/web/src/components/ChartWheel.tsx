import type { CelestialBody, LongitudePosition, NatalAspect } from "@patternlike/shared";

const BODY_LABELS: Record<CelestialBody, string> = {
  sun: "SU",
  moon: "MO",
  mercury: "ME",
  venus: "VE",
  mars: "MA",
  jupiter: "JU",
  saturn: "SA",
  uranus: "UR",
  neptune: "NE",
  pluto: "PL",
  true_node: "NN",
  ascendant: "AC",
  midheaven: "MC",
};

const SIGN_LABELS = [
  "ARI",
  "TAU",
  "GEM",
  "CAN",
  "LEO",
  "VIR",
  "LIB",
  "SCO",
  "SAG",
  "CAP",
  "AQU",
  "PIS",
];

const CENTER = 260;
const LABEL_RADIUS = 168;
const LABEL_BADGE_RADIUS = 13;

/**
 * Two badges are 26 user units across, so at the label radius anything closer
 * than 2 * asin(13 / 168) ≈ 8.9 degrees of arc draws one on top of the other.
 * The previous 7 degrees left every tight cluster overlapping.
 */
const MIN_LABEL_SEPARATION_DEG =
  (2 * Math.asin(LABEL_BADGE_RADIUS / LABEL_RADIUS) * 180) / Math.PI + 0.8;

function point(longitude: number, radius: number): { x: number; y: number } {
  const radians = ((longitude - 90) * Math.PI) / 180;
  return {
    x: CENTER + Math.cos(radians) * radius,
    y: CENTER + Math.sin(radians) * radius,
  };
}

function labelAngles(positions: LongitudePosition[]): Map<CelestialBody, number> {
  const sorted = [...positions].sort((a, b) => a.longitude_deg - b.longitude_deg);
  if (sorted.length === 0) return new Map();

  // Spread labels forward out of their clusters, starting immediately after the
  // widest empty arc. Cutting the circle there is what keeps the last label from
  // being pushed around 360 degrees into the first one: the total spread can
  // never exceed the occupied arc, so the seam always stays clear.
  let cut = 0;
  let widestGap = -1;
  for (let index = 0; index < sorted.length; index++) {
    const next = sorted[(index + 1) % sorted.length].longitude_deg;
    const gap = (next - sorted[index].longitude_deg + 360) % 360;
    if (gap > widestGap) {
      widestGap = gap;
      cut = (index + 1) % sorted.length;
    }
  }

  const ordered = [...sorted.slice(cut), ...sorted.slice(0, cut)];
  const start = ordered[0].longitude_deg;
  const angles = ordered.map(
    (position) => start + ((position.longitude_deg - start + 360) % 360),
  );

  for (let index = 1; index < angles.length; index++) {
    if (angles[index] - angles[index - 1] < MIN_LABEL_SEPARATION_DEG) {
      angles[index] = angles[index - 1] + MIN_LABEL_SEPARATION_DEG;
    }
  }

  return new Map(ordered.map((position, index) => [position.body, angles[index]]));
}

interface ChartWheelProps {
  positions: LongitudePosition[];
  aspects: NatalAspect[];
  houseCusps: number[] | null;
}

export function ChartWheel({ positions, aspects, houseCusps }: ChartWheelProps) {
  const labels = labelAngles(positions);
  const positionByBody = new Map(positions.map((position) => [position.body, position]));

  return (
    <svg
      className="chart-wheel"
      viewBox="0 0 520 520"
      role="img"
      aria-labelledby="chart-wheel-title chart-wheel-description"
    >
      <title id="chart-wheel-title">Natal chart calculation map</title>
      <desc id="chart-wheel-description">
        Planetary longitudes, major aspects, and available house cusps arranged around the ecliptic.
      </desc>

      <circle className="wheel-surface" cx={CENTER} cy={CENTER} r="246" />
      <circle className="wheel-ring wheel-ring--outer" cx={CENTER} cy={CENTER} r="228" />
      <circle className="wheel-ring" cx={CENTER} cy={CENTER} r="188" />
      <circle className="wheel-ring wheel-ring--inner" cx={CENTER} cy={CENTER} r="132" />

      {Array.from({ length: 12 }, (_, index) => {
        const divider = point(index * 30, 228);
        const dividerInner = point(index * 30, 188);
        const sign = point(index * 30 + 15, 208);
        return (
          <g key={SIGN_LABELS[index]}>
            <line
              className="wheel-division"
              x1={dividerInner.x}
              y1={dividerInner.y}
              x2={divider.x}
              y2={divider.y}
            />
            <text className="wheel-sign" x={sign.x} y={sign.y} textAnchor="middle" dominantBaseline="middle">
              {SIGN_LABELS[index]}
            </text>
          </g>
        );
      })}

      {houseCusps?.map((cusp, index) => {
        const outer = point(cusp, 187);
        const inner = point(cusp, 132);
        const number = point(cusp + 8, 147);
        return (
          <g key={`${cusp}-${index}`}>
            <line className="wheel-house" x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} />
            <text
              className="wheel-house-number"
              x={number.x}
              y={number.y}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {index + 1}
            </text>
          </g>
        );
      })}

      <g className="wheel-aspects">
        {aspects.slice(0, 32).map((aspect) => {
          const bodyA = positionByBody.get(aspect.body_a);
          const bodyB = positionByBody.get(aspect.body_b);
          if (!bodyA || !bodyB) return null;
          const a = point(bodyA.longitude_deg, 124);
          const b = point(bodyB.longitude_deg, 124);
          return (
            <line
              className={`wheel-aspect wheel-aspect--${aspect.aspect}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              key={aspect.id}
            />
          );
        })}
      </g>

      {positions.map((position) => {
        const bodyPoint = point(position.longitude_deg, 122);
        const tickInner = point(position.longitude_deg, 112);
        const tickOuter = point(position.longitude_deg, 132);
        const labelPoint = point(
          labels.get(position.body) ?? position.longitude_deg,
          LABEL_RADIUS,
        );
        return (
          <g className="wheel-body" key={position.body}>
            <line x1={tickInner.x} y1={tickInner.y} x2={tickOuter.x} y2={tickOuter.y} />
            <circle cx={bodyPoint.x} cy={bodyPoint.y} r="4.5" />
            <line
              className="wheel-body__leader"
              x1={bodyPoint.x}
              y1={bodyPoint.y}
              x2={labelPoint.x}
              y2={labelPoint.y}
            />
            <circle
              className="wheel-body__label-bg"
              cx={labelPoint.x}
              cy={labelPoint.y}
              r={LABEL_BADGE_RADIUS}
            />
            <text x={labelPoint.x} y={labelPoint.y} textAnchor="middle" dominantBaseline="middle">
              {BODY_LABELS[position.body]}
            </text>
          </g>
        );
      })}

      <circle className="wheel-core" cx={CENTER} cy={CENTER} r="45" />
      <text className="wheel-core__label" x={CENTER} y={CENTER - 4} textAnchor="middle">
        ECLIPTIC
      </text>
      <text className="wheel-core__sub" x={CENTER} y={CENTER + 13} textAnchor="middle">
        TROPICAL
      </text>
    </svg>
  );
}
