// Feature: native-desktop-migration, Property 8: Session unit-label validity
//
// *For any* submitted list of custom unit labels when the progress type is
// `milestones` or `sections`, the session is accepted if and only if the list
// contains at least one non-blank label; otherwise it is rejected with an
// at-least-one-label validation message and no session is created.
//
// Validates: Requirements 5.5

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  gateCreateSession,
  parseCustomUnitLabels,
  toReadingUnits,
} from "./validation";

const NUM_RUNS = 100;

// The two custom-unit progress types this property is scoped to (Req 5.3, 5.5).
const customProgressType = fc.constantFrom("milestones", "sections");

// A book title that passes the earlier title gate so validation reaches the
// unit-label check (non-blank after trimming).
const validBookTitle = fc
  .string({ minLength: 1 })
  .filter((s) => s.trim().length > 0);

// Characters that count as "blank" to String.prototype.trim (spaces, tabs,
// newlines, and other Unicode whitespace handled by trim()).
const blankChars = fc.constantFrom(" ", "\t", "\u00a0", "\u2003", "\r");

// A line that is blank: zero or more whitespace characters only. Note it never
// contains a newline so a single generated line stays a single textarea line.
const blankLine = fc
  .array(blankChars, { maxLength: 6 })
  .map((chars) => chars.join(""));

// A line that contains at least one non-whitespace character, i.e. a non-blank
// label once trimmed. Excludes newlines so one line stays one line.
const nonBlankLine = fc
  .string({ minLength: 1 })
  .filter((s) => s.trim().length > 0 && !s.includes("\n"));

/**
 * Independent oracle derived straight from the acceptance criterion (Req 5.5):
 * the labels are acceptable iff at least one is non-blank after trimming.
 * Deliberately shares no logic with the implementation so the property checks
 * behavior against the requirement rather than against itself.
 */
function oracleHasNonBlankLabel(labels: string[]): boolean {
  return labels.some((label) => label.trim().length > 0);
}

describe("Property 8: Session unit-label validity", () => {
  it("accepts milestones/sections sessions when at least one non-blank label is provided", () => {
    fc.assert(
      fc.property(
        validBookTitle,
        customProgressType,
        // At least one non-blank line, plus arbitrary extra blank/non-blank lines.
        fc.tuple(
          nonBlankLine,
          fc.array(fc.oneof(blankLine, nonBlankLine), { maxLength: 8 }),
        ),
        (title, progressType, [guaranteed, extras]) => {
          const lines = [...extras];
          // Insert the guaranteed non-blank line at an arbitrary-ish position.
          lines.splice(Math.floor(lines.length / 2), 0, guaranteed);
          const text = lines.join("\n");

          const labels = parseCustomUnitLabels(text);
          // Sanity: parsing dropped all blank lines, leaving only real labels.
          expect(labels.length).toBeGreaterThanOrEqual(1);
          expect(oracleHasNonBlankLabel(labels)).toBe(true);

          const result = gateCreateSession(title, progressType, "", labels);
          expect(result.ok).toBe(true);
          expect(result.message).toBe("");
          // The ceiling count is the number of non-blank labels (Req 5.6).
          expect(result.totalCount).toBe(labels.length);
          // Stored units preserve the parsed labels in order (Req 5.3).
          expect(result.readingUnits).toEqual(toReadingUnits(labels));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects milestones/sections sessions when no non-blank label is provided, with an at-least-one message and no session", () => {
    fc.assert(
      fc.property(
        validBookTitle,
        customProgressType,
        // Only blank lines (possibly none) — nothing survives parsing.
        fc.array(blankLine, { maxLength: 8 }),
        (title, progressType, blankLines) => {
          const text = blankLines.join("\n");

          const labels = parseCustomUnitLabels(text);
          // Sanity: no non-blank label survived (Req 5.5 reject branch).
          expect(labels).toEqual([]);
          expect(oracleHasNonBlankLabel(labels)).toBe(false);

          const result = gateCreateSession(title, progressType, "", labels);
          expect(result.ok).toBe(false);
          // Message indicates at least one unit label is required (Req 5.5).
          expect(result.message).toMatch(/at least one/i);
          // No session configuration is produced on rejection (Req 5.5).
          expect(result.totalCount).toBe(0);
          expect(result.readingUnits).toEqual([]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("decides acceptance iff the parsed labels contain a non-blank entry (full raw-text pipeline)", () => {
    // Arbitrary raw textarea content: a mix of blank and non-blank lines joined
    // by newlines, covering both branches from the same generator.
    const rawText = fc
      .array(fc.oneof(blankLine, nonBlankLine), { maxLength: 10 })
      .map((lines) => lines.join("\n"));

    fc.assert(
      fc.property(validBookTitle, customProgressType, rawText, (title, progressType, text) => {
        const labels = parseCustomUnitLabels(text);
        const result = gateCreateSession(title, progressType, "", labels);

        // Acceptance holds exactly when a non-blank label exists (Req 5.5).
        expect(result.ok).toBe(oracleHasNonBlankLabel(labels));

        if (result.ok) {
          expect(result.totalCount).toBe(labels.length);
          expect(result.readingUnits).toEqual(toReadingUnits(labels));
        } else {
          expect(result.message).toMatch(/at least one/i);
          expect(result.totalCount).toBe(0);
          expect(result.readingUnits).toEqual([]);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
