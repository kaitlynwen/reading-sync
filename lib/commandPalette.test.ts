// Unit + invariant tests for the pure command-palette helpers (task 14.5;
// steering §6 — Cmd/Ctrl+K "jump between book clubs, books, or log progress").
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  buildCommands,
  filterCommands,
  isPaletteToggle,
  matchesQuery,
  normalizeForMatch,
  type PaletteGroup,
} from "./commandPalette";

const RUNS = 100;

/* -------------------------------------------------------------------------- */
/* isPaletteToggle — the Cmd/Ctrl+K accelerator (steering §6)                 */
/* -------------------------------------------------------------------------- */

describe("isPaletteToggle", () => {
  it("matches Cmd+K (macOS) and Ctrl+K (Windows/Linux), case-insensitively", () => {
    expect(isPaletteToggle({ key: "k", metaKey: true, ctrlKey: false })).toBe(true);
    expect(isPaletteToggle({ key: "K", metaKey: true, ctrlKey: false })).toBe(true);
    expect(isPaletteToggle({ key: "k", metaKey: false, ctrlKey: true })).toBe(true);
    expect(isPaletteToggle({ key: "K", metaKey: false, ctrlKey: true })).toBe(true);
  });

  it("does not match a bare K, or a modifier with a different key", () => {
    expect(isPaletteToggle({ key: "k", metaKey: false, ctrlKey: false })).toBe(false);
    expect(isPaletteToggle({ key: "j", metaKey: true, ctrlKey: false })).toBe(false);
    expect(isPaletteToggle({ key: "p", metaKey: false, ctrlKey: true })).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* matching                                                                   */
/* -------------------------------------------------------------------------- */

describe("normalizeForMatch / matchesQuery", () => {
  it("is case- and diacritic-insensitive", () => {
    expect(normalizeForMatch("  Café  ")).toBe("cafe");
    expect(matchesQuery("The Night Café", "cafe")).toBe(true);
    expect(matchesQuery("The Night Café", "NIGHT")).toBe(true);
  });

  it("matches order-independent subword tokens, and an empty query matches all", () => {
    expect(matchesQuery("Dune by Frank Herbert", "herbert dune")).toBe(true);
    expect(matchesQuery("Dune", "")).toBe(true);
    expect(matchesQuery("Dune", "   ")).toBe(true);
    expect(matchesQuery("Dune", "xyz")).toBe(false);
  });

  // Invariant: an empty/whitespace query always matches (palette shows all).
  it("empty query always matches (property)", () => {
    fc.assert(
      fc.property(fc.string(), fc.constantFrom("", " ", "\t", "  "), (hay, q) =>
        matchesQuery(hay, q),
      ),
      { numRuns: RUNS },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* buildCommands                                                              */
/* -------------------------------------------------------------------------- */

const GROUPS: PaletteGroup[] = [
  { groupId: "g1", name: "Night Owls", activeBookTitle: "Dune" },
  { groupId: "g2", name: "Morning Pages", activeBookTitle: null },
];

describe("buildCommands", () => {
  it("emits a club + log-progress entry per group, and a book entry only when a book is active", () => {
    const commands = buildCommands(GROUPS);

    // g1 (with book): club + progress + book; g2 (no book): club + progress.
    expect(commands.filter((c) => c.kind === "club")).toHaveLength(2);
    expect(commands.filter((c) => c.kind === "progress")).toHaveLength(2);
    expect(commands.filter((c) => c.kind === "book")).toHaveLength(1);

    const book = commands.find((c) => c.kind === "book")!;
    expect(book.title).toBe("Dune");
    expect(book.subtitle).toBe("Night Owls");
    expect(book.href).toBe("/group/g1");
  });

  it("orders clubs first, then log-progress, then books", () => {
    const kinds = buildCommands(GROUPS).map((c) => c.kind);
    const firstBook = kinds.indexOf("book");
    const lastClub = kinds.lastIndexOf("club");
    const lastProgress = kinds.lastIndexOf("progress");
    expect(lastClub).toBeLessThan(kinds.indexOf("progress"));
    expect(lastProgress).toBeLessThan(firstBook);
  });

  it("every command deep-links to its group's Reading Room", () => {
    for (const command of buildCommands(GROUPS)) {
      expect(command.href).toMatch(/^\/group\/(g1|g2)$/);
    }
  });

  it("treats a blank/whitespace book title as no active book", () => {
    const commands = buildCommands([
      { groupId: "g3", name: "Quiet Shelf", activeBookTitle: "   " },
    ]);
    expect(commands.some((c) => c.kind === "book")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* filterCommands                                                             */
/* -------------------------------------------------------------------------- */

describe("filterCommands", () => {
  const commands = buildCommands(GROUPS);

  it("returns the full list for an empty query, preserving order", () => {
    expect(filterCommands(commands, "")).toEqual(commands);
  });

  it("matches on title, subtitle, and hidden keywords", () => {
    // Title match (book title "Dune").
    expect(filterCommands(commands, "dune").map((c) => c.id)).toContain("book:g1");
    // Subtitle match (book's club name).
    expect(filterCommands(commands, "night").some((c) => c.kind === "book")).toBe(true);
    // Keyword match ("log progress" keywords include "update").
    expect(filterCommands(commands, "update").every((c) => c.kind === "progress")).toBe(
      true,
    );
  });

  it("narrows to a single group when its name is queried", () => {
    const results = filterCommands(commands, "morning");
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((c) => c.href === "/group/g2")).toBe(true);
  });

  // Invariant: filtering never invents or reorders commands — it is a
  // subsequence of the input in the same order.
  it("is an order-preserving subset of the input (property)", () => {
    fc.assert(
      fc.property(fc.string(), (query) => {
        const filtered = filterCommands(commands, query);
        const indices = filtered.map((c) => commands.indexOf(c));
        // Strictly increasing indices => same order, no duplicates/inventions.
        for (let i = 1; i < indices.length; i++) {
          expect(indices[i]).toBeGreaterThan(indices[i - 1]);
        }
        expect(filtered.length).toBeLessThanOrEqual(commands.length);
      }),
      { numRuns: RUNS },
    );
  });
});
