// lib/backend/sessionValidation.test.ts
//
// Unit tests for the reading-session validation helpers (Req 5.1–5.5). These
// cover the specific examples and edge cases the create-session screen gates
// on before any backend call. Property-based coverage of the universal rules
// lives in the Property 6–9 tests (tasks 8.5–8.8).

import { describe, expect, it } from "vitest";

import {
  PROGRESS_TYPES,
  gateCreateSession,
  isPositiveWholeNumber,
  isValidProgressType,
  parseCustomUnitLabels,
  toReadingUnits,
  usesCustomUnits,
} from "./validation";

describe("isValidProgressType (Req 5.2)", () => {
  it("accepts exactly the four allowed progress types", () => {
    expect(PROGRESS_TYPES).toEqual([
      "chapters",
      "pages",
      "milestones",
      "sections",
    ]);
    for (const type of PROGRESS_TYPES) {
      expect(isValidProgressType(type)).toBe(true);
    }
  });

  it("rejects any value outside the allowed set", () => {
    expect(isValidProgressType("")).toBe(false);
    expect(isValidProgressType("Chapters")).toBe(false);
    expect(isValidProgressType("volumes")).toBe(false);
    expect(isValidProgressType("page")).toBe(false);
  });
});

describe("usesCustomUnits", () => {
  it("is true for milestones and sections, false for chapters and pages", () => {
    expect(usesCustomUnits("milestones")).toBe(true);
    expect(usesCustomUnits("sections")).toBe(true);
    expect(usesCustomUnits("chapters")).toBe(false);
    expect(usesCustomUnits("pages")).toBe(false);
  });
});

describe("isPositiveWholeNumber (Req 5.4)", () => {
  it("accepts positive integers from string or number input", () => {
    expect(isPositiveWholeNumber("1")).toBe(true);
    expect(isPositiveWholeNumber("42")).toBe(true);
    expect(isPositiveWholeNumber(1)).toBe(true);
    expect(isPositiveWholeNumber(1000)).toBe(true);
  });

  it("rejects zero, negatives, fractions, blanks, and non-numeric text", () => {
    expect(isPositiveWholeNumber("0")).toBe(false);
    expect(isPositiveWholeNumber(0)).toBe(false);
    expect(isPositiveWholeNumber("-3")).toBe(false);
    expect(isPositiveWholeNumber("1.5")).toBe(false);
    expect(isPositiveWholeNumber(2.5)).toBe(false);
    expect(isPositiveWholeNumber("")).toBe(false);
    expect(isPositiveWholeNumber("   ")).toBe(false);
    expect(isPositiveWholeNumber("abc")).toBe(false);
    expect(isPositiveWholeNumber(Number.NaN)).toBe(false);
  });
});

describe("parseCustomUnitLabels (Req 5.3, 5.5)", () => {
  it("trims each line and drops blank lines, preserving order", () => {
    const text = "  Prologue \n\n Part I\n   \nPart II\n";
    expect(parseCustomUnitLabels(text)).toEqual([
      "Prologue",
      "Part I",
      "Part II",
    ]);
  });

  it("returns an empty array when no non-blank labels are present", () => {
    expect(parseCustomUnitLabels("")).toEqual([]);
    expect(parseCustomUnitLabels("\n   \n\t\n")).toEqual([]);
  });
});

describe("toReadingUnits (Req 5.3)", () => {
  it("assigns 1-based order_index in submitted order", () => {
    expect(toReadingUnits(["A", "B", "C"])).toEqual([
      { label: "A", order_index: 1 },
      { label: "B", order_index: 2 },
      { label: "C", order_index: 3 },
    ]);
  });

  it("maps an empty list to an empty array", () => {
    expect(toReadingUnits([])).toEqual([]);
  });
});

describe("gateCreateSession (Req 5.1–5.5)", () => {
  it("rejects a blank book title without inspecting the rest", () => {
    const result = gateCreateSession("   ", "chapters", "10", []);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/book title/i);
  });

  it("rejects a progress type outside the allowed set (Req 5.2)", () => {
    const result = gateCreateSession("Dune", "volumes", "10", []);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/progress type/i);
  });

  it("accepts chapters with a positive whole total count (Req 5.4)", () => {
    const result = gateCreateSession("Dune", "chapters", "24", []);
    expect(result.ok).toBe(true);
    expect(result.totalCount).toBe(24);
    expect(result.readingUnits).toEqual([]);
  });

  it("accepts pages with a positive whole total count (Req 5.4)", () => {
    const result = gateCreateSession("Dune", "pages", "412", []);
    expect(result.ok).toBe(true);
    expect(result.totalCount).toBe(412);
    expect(result.readingUnits).toEqual([]);
  });

  it("rejects chapters/pages with a non-positive or fractional count (Req 5.4)", () => {
    expect(gateCreateSession("Dune", "chapters", "0", []).ok).toBe(false);
    expect(gateCreateSession("Dune", "chapters", "-4", []).ok).toBe(false);
    expect(gateCreateSession("Dune", "pages", "1.5", []).ok).toBe(false);
    expect(gateCreateSession("Dune", "pages", "", []).ok).toBe(false);
  });

  it("rejects milestones/sections with no non-blank unit labels (Req 5.5)", () => {
    const milestones = gateCreateSession("Dune", "milestones", "", []);
    expect(milestones.ok).toBe(false);
    expect(milestones.message).toMatch(/milestone/i);

    const sections = gateCreateSession("Dune", "sections", "", []);
    expect(sections.ok).toBe(false);
    expect(sections.message).toMatch(/section/i);
  });

  it("accepts milestones, storing units in submitted order and counting them (Req 5.3, 5.5, 5.6)", () => {
    const result = gateCreateSession("Dune", "milestones", "", [
      "Beginning",
      "Midpoint",
      "Finale",
    ]);
    expect(result.ok).toBe(true);
    expect(result.totalCount).toBe(3);
    expect(result.readingUnits).toEqual([
      { label: "Beginning", order_index: 1 },
      { label: "Midpoint", order_index: 2 },
      { label: "Finale", order_index: 3 },
    ]);
  });

  it("ignores the numeric total for custom-unit types", () => {
    const result = gateCreateSession("Dune", "sections", "999", [
      "Prologue",
      "Epilogue",
    ]);
    expect(result.ok).toBe(true);
    expect(result.totalCount).toBe(2);
  });
});
