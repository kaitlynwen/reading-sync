// Feature: native-desktop-migration, Property 16: Platform titlebar safe-area mapping
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { PlatformId } from "./platform";
import {
  MACOS_SAFE_AREA_LEFT,
  WINDOWS_SAFE_AREA_RIGHT,
  resolveTitlebarSafeArea,
} from "./titlebar";

const RUNS = 100;

describe("resolveTitlebarSafeArea (Property 16: Platform titlebar safe-area mapping)", () => {
  // Validates: Requirements 15.1 — macOS reserves exactly 76px left padding.
  it("returns 76px left padding (and no other) on darwin", () => {
    const safeArea = resolveTitlebarSafeArea("darwin");
    expect(safeArea).toEqual({
      left: MACOS_SAFE_AREA_LEFT,
      right: 0,
      top: 0,
      bottom: 0,
    });
    expect(safeArea.left).toBe(76);
  });

  // Validates: Requirements 15.2 — Windows reserves exactly 136px right padding.
  it("returns 136px right padding (and no other) on win32", () => {
    const safeArea = resolveTitlebarSafeArea("win32");
    expect(safeArea).toEqual({
      left: 0,
      right: WINDOWS_SAFE_AREA_RIGHT,
      top: 0,
      bottom: 0,
    });
    expect(safeArea.right).toBe(136);
  });

  // Validates: Requirements 15.3 — every other platform reserves 0px on all edges.
  it("returns zero padding on linux and unknown", () => {
    for (const platform of ["linux", "unknown"] as PlatformId[]) {
      expect(resolveTitlebarSafeArea(platform)).toEqual({
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
      });
    }
  });

  // Validates: Requirements 15.1, 15.2, 15.3 — the mapping holds for ANY
  // platform identifier: 76px left on darwin, 136px right on win32, 0 elsewhere.
  it("maps any platform identifier to the correct safe area", () => {
    // Known canonical identifiers plus arbitrary strings standing in for any
    // other ("elsewhere") platform the detector could ever surface.
    const platformArb: fc.Arbitrary<PlatformId | string> = fc.oneof(
      fc.constantFrom<PlatformId>("darwin", "win32", "linux", "unknown"),
      fc.string(),
    );

    fc.assert(
      fc.property(platformArb, (platform) => {
        const safeArea = resolveTitlebarSafeArea(platform as PlatformId);

        if (platform === "darwin") {
          expect(safeArea).toEqual({ left: 76, right: 0, top: 0, bottom: 0 });
        } else if (platform === "win32") {
          expect(safeArea).toEqual({ left: 0, right: 136, top: 0, bottom: 0 });
        } else {
          // 0px on every edge for every other platform identifier.
          expect(safeArea).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
        }
      }),
      { numRuns: RUNS },
    );
  });
});
