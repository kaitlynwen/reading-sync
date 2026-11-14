// Feature: native-desktop-migration, Property 11: Notification content completeness
//
// *For any* notification event, the content that buildNotificationContent
// produces carries the identifying information the event requires:
//
//   - A weekly_goal notification identifies the Member who reached the goal and
//     the goal amount they reached (Req 8.3).
//   - A group_ready notification identifies the book title and the next unit the
//     Group is ready for (Req 8.4).
//
// `buildNotificationContent` is pure (no OS I/O), so completeness is checked
// directly across many generated inputs without mocking the native plugin.
//
// Validates: Requirements 8.3, 8.4

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { buildNotificationContent, type NotifEvent } from "./service";

const NUM_RUNS = 100;

/**
 * Non-empty text for the identifying fields. The field values must survive
 * into the rendered body verbatim, so the generator avoids the empty string
 * (which carries no identifying information and would make `toContain` trivially
 * pass) while still covering unicode, whitespace, and punctuation.
 */
const fieldArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 60 })
  .filter((s) => s.trim().length > 0);

const weeklyGoalArb: fc.Arbitrary<Extract<NotifEvent, { kind: "weekly_goal" }>> =
  fc.record({
    kind: fc.constant("weekly_goal" as const),
    member: fieldArb,
    goalLabel: fieldArb,
  });

const groupReadyArb: fc.Arbitrary<Extract<NotifEvent, { kind: "group_ready" }>> =
  fc.record({
    kind: fc.constant("group_ready" as const),
    bookTitle: fieldArb,
    nextUnitLabel: fieldArb,
  });

describe("Property 11: Notification content completeness", () => {
  it("a weekly_goal notification identifies the member and the goal amount (Req 8.3)", () => {
    fc.assert(
      fc.property(weeklyGoalArb, (event) => {
        const content = buildNotificationContent(event);

        // The notification must carry a non-empty heading and body.
        expect(content.title.length).toBeGreaterThan(0);
        expect(content.body.length).toBeGreaterThan(0);

        // The body must identify both the member who reached the goal and the
        // goal amount reached (Req 8.3).
        expect(content.body).toContain(event.member);
        expect(content.body).toContain(event.goalLabel);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("a group_ready notification identifies the book title and the next unit (Req 8.4)", () => {
    fc.assert(
      fc.property(groupReadyArb, (event) => {
        const content = buildNotificationContent(event);

        expect(content.title.length).toBeGreaterThan(0);
        expect(content.body.length).toBeGreaterThan(0);

        // The body must identify both the book title and the next unit the
        // group is ready for (Req 8.4).
        expect(content.body).toContain(event.bookTitle);
        expect(content.body).toContain(event.nextUnitLabel);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("produces complete content for any event kind (Req 8.3, 8.4)", () => {
    // Mixes both event shapes in one run so the union is exercised end to end:
    // whichever kind is generated, every identifying field survives into the
    // body.
    fc.assert(
      fc.property(
        fc.oneof(weeklyGoalArb, groupReadyArb),
        (event) => {
          const { body } = buildNotificationContent(event);
          const identifiers =
            event.kind === "weekly_goal"
              ? [event.member, event.goalLabel]
              : [event.bookTitle, event.nextUnitLabel];

          for (const id of identifiers) {
            expect(body).toContain(id);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
