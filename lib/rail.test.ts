// Unit + invariant tests for the responsive Navigation_Rail layout resolver
// (Req 13.8, 14.1). The authoritative breakpoints live in
// `.kiro/steering/ui-design.md` §6.
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  BREAKPOINT_COMPACT_MAX,
  BREAKPOINT_STANDARD_MAX,
  MAX_CONTENT_WIDTH,
  RAIL_WIDTH_COMPACT,
  RAIL_WIDTH_EXPANDED,
  RAIL_WIDTH_ICON,
  resolveRailLayout,
} from "./rail";

const RUNS = 100;

describe("resolveRailLayout (Req 13.8, 14.1)", () => {
  // Req 13.8 — compact / half-screen (< 960px): icon-only 64px rail, 1 column.
  it("returns an icon-only 64px rail below 960px", () => {
    for (const width of [0, 320, 640, 959]) {
      expect(resolveRailLayout(width)).toEqual({
        mode: "icon",
        railWidth: RAIL_WIDTH_ICON,
        contentColumns: 1,
        maxContentWidth: MAX_CONTENT_WIDTH,
      });
    }
  });

  // Req 13.8 — standard desktop (960–1360px): compact 72px rail, 2 columns.
  it("returns a compact 72px rail from 960px through 1360px", () => {
    for (const width of [960, 1024, 1280, 1360]) {
      expect(resolveRailLayout(width)).toEqual({
        mode: "compact",
        railWidth: RAIL_WIDTH_COMPACT,
        contentColumns: 2,
        maxContentWidth: MAX_CONTENT_WIDTH,
      });
    }
  });

  // Req 13.8 — wide monitor (> 1360px): expanded 220px rail, 3 columns.
  it("returns an expanded 220px rail above 1360px", () => {
    for (const width of [1361, 1440, 1920, 3840]) {
      expect(resolveRailLayout(width)).toEqual({
        mode: "expanded",
        railWidth: RAIL_WIDTH_EXPANDED,
        contentColumns: 3,
        maxContentWidth: MAX_CONTENT_WIDTH,
      });
    }
  });

  // Exact breakpoint boundaries (steering §6): 960 is standard, 1361 is wide.
  it("places the breakpoint boundaries on the correct side", () => {
    expect(resolveRailLayout(BREAKPOINT_COMPACT_MAX - 1).mode).toBe("icon");
    expect(resolveRailLayout(BREAKPOINT_COMPACT_MAX).mode).toBe("compact");
    expect(resolveRailLayout(BREAKPOINT_STANDARD_MAX).mode).toBe("compact");
    expect(resolveRailLayout(BREAKPOINT_STANDARD_MAX + 1).mode).toBe("expanded");
  });

  // Invariant: for ANY viewport width the resolver yields exactly one of the
  // three steering layouts, the content cap is always 1440px, and the rail
  // width/column count stay consistent with the resolved mode (Req 13.8).
  it("maps any viewport width to a consistent steering layout", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000 }),
        (width) => {
          const layout = resolveRailLayout(width);

          expect(layout.maxContentWidth).toBe(1440);

          if (layout.mode === "icon") {
            expect(width).toBeLessThan(BREAKPOINT_COMPACT_MAX);
            expect(layout.railWidth).toBe(RAIL_WIDTH_ICON);
            expect(layout.contentColumns).toBe(1);
          } else if (layout.mode === "compact") {
            expect(width).toBeGreaterThanOrEqual(BREAKPOINT_COMPACT_MAX);
            expect(width).toBeLessThanOrEqual(BREAKPOINT_STANDARD_MAX);
            expect(layout.railWidth).toBe(RAIL_WIDTH_COMPACT);
            expect(layout.contentColumns).toBe(2);
          } else {
            expect(layout.mode).toBe("expanded");
            expect(width).toBeGreaterThan(BREAKPOINT_STANDARD_MAX);
            expect(layout.railWidth).toBe(RAIL_WIDTH_EXPANDED);
            expect(layout.contentColumns).toBe(3);
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});
