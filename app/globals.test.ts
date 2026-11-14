import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Unit tests for the single shared Warm Editorial Bento token stylesheet.
 *
 * Authoritative source of all expected values: `.kiro/steering/ui-design.md`.
 * These tests assert (Req 12.1, 12.2, 12.5, 12.6, 12.4):
 *   - every steering-named semantic token is declared exactly once in `:root`
 *     with the exact light-theme value;
 *   - every such token has a matching `[data-theme="dark"]` declaration with
 *     the exact dark-theme value;
 *   - the ad-hoc `--background` / `--foreground` variables are absent entirely;
 *   - `font-variant-numeric: tabular-nums` is applied to numeric UI elements.
 */

const here = dirname(fileURLToPath(import.meta.url));
const rawCss = readFileSync(join(here, "globals.css"), "utf8");

/**
 * Strip `/* ... *\/` comments before parsing so selector text appearing inside
 * documentation comments (e.g. the header explaining `[data-theme="dark"]`)
 * does not get mistaken for an actual rule block.
 */
const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, "");

/** Expected light-theme values, verbatim from ui-design.md §2. */
const LIGHT_TOKENS: Record<string, string> = {
  // Surfaces & Backgrounds
  "--bg-app": "#faf7f2",
  "--bg-surface": "#ffffff",
  "--bg-surface-muted": "#f3efe6",
  "--bg-rail": "#1c1b20",
  // Pastel Bento Accents
  "--accent-peach": "#fadcd9",
  "--accent-sage": "#dcece3",
  "--accent-lavender": "#e5dff5",
  "--accent-butter": "#f9eccb",
  "--accent-sky": "#dcebf7",
  // Typography & Borders
  "--text-primary": "#1c1b20",
  "--text-secondary": "#5e5b66",
  "--text-on-dark": "#faf7f2",
  "--border-subtle": "rgba(28, 27, 32, 0.08)",
  "--border-strong": "rgba(28, 27, 32, 0.18)",
};

/** Expected dark "Cozy Nightstand" values, verbatim from ui-design.md §7. */
const DARK_TOKENS: Record<string, string> = {
  // Dark Surfaces & Backgrounds
  "--bg-app": "#151418",
  "--bg-surface": "#1e1d23",
  "--bg-surface-muted": "#27252e",
  "--bg-rail": "#100f13",
  // Muted Pastel Bento Accents (Dark Mode)
  "--accent-peach": "#3d2829",
  "--accent-sage": "#22332b",
  "--accent-lavender": "#2c273d",
  "--accent-butter": "#38301e",
  "--accent-sky": "#21303d",
  // Dark Typography & Borders
  "--text-primary": "#f4efe6",
  "--text-secondary": "#a6a0ad",
  "--text-on-accent": "#f8f4ec",
  "--border-subtle": "rgba(244, 239, 230, 0.08)",
  "--border-strong": "rgba(244, 239, 230, 0.18)",
};

/**
 * Extract a top-level rule block body by selector. Returns the text between the
 * selector's opening `{` and its matching closing `}`, tracking brace depth so
 * nested at-rules do not terminate the block early.
 */
function extractBlock(source: string, selector: string): string {
  const selIndex = source.indexOf(selector);
  expect(selIndex, `selector "${selector}" should exist in globals.css`).toBeGreaterThanOrEqual(0);
  const braceStart = source.indexOf("{", selIndex + selector.length);
  expect(braceStart, `selector "${selector}" should open a block`).toBeGreaterThanOrEqual(0);

  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(braceStart + 1, i);
    }
  }
  throw new Error(`Unbalanced braces for selector "${selector}"`);
}

/** Count declarations of `name` (as a custom-property declaration) in a block. */
function countDeclarations(block: string, name: string): number {
  // Match `--name:` at a declaration position, not as a `var(--name)` reference.
  const re = new RegExp(`(^|[;{\\s])${name.replace(/[-]/g, "\\-")}\\s*:`, "g");
  return (block.match(re) ?? []).length;
}

/** Read the declared value of `name` within a block (first declaration), normalized. */
function readValue(block: string, name: string): string {
  const re = new RegExp(`(?:^|[;{\\s])${name.replace(/[-]/g, "\\-")}\\s*:\\s*([^;]+);`);
  const m = block.match(re);
  expect(m, `token "${name}" should be declared`).not.toBeNull();
  return m![1].trim().toLowerCase();
}

const rootBlock = extractBlock(css, ":root");
const darkBlock = extractBlock(css, '[data-theme="dark"]');

describe("globals.css light-theme tokens (:root)", () => {
  for (const [name, value] of Object.entries(LIGHT_TOKENS)) {
    it(`declares ${name} exactly once with the exact light value`, () => {
      expect(countDeclarations(rootBlock, name)).toBe(1);
      expect(readValue(rootBlock, name)).toBe(value);
    });
  }
});

describe("globals.css dark-theme tokens ([data-theme=\"dark\"])", () => {
  for (const [name, value] of Object.entries(DARK_TOKENS)) {
    it(`declares ${name} exactly once with the exact dark value`, () => {
      expect(countDeclarations(darkBlock, name)).toBe(1);
      expect(readValue(darkBlock, name)).toBe(value);
    });
  }
});

describe("globals.css token hygiene (Req 12.5, 12.6)", () => {
  it("declares no semantic token more than once across :root and the dark block", () => {
    // Each color token appears once in :root and (where themed) once in dark.
    // No token may be declared twice within the same block.
    for (const name of Object.keys(LIGHT_TOKENS)) {
      expect(countDeclarations(rootBlock, name)).toBe(1);
    }
    for (const name of Object.keys(DARK_TOKENS)) {
      expect(countDeclarations(darkBlock, name)).toBe(1);
    }
  });

  it("does not declare the ad-hoc --background or --foreground variables anywhere", () => {
    // Guard against declarations (`--background:`), allowing none at all.
    expect(/--background\s*:/.test(css)).toBe(false);
    expect(/--foreground\s*:/.test(css)).toBe(false);
  });
});

describe("globals.css tabular numerals (Req 12.4)", () => {
  it("applies font-variant-numeric: tabular-nums to numeric UI elements", () => {
    // Normalize whitespace to tolerate formatting.
    const normalized = css.replace(/\s+/g, " ");
    expect(normalized).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });
});
