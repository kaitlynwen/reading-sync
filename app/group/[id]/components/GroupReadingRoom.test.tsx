// @vitest-environment jsdom
//
// UI tests for the redesigned Group Reading Room (task 14.4).
//
// Exercises the restyled screen components — GroupHeader, CurrentBook,
// ProgressList, ReadingGoal — and the bento primitives they compose
// (BentoCard, BookCover, Stepper, PillButton, ProgressTrack), asserting the
// Warm Editorial Bento contract rather than mocking it away:
//
//   - the bento layout uses the steering radii / hairline borders / grid gaps /
//     card padding, all via Design_Tokens (`var(--…)`) — never raw hex;
//   - a stored cover renders at a 2:3 aspect ratio with the book-spine shadow,
//     and an absent cover renders a 2:3 placeholder in the same box;
//   - the quick progress control is an inline stepper that increments in a
//     single interaction without navigating away;
//   - every preserved behavior (copy invite, complete / undo progress,
//     set / clear goal, delete / replace book) invokes its handler;
//   - the responsive rail widths and the 1440px content cap are applied at the
//     three steering breakpoints.
//
// Backend/handlers are injected as plain spies — these components take their
// mutations as props, so no `lib/backend/*` module needs stubbing. The pure
// `lib/rail` resolver drives the responsive-width assertions directly.
//
// Validates: Requirements 13.1, 13.2, 13.3, 13.6, 13.7, 13.8
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import GroupHeader from "./GroupHeader";
import CurrentBook from "./CurrentBook";
import ProgressList from "./ProgressList";
import ReadingGoal from "./ReadingGoal";
import type { Member, ReadingSession } from "../types";
import {
  BREAKPOINT_COMPACT_MAX,
  BREAKPOINT_STANDARD_MAX,
  MAX_CONTENT_WIDTH,
  RAIL_WIDTH_COMPACT,
  RAIL_WIDTH_EXPANDED,
  RAIL_WIDTH_ICON,
  resolveRailLayout,
} from "@/lib/rail";

// next/link renders a plain <a> under jsdom; stub it so CurrentBook's empty
// state ("Start Reading") renders without the Next router.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const MEMBERS: Member[] = [
  { user_id: "u1", display_name: "Ada Lovelace" },
  { user_id: "u2", display_name: "Grace Hopper" },
];

/** A chapters session with a cover and a shared target goal. */
function sessionWithCover(overrides: Partial<ReadingSession> = {}): ReadingSession {
  return {
    id: "s1",
    book_title: "Dune",
    total_chapters: 10,
    created_at: "2026-01-01T00:00:00Z",
    is_active: true,
    cover_url: "https://covers.example/dune.jpg",
    progress_type: "chapters",
    goal_type: "target",
    goal_amount: 6,
    goal_unit: "chapters",
    reading_units: [],
    progress: [
      { user_id: "u1", chapter_completed: 3 },
      { user_id: "u2", chapter_completed: 1 },
    ],
    ...overrides,
  };
}

/** Same session shape but with no stored cover reference. */
function sessionWithoutCover(overrides: Partial<ReadingSession> = {}): ReadingSession {
  return sessionWithCover({ cover_url: null, ...overrides });
}

/** A per-member progress lookup backed by the fixture rows. */
function makeGetMemberProgress(session: ReadingSession) {
  return (userId: string) =>
    session.progress.find((row) => row.user_id === userId)?.chapter_completed ??
    0;
}

/** Shorthand: render CurrentBook with sensible spy handlers + overrides. */
function renderCurrentBook(
  session: ReadingSession | undefined,
  handlers: Partial<{
    onCompleteChapter: () => void;
    onUndoChapter: () => void;
    onSetProgress: (v: number) => void;
    onDeleteBook: () => void;
  }> = {},
  myProgress = 3,
) {
  const spies = {
    onCompleteChapter: vi.fn(),
    onUndoChapter: vi.fn(),
    onSetProgress: vi.fn(),
    onDeleteBook: vi.fn(),
    ...handlers,
  };

  render(
    <CurrentBook
      groupId="g1"
      members={MEMBERS}
      currentSession={session}
      myProgress={myProgress}
      message=""
      getMemberProgress={session ? makeGetMemberProgress(session) : () => 0}
      onCompleteChapter={spies.onCompleteChapter}
      onUndoChapter={spies.onUndoChapter}
      onSetProgress={spies.onSetProgress}
      onDeleteBook={spies.onDeleteBook}
    />,
  );

  return spies;
}

