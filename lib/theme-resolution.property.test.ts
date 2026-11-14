// Feature: native-desktop-migration, Property 15: Theme-preference resolution
//
// *For any* persisted theme-preference value, the resolved preference equals
// that value if it is one of `light`, `dark`, or `system`, and equals `system`
// when the value is missing or outside that set (Req 14.9, 14.10). Once
// resolved, a valid preference maps to a concrete applied theme: `light`/`dark`
// resolve to themselves regardless of the OS scheme, and `system` follows the
// OS color scheme (dark when the OS prefers dark, light otherwise).
//
// Validates: Requirements 14.9, 14.10
//
// Two layers cooperate to satisfy the property, so both are exercised here:
//   1. `lib/backend/config.ts` normalizes the *persisted* value into a valid
//      `ThemePreference`, defaulting missing/invalid values to `system`
//      (Req 14.9, 14.10). The normalizer is internal, so it is driven through
//      `loadConfig()` with the Tauri store mocked to return arbitrary raw
//      values.
//   2. `lib/theme.ts#resolveTheme` maps a (valid) preference + OS scheme to the
//      concrete `light`/`dark` theme that is applied. It is pure, so it is
//      tested directly.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";

const NUM_RUNS = 100;

const VALID_PREFERENCES = ["light", "dark", "system"] as const;
type ValidPreference = (typeof VALID_PREFERENCES)[number];

// ---------------------------------------------------------------------------
// Mock the Tauri persistent store so `loadConfig` reads whatever raw value the
// property generates for the theme-preference key. The backend-endpoint key is
// left unset (returns undefined) since this property only concerns the theme.
// ---------------------------------------------------------------------------

/** The raw value the mocked store returns for the theme-preference key. */
let storedTheme: unknown;

vi.mock("@tauri-apps/plugin-store", () => {
  class LazyStore {
    async get<T>(key: string): Promise<T | undefined> {
      if (key === "themePreference") {
        return storedTheme as T;
      }
      // backendEndpoint (and anything else) is absent in these runs.
      return undefined;
    }
    async set(): Promise<void> {}
    async save(): Promise<void> {}
  }
  return { LazyStore };
});

import { loadConfig, type ThemePreference } from "@/lib/backend/config";
import { resolveTheme } from "@/lib/theme";

beforeEach(() => {
  storedTheme = undefined;
});

afterEach(() => {
  vi.clearAllMocks();
});

// Arbitrary "raw persisted value": a mix of the three valid preferences and a
// wide range of invalid values (wrong strings, wrong types, null/undefined,
// objects) so the default-to-system branch is thoroughly exercised.
const rawPersistedValueArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constantFrom<ValidPreference>(...VALID_PREFERENCES),
  fc.string(),
  fc.constant(undefined),
  fc.constant(null),
  fc.integer(),
  fc.boolean(),
  fc.constantFrom("Light", "DARK", "System", "", "auto", "SYSTEM"),
  fc.object(),
);

function isValidPreference(value: unknown): value is ValidPreference {
  return (
    typeof value === "string" &&
    (VALID_PREFERENCES as readonly string[]).includes(value)
  );
}

describe("Property 15: Theme-preference resolution", () => {
  // --- Layer 1: persisted-value normalization (Req 14.9, 14.10) ------------

  it("resolves a persisted value to itself when valid, else to system", async () => {
    await fc.assert(
      fc.asyncProperty(rawPersistedValueArb, async (raw) => {
        storedTheme = raw;

        const { themePreference } = await loadConfig();

        if (isValidPreference(raw)) {
          // A valid persisted preference resolves to that same value (Req 14.8).
          expect(themePreference).toBe(raw);
        } else {
          // Missing or out-of-set values default to system (Req 14.9, 14.10).
          expect(themePreference).toBe("system");
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("always resolves to one of {light, dark, system}", async () => {
    await fc.assert(
      fc.asyncProperty(rawPersistedValueArb, async (raw) => {
        storedTheme = raw;

        const { themePreference } = await loadConfig();

        expect(VALID_PREFERENCES).toContain(themePreference);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // --- Layer 2: preference -> applied theme (resolveTheme) -----------------

  it("maps light/dark to themselves regardless of the OS scheme", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<ThemePreference>("light", "dark"),
        fc.boolean(),
        (preference, osPrefersDark) => {
          expect(resolveTheme(preference, osPrefersDark)).toBe(preference);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("resolves system to the OS color scheme", () => {
    fc.assert(
      fc.property(fc.boolean(), (osPrefersDark) => {
        expect(resolveTheme("system", osPrefersDark)).toBe(
          osPrefersDark ? "dark" : "light",
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("always applies a concrete light or dark theme for any valid preference", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<ThemePreference>(...VALID_PREFERENCES),
        fc.boolean(),
        (preference, osPrefersDark) => {
          expect(["light", "dark"]).toContain(
            resolveTheme(preference, osPrefersDark),
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
