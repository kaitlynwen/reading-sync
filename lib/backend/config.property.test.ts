// Feature: native-desktop-migration, Property 14: Backend endpoint URL validity
//
// *For any* string submitted as a Backend_Endpoint, it is accepted if and only
// if it is a syntactically valid URL using the `http` or `https` scheme;
// otherwise the value is rejected.
//
// Validates: Requirements 9.2

import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";

// config.ts imports `LazyStore` from the Tauri store plugin, which calls into
// the native shell. Stub it so the module imports cleanly in a plain Node test
// environment; `isValidEndpoint` itself is pure and never touches the store.
vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    get = vi.fn();
    set = vi.fn();
    save = vi.fn();
  },
}));

import { isValidEndpoint } from "./config";

const NUM_RUNS = 100;

/**
 * Independent oracle derived from the acceptance criterion (Req 9.2): a value is
 * valid iff it parses as a WHATWG URL whose scheme is exactly `http` or `https`.
 * Intentionally does not share code with the implementation so the property
 * checks behavior against the requirement, not against itself.
 */
function oracleIsValid(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  try {
    const { protocol } = new URL(trimmed);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

describe("Property 14: Backend endpoint URL validity", () => {
  it("accepts a value iff it is a syntactically valid http/https URL (arbitrary strings)", () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        expect(isValidEndpoint(value)).toBe(oracleIsValid(value));
      }),
      { numRuns: NUM_RUNS }
    );
  });

  it("accepts every generated http/https URL", () => {
    fc.assert(
      fc.property(
        fc.webUrl({ validSchemes: ["http", "https"] }),
        (url) => {
          expect(isValidEndpoint(url)).toBe(true);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("accepts http/https URLs even when padded with surrounding whitespace", () => {
    fc.assert(
      fc.property(
        fc.webUrl({ validSchemes: ["http", "https"] }),
        fc.stringMatching(/^[ \t\n]*$/),
        fc.stringMatching(/^[ \t\n]*$/),
        (url, lead, trail) => {
          expect(isValidEndpoint(`${lead}${url}${trail}`)).toBe(true);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("rejects URLs whose scheme is not http or https", () => {
    const otherSchemes = ["ftp", "file", "ws", "wss", "mailto", "data", "ssh"];
    fc.assert(
      fc.property(
        fc.webUrl({ validSchemes: ["http"] }),
        fc.constantFrom(...otherSchemes),
        (httpUrl, scheme) => {
          // Swap the http scheme for a disallowed one, keeping the rest intact.
          const rescheme = httpUrl.replace(/^https?:/, `${scheme}:`);
          expect(isValidEndpoint(rescheme)).toBe(false);
        }
      ),
      { numRuns: NUM_RUNS }
    );
  });

  it("rejects blank or whitespace-only strings", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[ \t\n\r]*$/), (blank) => {
        expect(isValidEndpoint(blank)).toBe(false);
      }),
      { numRuns: NUM_RUNS }
    );
  });
});