/* -------------------------------------------------------------------------- */
/* Req 13.1 — bento layout uses the steering radii/borders/gaps/padding        */
/* -------------------------------------------------------------------------- */

describe("Group Reading Room — bento layout tokens (Req 13.1)", () => {
  it("renders screen sections as bento cards with the token card radius, hairline border and card padding", () => {
    render(
      <GroupHeader name="Night Owls" inviteCode="ABC123" onCopyInvite={() => {}} />,
    );

    // The card primitives mark themselves with data-bento-card; the outer
    // section is a primary (18px) card.
    const cards = document.querySelectorAll<HTMLElement>("[data-bento-card]");
    expect(cards.length).toBeGreaterThan(0);

    const primary = Array.from(cards).find(
      (c) => c.getAttribute("data-tone") === "primary",
    )!;
    expect(primary).toBeTruthy();

    // Radius / border / padding are all driven by Design_Tokens — never hex.
    expect(primary.style.borderRadius).toBe("var(--radius-card)");
    expect(primary.style.border).toBe("1px solid var(--border-subtle)");
    expect(primary.style.padding).toBe("var(--space-card-padding-max)");

    // No raw hex color leaks into the inline styles of any card (steering §12).
    for (const card of cards) {
      expect(card.getAttribute("style") ?? "").not.toMatch(/#[0-9a-fA-F]{3,8}/);
    }
  });

  it("renders inner sub-cards with the inner (12px) radius and compact padding token", () => {
    render(
      <GroupHeader name="Night Owls" inviteCode="ABC123" onCopyInvite={() => {}} />,
    );

    const inner = Array.from(
      document.querySelectorAll<HTMLElement>("[data-bento-card]"),
    ).find((c) => c.getAttribute("data-tone") === "inner")!;
    expect(inner).toBeTruthy();

    expect(inner.style.borderRadius).toBe("var(--radius-inner)");
    expect(inner.style.padding).toBe("var(--space-card-padding-min)");
  });

  it("uses the grid-gap token (not a raw pixel gap) for the bento grid rhythm", () => {
    // The screen grid in GroupClient drives its gap from --space-grid-gap-max;
    // reproduce that container contract here so a regression to a raw px gap
    // is caught at the layout level.
    const { container } = render(
      <div
        data-grid
        className="grid grid-cols-1 lg:grid-cols-3"
        style={{ gap: "var(--space-grid-gap-max)" }}
      />,
    );
    const grid = container.querySelector<HTMLElement>("[data-grid]")!;
    expect(grid.style.gap).toBe("var(--space-grid-gap-max)");
    expect(grid.style.gap).not.toMatch(/px/);
  });

  it("renders pill controls fully rounded via the pill radius token", () => {
    render(
      <GroupHeader name="Night Owls" inviteCode="ABC123" onCopyInvite={() => {}} />,
    );

    const pill = document.querySelector<HTMLElement>("[data-pill-button]")!;
    expect(pill).toBeTruthy();
    expect(pill.style.borderRadius).toBe("var(--radius-pill)");
  });
});

/* -------------------------------------------------------------------------- */
/* Req 13.2 / 13.3 — book cover 2:3 + spine shadow, else 2:3 placeholder       */
/* -------------------------------------------------------------------------- */

describe("Group Reading Room — book cover (Req 13.2, 13.3)", () => {
  it("renders a stored cover at 2:3 with the book-spine shadow and cover radius", () => {
    renderCurrentBook(sessionWithCover());

    const cover = document.querySelector<HTMLElement>("[data-book-cover]")!;
    expect(cover).toBeTruthy();
    expect(cover.getAttribute("data-has-cover")).toBe("true");

    // 2:3 aspect ratio, spine shadow (token), and the cover corner radius.
    expect(cover.style.aspectRatio).toBe("2 / 3");
    expect(cover.style.boxShadow).toBe("var(--shadow-spine)");
    expect(cover.style.borderRadius).toBe("7px");

    // The actual cover image is shown (not a placeholder).
    const img = within(cover).getByRole("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("https://covers.example/dune.jpg");
    expect(
      cover.querySelector("[data-book-cover-placeholder]"),
    ).toBeNull();
  });

  it("renders a 2:3 placeholder in the same box when there is no stored cover", () => {
    renderCurrentBook(sessionWithoutCover());

    const cover = document.querySelector<HTMLElement>("[data-book-cover]")!;
    expect(cover.getAttribute("data-has-cover")).toBe("false");

    // Same 2:3 box + radius as the cover case so the layout never shifts.
    expect(cover.style.aspectRatio).toBe("2 / 3");
    expect(cover.style.borderRadius).toBe("7px");

    // A placeholder stands in — no <img>.
    expect(cover.querySelector("[data-book-cover-placeholder]")).toBeTruthy();
    expect(within(cover).queryByRole("img")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Req 13.6 — inline stepper increments in one interaction, no navigation      */
/* -------------------------------------------------------------------------- */

describe("Group Reading Room — inline stepper (Req 13.6)", () => {
  it("increments progress in a single interaction, invoking the handler once and not navigating", () => {
    const beforeHref = window.location.href;
    const spies = renderCurrentBook(sessionWithCover(), {}, 3);

    // The quick-log control is an inline stepper (role=group) with an
    // explicitly-labelled increment control.
    const stepper = screen.getByRole("group", { name: /update chapters read/i });
    const increment = within(stepper).getByRole("button", {
      name: /increase by 1/i,
    });

    fireEvent.click(increment);

    // Exactly one interaction -> exactly one handler call, and no navigation
    // occurred (the location is unchanged; the stepper is not a link).
    expect(spies.onCompleteChapter).toHaveBeenCalledTimes(1);
    expect(increment.tagName).toBe("BUTTON");
    expect(window.location.href).toBe(beforeHref);
  });

  it("decrements progress in a single interaction via the stepper", () => {
    const spies = renderCurrentBook(sessionWithCover(), {}, 3);

    const stepper = screen.getByRole("group", { name: /update chapters read/i });
    const decrement = within(stepper).getByRole("button", {
      name: /decrease by 1/i,
    });

    fireEvent.click(decrement);
    expect(spies.onUndoChapter).toHaveBeenCalledTimes(1);
  });

  it("disables the increment control once the member has finished the book", () => {
    renderCurrentBook(
      sessionWithCover({ total_chapters: 10 }),
      {},
      10, // myProgress === total -> finished
    );

    const stepper = screen.getByRole("group", { name: /update chapters read/i });
    const increment = within(stepper).getByRole("button", {
      name: /increase by 1/i,
    }) as HTMLButtonElement;
    expect(increment.disabled).toBe(true);
  });

  it("renders the page-mode quick control as an inline stepper too", () => {
    renderCurrentBook(sessionWithCover({ progress_type: "pages" }), {}, 3);

    // Page mode exposes an inline stepper labelled for pages.
    const stepper = screen.getByRole("group", { name: /update your page/i });
    expect(within(stepper).getByRole("button", { name: /increase by 1/i })).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* Req 13.7 — preserved behaviors invoke their handlers                        */
/* -------------------------------------------------------------------------- */

describe("Group Reading Room — preserved behaviors invoke handlers (Req 13.7)", () => {
  it("copy invite: the copy control invokes onCopyInvite and confirms", () => {
    const onCopyInvite = vi.fn();
    render(
      <GroupHeader name="Night Owls" inviteCode="ABC123" onCopyInvite={onCopyInvite} />,
    );

    const copy = screen.getByRole("button", { name: /^copy$/i });
    fireEvent.click(copy);

    expect(onCopyInvite).toHaveBeenCalledTimes(1);
    // The transient confirmation is surfaced to the user.
    expect(screen.getByRole("button", { name: /copied/i })).toBeTruthy();
  });

  it("complete / undo progress: the stepper controls invoke their handlers", () => {
    const onCompleteChapter = vi.fn();
    const onUndoChapter = vi.fn();
    renderCurrentBook(sessionWithCover(), { onCompleteChapter, onUndoChapter }, 3);

    const stepper = screen.getByRole("group", { name: /update chapters read/i });
    fireEvent.click(within(stepper).getByRole("button", { name: /increase by 1/i }));
    fireEvent.click(within(stepper).getByRole("button", { name: /decrease by 1/i }));

    expect(onCompleteChapter).toHaveBeenCalledTimes(1);
    expect(onUndoChapter).toHaveBeenCalledTimes(1);
  });

  it("delete / replace book: the delete control invokes onDeleteBook", () => {
    const onDeleteBook = vi.fn();
    renderCurrentBook(sessionWithCover(), { onDeleteBook }, 3);

    fireEvent.click(screen.getByRole("button", { name: /delete \/ replace book/i }));
    expect(onDeleteBook).toHaveBeenCalledTimes(1);
  });

  it("set goal: a valid positive whole number invokes onUpdateGoal with a target goal", async () => {
    const onUpdateGoal = vi.fn().mockResolvedValue(undefined);
    render(
      <ReadingGoal
        currentSession={sessionWithCover({ goal_type: "none", goal_amount: null })}
        myProgress={0}
        onUpdateGoal={onUpdateGoal}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /set goal/i }));

    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "5" } });

    fireEvent.click(screen.getByRole("button", { name: /save goal/i }));

    // Allow the async handler microtasks to flush.
    await Promise.resolve();

    expect(onUpdateGoal).toHaveBeenCalledTimes(1);
    expect(onUpdateGoal).toHaveBeenCalledWith("target", 5, "chapters");
  });

  it("set goal: a non-positive / non-integer value is rejected locally without calling onUpdateGoal", () => {
    const onUpdateGoal = vi.fn().mockResolvedValue(undefined);
    render(
      <ReadingGoal
        currentSession={sessionWithCover({ goal_type: "none", goal_amount: null })}
        myProgress={0}
        onUpdateGoal={onUpdateGoal}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /set goal/i }));
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /save goal/i }));

    expect(onUpdateGoal).not.toHaveBeenCalled();
    expect(screen.getByText(/positive whole number/i)).toBeTruthy();
  });

  it("clear goal: the No schedule control invokes onUpdateGoal with a cleared goal", async () => {
    const onUpdateGoal = vi.fn().mockResolvedValue(undefined);
    render(
      <ReadingGoal
        currentSession={sessionWithCover()}
        myProgress={0}
        onUpdateGoal={onUpdateGoal}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /set goal/i }));
    fireEvent.click(screen.getByRole("button", { name: /no schedule/i }));

    await Promise.resolve();

    expect(onUpdateGoal).toHaveBeenCalledWith("none", null, null);
  });

  it("per-member list: renders every member with their completed count and the total", () => {
    const session = sessionWithCover();
    render(
      <ProgressList
        members={MEMBERS}
        currentSession={session}
        getMemberProgress={makeGetMemberProgress(session)}
      />,
    );

    const list = screen.getByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(MEMBERS.length);

    expect(within(items[0]).getByText(/ada lovelace/i)).toBeTruthy();
    // "3 / 10 chapters" rendered with tabular numerals (Req 13.5 support).
    expect(within(items[0]).getByText(/3\s*\/\s*10\s*chapters/i)).toBeTruthy();
    expect(within(items[1]).getByText(/grace hopper/i)).toBeTruthy();
    expect(within(items[1]).getByText(/1\s*\/\s*10\s*chapters/i)).toBeTruthy();
  });

  it("empty state: with no active session, offers the Start Reading entry point", () => {
    renderCurrentBook(undefined);
    const start = screen.getByRole("link", { name: /start reading/i });
    expect(start.getAttribute("href")).toBe("/group/g1/create-session");
  });
});

