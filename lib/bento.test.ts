// Unit + property tests for the Warm Editorial Bento geometry/token helpers
// (Req 13.1). Authoritative values: `.kiro/steering/ui-design.md` §4, §5, §10
// and the Design_Tokens in `app/globals.css`.
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  BOOK_COVER_ASPECT,
  BORDER_HAIRLINE,
  BORDER_STRONG,
  CARD_PADDING_MAX,
  CARD_PADDING_MIN,
  GRID_GAP_MAX,
  GRID_GAP_MIN,
  MONOGRAM_ACCENTS,
  RADIUS_CARD,
  RADIUS_INNER,
  RADIUS_PILL,
  SHADOW_SPINE,
  accentVar,
  initialsFromName,
  monogramAccent,
  toTrackPercent,
} from "./bento";

const RUNS = 100;

describe("bento design-token helpers (Req 13.1, steering §4)", () => {
  // Steering §12: primitives must reference Design_Tokens, never raw hex.
  it("radii/borders/gaps/padding resolve to steering Design_Tokens", () => {
    expect(RADIUS_CARD).toBe("var(--radius-card)");
    expect(RADIUS_INNER).toBe("var(--radius-inner)");
    expect(RADIUS_PILL).toBe("var(--radius-pill)");

    expect(BORDER_HAIRLINE).toBe("1px solid var(--border-subtle)");
    expect(BORDER_STRONG).toBe("1px solid var(--border-strong)");

    expect(GRID_GAP_MIN).toBe("var(--space-grid-gap-min)");
    expect(GRID_GAP_MAX).toBe("var(--space-grid-gap-max)");
    expect(CARD_PADDING_MIN).toBe("var(--space-card-padding-min)");
    expect(CARD_PADDING_MAX).toBe("var(--space-card-padding-max)");
  });

  // Steering §5: covers use a 2:3 aspect ratio and the spine shadow token.
  it("book cover geometry matches the steering (2:3 + spine shadow)", () => {
    expect(BOOK_COVER_ASPECT).toBe("2 / 3");
    expect(SHADOW_SPINE).toBe("var(--shadow-spine)");
  });

  it("accentVar maps every accent to its Design_Token variable", () => {
    expect(accentVar("peach")).toBe("var(--accent-peach)");
    expect(accentVar("sage")).toBe("var(--accent-sage)");
    expect(accentVar("lavender")).toBe("var(--accent-lavender)");
    expect(accentVar("butter")).toBe("var(--accent-butter)");
    expect(accentVar("sky")).toBe("var(--accent-sky)");
  });
});

describe("initialsFromName (steering §10)", () => {
  it("derives up to two uppercase initials from first/last words", () => {
    expect(initialsFromName("Ada Lovelace")).toBe("AL");
    expect(initialsFromName("  grace   hopper  ")).toBe("GH");
    expect(initialsFromName("Jean Luc Picard")).toBe("JP");
  });

  it("falls back to the first two characters of a single word", () => {
    expect(initialsFromName("Kaitlyn")).toBe("KA");
    expect(initialsFromName("A")).toBe("A");
  });

  it("returns empty string when there is no name content", () => {
    expect(initialsFromName("")).toBe("");
    expect(initialsFromName("   ")).toBe("");
  });

  it("never returns more than two characters for any input", () => {
    fc.assert(
      fc.property(fc.string(), (name) => {
        expect(initialsFromName(name).length).toBeLessThanOrEqual(2);
      }),
      { numRuns: RUNS },
    );
  });
});

describe("monogramAccent (steering §10 — deterministic pastel)", () => {
  it("is deterministic: same key always yields the same accent", () => {
    fc.assert(
      fc.property(fc.string(), (key) => {
        expect(monogramAccent(key)).toBe(monogramAccent(key));
      }),
      { numRuns: RUNS },
    );
  });

  it("only ever returns one of the four monogram accents", () => {
    fc.assert(
      fc.property(fc.string(), (key) => {
        expect(MONOGRAM_ACCENTS).toContain(monogramAccent(key));
      }),
      { numRuns: RUNS },
    );
  });
});

