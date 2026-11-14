// Feature: native-desktop-migration, Property 9: Custom unit order is preserved
//
// *For any* submitted ordered list of (non-blank) custom unit labels, storing
// them as the session's reading units and reading them back yields units whose
// `order_index` sequence reproduces the submitted order exactly: the labels
// appear in the same relative order, and the `order_index` values increase in
// that order (1-based, strictly ascending, one per label).
//
// This exercises the `parseCustomUnitLabels` -> `toReadingUnits` pipeline from
// lib/backend/validation.ts (task 8.2), which is how the create-session flow
// turns the raw textarea entry into the ordered `reading_units` array stored on
// the session (design.md: "stores custom units preserving order (5.3)").
//
// Validates: Requirements 5.3

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  gateCreateSession,
  parseCustomUnitLabels,
  toReadingUnits,
} from "./validation";

const NUM_RUNS = 100;

/**
 * A single non-blank unit label: has at least one non-whitespace character, so
 * it survives `parseCustomUnitLabels`' blank-line filter. Newlines are excluded
 * because the raw-text generator joins labels on "\n", so a label containing a
 * newline would be split into two labels and break the correspondence the
 * property reasons about.
 */
const nonBlankLabel = fc
  .string({ minLength: 1 })
  .filter((s) => s.trim().length > 0 && !s.includes("\n"));

/** An ordered, non-empty list of non-blank labels in submitted order. */
const labelList = fc.array(nonBlankLabel, { minLength: 1, maxLength: 25 });

describe("Property 9: Custom unit order is preserved", () => {
  it("toReadingUnits reproduces the submitted order with strictly ascending 1-based order_index", () => {
    fc.assert(
      fc.property(labelList, (labels) => {
        const units = toReadingUnits(labels);

        // One unit per submitted label, nothing dropped or added.
        expect(units).toHaveLength(labels.length);

        // Labels appear in the exact submitted order.
        expect(units.map((u) => u.label)).toEqual(labels);

        // order_index is 1-based and strictly ascending in submission order,
        // so the index sequence *is* the submission order (Req 5.3).
        expect(units.map((u) => u.order_index)).toEqual(
          labels.map((_, i) => i + 1),
        );

        // Sorting by order_index recovers the submitted label order exactly:
        // the stored ordering is fully determined by order_index.
        const bySortedIndex = [...units]
          .sort((a, b) => a.order_index - b.order_index)
          .map((u) => u.label);
        expect(bySortedIndex).toEqual(labels);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("order is preserved across the full parse -> store pipeline (raw textarea text in, ordered units out)", () => {
    fc.assert(
      fc.property(labelList, (labels) => {
        // Reconstruct the raw textarea entry (one label per line) and run it
        // through the same pipeline the create-session screen uses.
        const rawText = labels.join("\n");
        const parsed = parseCustomUnitLabels(rawText);

        // Parsing keeps the labels (trimmed) in their submitted order.
        expect(parsed).toEqual(labels.map((l) => l.trim()));

        const units = toReadingUnits(parsed);
        expect(units.map((u) => u.label)).toEqual(parsed);
        expect(units.map((u) => u.order_index)).toEqual(
          parsed.map((_, i) => i + 1),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("blank lines interspersed in the raw text do not disturb the order of the surviving labels", () => {
    const blankLine = fc.constantFrom("", "   ", "\t", "  \t ");
    fc.assert(
      fc.property(labelList, fc.array(blankLine), (labels, blanks) => {
        // Interleave blank lines arbitrarily among the real labels, then parse.
        const mixed: string[] = [];
        const maxLen = Math.max(labels.length, blanks.length);
        for (let i = 0; i < maxLen; i++) {
          if (i < blanks.length) mixed.push(blanks[i]);
          if (i < labels.length) mixed.push(labels[i]);
        }
        const parsed = parseCustomUnitLabels(mixed.join("\n"));

        // Only the non-blank labels survive, in their original relative order.
        expect(parsed).toEqual(labels.map((l) => l.trim()));

        const units = toReadingUnits(parsed);
        expect(units.map((u) => u.order_index)).toEqual(
          parsed.map((_, i) => i + 1),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("a milestones/sections session stores reading_units preserving the submitted order end to end", () => {
    const validBookTitle = fc
      .string({ minLength: 1 })
      .filter((s) => s.trim().length > 0);
    const customType = fc.constantFrom("milestones", "sections");

    fc.assert(
      fc.property(
        validBookTitle,
        customType,
        labelList,
        (title, progressType, labels) => {
          const result = gateCreateSession(title, progressType, "", labels);

          expect(result.ok).toBe(true);
          // The accepted session's reading_units preserve submitted order with
          // strictly ascending 1-based order_index (Req 5.3).
          expect(result.readingUnits.map((u) => u.label)).toEqual(labels);
          expect(result.readingUnits.map((u) => u.order_index)).toEqual(
            labels.map((_, i) => i + 1),
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
