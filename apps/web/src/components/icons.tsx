import type { SVGProps } from "react";

export type IconName =
  | "today"
  | "pattern"
  | "timing"
  | "travel"
  | "privacy"
  | "arrow"
  | "check"
  | "refresh"
  | "shield"
  | "quiet"
  | "steady"
  | "full"
  | "plus"
  | "minus"
  | "mixed"
  | "almost"
  | "miss";

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  const paths: Record<IconName, React.ReactNode> = {
    today: (
      <>
        <circle cx="12" cy="12" r="4.25" />
        <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" />
      </>
    ),
    pattern: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M3.8 12h16.4M12 3.5c2.4 2.3 3.7 5.1 3.7 8.5s-1.3 6.2-3.7 8.5c-2.4-2.3-3.7-5.1-3.7-8.5S9.6 5.8 12 3.5Z" />
      </>
    ),
    timing: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7v5l3.2 2" />
      </>
    ),
    travel: (
      <>
        <path d="M5 5.5h14v14H5zM8 3.5v4M16 3.5v4M5 9.5h14" />
        <path d="m9.5 14 2-2 2 2M11.5 12v4.5" />
      </>
    ),
    privacy: (
      <>
        <path d="M12 3.2 19 6v5.2c0 4.5-2.8 7.8-7 9.6-4.2-1.8-7-5.1-7-9.6V6l7-2.8Z" />
        <path d="m8.8 12.1 2 2 4.5-4.5" />
      </>
    ),
    arrow: <path d="M5 12h14M14 7l5 5-5 5" />,
    check: <path d="m5 12.5 4.2 4.2L19 7" />,
    refresh: (
      <>
        <path d="M19.5 8.5V4.8l-2 2A8 8 0 1 0 20 13" />
        <path d="M19.5 4.8h-3.7" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3.2 19 6v5.2c0 4.5-2.8 7.8-7 9.6-4.2-1.8-7-5.1-7-9.6V6l7-2.8Z" />
        <path d="M9.5 11.5V10a2.5 2.5 0 0 1 5 0v1.5M9 11.5h6v4.5H9z" />
      </>
    ),
    /*
     * Arriving-energy marks. A library stroke (Lucide, Phosphor, Heroicons)
     * would import a second optical size into a set that is already 24/1.6.
     * Quiet is a point at rest; steady adds the orbit; full adds cardinal ticks.
     * Circles are earned: these are states of a continuous charge, not decoration.
     */
    quiet: <circle cx="12" cy="12" r="3.2" />,
    steady: (
      <>
        <circle cx="12" cy="12" r="2.4" />
        <circle cx="12" cy="12" r="8" />
      </>
    ),
    full: (
      <>
        <circle cx="12" cy="12" r="2.4" />
        <circle cx="12" cy="12" r="6.4" />
        <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2" />
      </>
    ),
    plus: <path d="M12 6v12M6 12h12" />,
    minus: <path d="M6 12h12" />,
    mixed: (
      <>
        <circle cx="8" cy="14.5" r="2.4" />
        <circle cx="16" cy="9" r="2.4" />
      </>
    ),
    almost: <path d="M7 13.2 10.8 17l3.2-3.2" />,
    miss: (
      <>
        <circle cx="8.4" cy="14.2" r="5.2" />
        <path d="m16 5.2 4 4M20 5.2l-4 4" />
      </>
    ),
  };

  return (
    <svg {...common} {...props}>
      {paths[name]}
    </svg>
  );
}
