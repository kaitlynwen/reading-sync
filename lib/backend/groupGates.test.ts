// Unit tests for the create-group and join-group client-side gates.
//
// These gates are the single decision point for whether the create-group
// (Req 4.4) and join-group (Req 4.7) screens may submit to the
// PocketBase_Backend. They enforce that required names are non-empty after
// trimming surrounding whitespace, mirroring the auth gates in validation.ts.

import { describe, expect, it } from "vitest";

import { gateCreateGroup, gateJoinGroup } from "./validation";

describe("gateCreateGroup (Req 4.4)", () => {
  it("allows submission when the group name and display name are both non-empty", () => {
    const gate = gateCreateGroup("Book Club", "Kaitlyn");
    expect(gate.ok).toBe(true);
    expect(gate.message).toBe("");
  });

  it("allows submission when names have surrounding whitespace but non-empty cores", () => {
    const gate = gateCreateGroup("  Book Club  ", "  Kaitlyn  ");
    expect(gate.ok).toBe(true);
  });

  it("blocks submission when the group name is empty", () => {
    const gate = gateCreateGroup("", "Kaitlyn");
    expect(gate.ok).toBe(false);
    expect(gate.message).not.toBe("");
  });

  it("blocks submission when the group name is only whitespace", () => {
    const gate = gateCreateGroup("   ", "Kaitlyn");
    expect(gate.ok).toBe(false);
  });

  it("blocks submission when the display name is empty", () => {
    const gate = gateCreateGroup("Book Club", "");
    expect(gate.ok).toBe(false);
  });

  it("blocks submission when the display name is only whitespace", () => {
    const gate = gateCreateGroup("Book Club", "   ");
    expect(gate.ok).toBe(false);
  });

  it("blocks submission when both fields are empty", () => {
    const gate = gateCreateGroup("", "");
    expect(gate.ok).toBe(false);
  });
});

describe("gateJoinGroup (Req 4.7)", () => {
  it("allows submission when the invite code and display name are both non-empty", () => {
    const gate = gateJoinGroup("ABC123", "Kaitlyn");
    expect(gate.ok).toBe(true);
    expect(gate.message).toBe("");
  });

  it("allows submission when fields have surrounding whitespace but non-empty cores", () => {
    const gate = gateJoinGroup("  ABC123  ", "  Kaitlyn  ");
    expect(gate.ok).toBe(true);
  });

  it("blocks submission when the invite code is empty", () => {
    const gate = gateJoinGroup("", "Kaitlyn");
    expect(gate.ok).toBe(false);
    expect(gate.message).not.toBe("");
  });

  it("blocks submission when the invite code is only whitespace", () => {
    const gate = gateJoinGroup("   ", "Kaitlyn");
    expect(gate.ok).toBe(false);
  });

  it("blocks submission when the display name is empty", () => {
    const gate = gateJoinGroup("ABC123", "");
    expect(gate.ok).toBe(false);
  });

  it("blocks submission when the display name is only whitespace", () => {
    const gate = gateJoinGroup("ABC123", "   ");
    expect(gate.ok).toBe(false);
  });
});
