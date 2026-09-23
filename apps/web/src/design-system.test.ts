import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync("src/styles.css", "utf8");
const portrait = readFileSync("src/components/pattern-portrait.css", "utf8");
const accountPortrait = readFileSync(
  "src/components/account-pattern-portrait.css",
  "utf8",
);
const explorer = readFileSync(
  "src/components/portrait-explorer/explorer.css",
  "utf8",
);
const observatory = readFileSync(
  "src/components/portrait-explorer/observatory.css",
  "utf8",
);
const design = readFileSync("DESIGN.md", "utf8");
const designSidecar = JSON.parse(
  readFileSync(".impeccable/design.json", "utf8"),
) as {
  extensions: {
    colorMeta: Record<string, { canonical: string }>;
  };
};
const previewDesign = readFileSync("src/preview/DESIGN.md", "utf8");
const explorerDesign = readFileSync(
  "src/components/portrait-explorer/DESIGN.md",
  "utf8",
);
const impeccableConfig = JSON.parse(
  readFileSync("../../.impeccable/config.json", "utf8"),
) as { buildPath?: string };
const timingBrief = readFileSync(
  ".impeccable/surfaces/apps-web-src-components-timingview-tsx.md",
  "utf8",
);
const todayBrief = readFileSync(
  ".impeccable/surfaces/apps-web-src-components-todayview-tsx.md",
  "utf8",
);

function declarationValues(source: string, property: string): string[] {
  return Array.from(
    source.matchAll(new RegExp(`${property}:\\s*([^;}\\n]+)`, "g")),
    (match) => match[1]!.trim().replace(/\s*!important$/, ""),
  );
}

describe("web design contracts", () => {
  it("keeps evidence and label type on the documented 9px and 10px steps", () => {
    expect(styles).toMatch(/--label-xs:\s*9px;/);
    expect(styles).toMatch(/--label-sm:\s*9px;/);
    expect(styles).toMatch(/--label-md:\s*10px;/);
    expect(styles).not.toMatch(
      /@media \(max-width: 420px\)\s*{[\s\S]*?\.mobile-nav \.nav-item\s*{[^}]*font-size:\s*9px;/,
    );
    expect(styles).not.toMatch(/font-size:\s*8px;/);
    expect(explorer).not.toMatch(/font-size:\s*9px;/);
  });

  it("gives secondary text controls the same 44px target floor", () => {
    expect(styles).toMatch(
      /\.daily-check-in__detail-toggle\s*{[^}]*min-height:\s*44px;/s,
    );
    expect(styles).toMatch(
      /\.privacy-action__download,\s*\.privacy-action__retry\s*{[^}]*display:\s*inline-flex;[^}]*min-height:\s*44px;/s,
    );
    expect(styles).not.toContain("min-height: 32px");
  });

  it("keeps check-in fields at 16px and placeholder examples readable", () => {
    expect(styles).toMatch(
      /\.daily-check-in__field input,\s*\.daily-check-in__field select,\s*\.daily-check-in__field textarea\s*{[^}]*font-size:\s*16px;/s,
    );
    expect(styles).toMatch(
      /\.field input::placeholder\s*{[^}]*color:\s*var\(--ink-faint\);/s,
    );
  });

  it("keeps place search and portrait chrome square and structural", () => {
    expect(styles).toMatch(
      /\.place-autocomplete__consent\s*{[^}]*border-radius:\s*0;/s,
    );
    expect(styles).toMatch(
      /\.place-autocomplete__results\s*{[^}]*border-radius:\s*0;/s,
    );
    expect(new Set(declarationValues(accountPortrait, "border-radius")))
      .toEqual(new Set(["0"]));
    expect(new Set(declarationValues(explorer, "border-radius")))
      .toEqual(new Set(["0", "100%"]));
    expect(new Set(declarationValues(observatory, "border-radius")))
      .toEqual(new Set(["0"]));
    expect(new Set(declarationValues(explorer, "box-shadow")))
      .toEqual(new Set(["none"]));
    expect(observatory).toContain("filter:drop-shadow(0 1px 1px #17312a)");
  });

  it("uses a named, documented palette for the portrait night stage", () => {
    const nightTokens = [
      "--night-surface",
      "--on-night",
      "--on-night-soft",
      "--night-outline",
      "--night-hover",
      "--night-focus",
    ];
    for (const token of nightTokens) {
      expect(styles).toContain(token);
    }
    expect(portrait).toMatch(
      /\.portrait-stage\s*{[^}]*background:\s*var\(--night-surface\);[^}]*color:\s*var\(--on-night\);/s,
    );
    expect(portrait).toMatch(
      /\.portrait-selection button:focus-visible\s*{[^}]*var\(--night-focus\)/s,
    );
    expect(design).toContain('on-surface-faint: "#596962"');
    expect(design).toContain('night-surface: "#091923"');
    expect(previewDesign).toContain('night-surface: "#091923"');
    expect(explorerDesign).not.toContain("legacy dialog rounding");
    expect(designSidecar.extensions.colorMeta["on-surface-faint"]?.canonical)
      .toBe("#596962");
    for (const token of nightTokens) {
      expect(designSidecar.extensions.colorMeta[token.slice(2)]?.canonical)
        .toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("keeps Impeccable direction and surface targets rooted correctly", () => {
    expect(impeccableConfig.buildPath).toBe("comp");
    expect(timingBrief).toContain(
      'primary_target: "src/components/TimingView.tsx"',
    );
    expect(todayBrief).toContain(
      'primary_target: "src/components/TodayView.tsx"',
    );
    expect(timingBrief).not.toContain('primary_target: "apps/web/');
    expect(todayBrief).not.toContain('primary_target: "apps/web/');
  });
});