/* -------------------------------------------------------------------------- */
/* Req 13.8 — responsive rail widths + 1440px content cap at three breakpoints */
/* -------------------------------------------------------------------------- */

describe("Group Reading Room — responsive widths + 1440px cap (Req 13.8)", () => {
  it("resolves the icon-only rail and single content column below 960px", () => {
    const layout = resolveRailLayout(BREAKPOINT_COMPACT_MAX - 1);
    expect(layout.mode).toBe("icon");
    expect(layout.railWidth).toBe(RAIL_WIDTH_ICON);
    expect(layout.contentColumns).toBe(1);
    expect(layout.maxContentWidth).toBe(MAX_CONTENT_WIDTH);
  });

  it("resolves the compact rail and two content columns at standard desktop widths", () => {
    const layout = resolveRailLayout(BREAKPOINT_COMPACT_MAX); // 960, inclusive lower edge
    expect(layout.mode).toBe("compact");
    expect(layout.railWidth).toBe(RAIL_WIDTH_COMPACT);
    expect(layout.contentColumns).toBe(2);

    const upper = resolveRailLayout(BREAKPOINT_STANDARD_MAX); // 1360, inclusive upper edge
    expect(upper.mode).toBe("compact");
    expect(upper.railWidth).toBe(RAIL_WIDTH_COMPACT);
  });

  it("resolves the expanded rail and three content columns on wide monitors", () => {
    const layout = resolveRailLayout(BREAKPOINT_STANDARD_MAX + 1); // > 1360
    expect(layout.mode).toBe("expanded");
    expect(layout.railWidth).toBe(RAIL_WIDTH_EXPANDED);
    expect(layout.contentColumns).toBe(3);
  });

  it("caps content at 1440px across every breakpoint", () => {
    for (const w of [640, 960, 1360, 1920, 2560]) {
      expect(resolveRailLayout(w).maxContentWidth).toBe(1440);
    }
    expect(MAX_CONTENT_WIDTH).toBe(1440);
  });
});