describe("toTrackPercent (steering §5 — shared progress track)", () => {
  it("maps completed/goal onto a 0–100 percent", () => {
    expect(toTrackPercent(0, 10)).toBe(0);
    expect(toTrackPercent(5, 10)).toBe(50);
    expect(toTrackPercent(10, 10)).toBe(100);
  });

  it("clamps over-goal and negative values onto the track", () => {
    expect(toTrackPercent(20, 10)).toBe(100);
    expect(toTrackPercent(-5, 10)).toBe(0);
  });

  it("returns 0 for non-positive goals and non-finite inputs", () => {
    expect(toTrackPercent(5, 0)).toBe(0);
    expect(toTrackPercent(5, -3)).toBe(0);
    expect(toTrackPercent(Number.NaN, 10)).toBe(0);
    expect(toTrackPercent(5, Number.POSITIVE_INFINITY)).toBe(0);
  });

  // Invariant: for any inputs the result is always a finite 0–100 percentage,
  // so avatars can never escape the track (steering §5, Req 13.4 geometry).
  it("always yields a value within [0, 100]", () => {
    fc.assert(
      fc.property(
        fc.double({ noNaN: false }),
        fc.double({ noNaN: false }),
        (completed, goal) => {
          const pct = toTrackPercent(completed, goal);
          expect(pct).toBeGreaterThanOrEqual(0);
          expect(pct).toBeLessThanOrEqual(100);
          expect(Number.isFinite(pct)).toBe(true);
        },
      ),
      { numRuns: RUNS },
    );
  });
});

// Feature: native-desktop-migration, Property 17: Avatar position maps to goal percentage
// Validates: Requirements 13.4
//
// A member's avatar is positioned at the horizontal point corresponding to
// their completed count `C` as a percentage of the shared goal `G`
// (`clamp(C / G, 0, 1) × 100`), clamped to 0–100%. The dashed club-target
// marker sits at the point corresponding to the shared goal (100%), and the
// avatar position is monotonically non-decreasing as `C` grows.
describe("Property 17: Avatar position maps to goal percentage (Req 13.4)", () => {
  // Finite, representable positive goals; completed counts across the whole
  // real line so clamping on both ends is exercised.
  const positiveGoal = fc.double({
    min: Number.MIN_VALUE,
    max: 1e9,
    noNaN: true,
    noDefaultInfinity: true,
  });
  const anyCompleted = fc.double({
    min: -1e9,
    max: 1e9,
    noNaN: true,
    noDefaultInfinity: true,
  });

  it("equals clamp(C / G, 0, 1) × 100 for any completed count and goal G > 0", () => {
    fc.assert(
      fc.property(anyCompleted, positiveGoal, (completed, goal) => {
        const expected = Math.min(Math.max(completed / goal, 0), 1) * 100;
        expect(toTrackPercent(completed, goal)).toBeCloseTo(expected, 9);
      }),
      { numRuns: RUNS },
    );
  });

  it("positions the dashed club-target marker at the shared goal (100%)", () => {
    fc.assert(
      fc.property(positiveGoal, (goal) => {
        // The marker — and any member who has reached the goal — maps to 100%.
        expect(toTrackPercent(goal, goal)).toBeCloseTo(100, 9);
      }),
      { numRuns: RUNS },
    );
  });

  it("is monotonically non-decreasing in the completed count", () => {
    fc.assert(
      fc.property(anyCompleted, anyCompleted, positiveGoal, (a, b, goal) => {
        const lower = Math.min(a, b);
        const higher = Math.max(a, b);
        expect(toTrackPercent(higher, goal)).toBeGreaterThanOrEqual(
          toTrackPercent(lower, goal),
        );
      }),
      { numRuns: RUNS },
    );
  });

  it("clamps completed counts outside [0, G] onto the track ends", () => {
    fc.assert(
      fc.property(positiveGoal, (goal) => {
        // Below zero pins to the start, above the goal pins to the end.
        expect(toTrackPercent(-goal, goal)).toBe(0);
        expect(toTrackPercent(goal * 2, goal)).toBe(100);
      }),
      { numRuns: RUNS },
    );
  });
});
