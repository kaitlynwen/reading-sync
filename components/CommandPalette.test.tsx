// @vitest-environment jsdom
//
// UI tests for the Cmd/Ctrl+K command palette (task 14.5; steering §6).
//
// Exercises the overlay end-to-end against the real pure helpers in
// `lib/commandPalette.ts` (keybinding + filtering), while the side-effecting
// seams are mocked:
//
//   - `next/navigation` — `useRouter().push` is a spy so navigation is observed
//     without a real router.
//   - `@/lib/backend/auth` — `currentUser()` returns a fixed authenticated id.
//   - `@/lib/backend/client` — the membership query is stubbed to return two
//     groups (one with an active book) via the dashboard's expand shape, so the
//     palette's lazy load resolves deterministically.
//
// Validates: Requirements 13.1 (steering §6 — desktop command palette).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

// --- Mock the router seam -------------------------------------------------
const push = vi.fn<(href: string) => void>();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

// --- Mock the auth seam ---------------------------------------------------
const currentUser = vi.fn(() => ({ userId: "u1", email: "a@b.c" }));
vi.mock("@/lib/backend/auth", () => ({
  currentUser: () => currentUser(),
}));

// --- Mock the Backend_Client membership query -----------------------------
// Returns the dashboard-shaped membership records: each expands a group whose
// reading sessions expand under `reading_sessions_via_group`.
const getFullList = vi.fn();
vi.mock("@/lib/backend/client", () => ({
  groupMembersCollection: () => ({ getFullList: (opts: unknown) => getFullList(opts) }),
  normalizeError: (e: unknown) => ({ kind: "unknown", message: String(e) }),
}));

// Import after the mocks are registered.
import CommandPalette from "./CommandPalette";

const MEMBERSHIPS = [
  {
    expand: {
      group: {
        id: "g1",
        name: "Night Owls",
        invite_code: "ABC",
        expand: {
          reading_sessions_via_group: [
            { id: "s1", book_title: "Dune", is_active: true },
          ],
        },
      },
    },
  },
  {
    expand: {
      group: {
        id: "g2",
        name: "Morning Pages",
        invite_code: "DEF",
        expand: { reading_sessions_via_group: [] },
      },
    },
  },
];

/** Open the palette via the Cmd+K accelerator and flush the lazy load. */
async function openPalette() {
  await act(async () => {
    fireEvent.keyDown(window, { key: "k", metaKey: true });
  });
  // Flush the loadPaletteGroups() microtasks.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  push.mockReset();
  getFullList.mockReset();
  getFullList.mockResolvedValue(MEMBERSHIPS);
  currentUser.mockReturnValue({ userId: "u1", email: "a@b.c" });
});

afterEach(() => {
  cleanup();
});

describe("CommandPalette (task 14.5)", () => {
  it("is closed by default and renders nothing", () => {
    render(<CommandPalette />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens on Cmd/Ctrl+K and closes on Escape and on a second toggle", async () => {
    render(<CommandPalette />);

    await openPalette();
    expect(screen.getByRole("dialog", { name: /command palette/i })).toBeTruthy();

    // Escape closes.
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).toBeNull();

    // Ctrl+K toggles open again (Windows/Linux accelerator).
    await act(async () => {
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("lists clubs, log-progress entries, and the active book jump target", async () => {
    render(<CommandPalette />);
    await openPalette();

    const list = screen.getByRole("listbox", { name: /results/i });
    const options = within(list).getAllByRole("option");

    // 2 clubs + 2 log-progress + 1 book (only Night Owls has an active book).
    expect(options).toHaveLength(5);
    // "Night Owls" appears as the club title and as the book's subtitle.
    expect(within(list).getAllByText("Night Owls").length).toBeGreaterThan(0);
    // "Dune" is the book title row and also the Night Owls progress subtitle.
    expect(within(list).getAllByText("Dune").length).toBeGreaterThan(0);
    expect(within(list).getByText(/log progress in morning pages/i)).toBeTruthy();
  });

  it("filters the list live as the user types", async () => {
    render(<CommandPalette />);
    await openPalette();

    const input = screen.getByRole("combobox");
    // "morning" is unique to the Morning Pages club + its log-progress entry.
    fireEvent.change(input, { target: { value: "morning" } });

    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    // Both Morning Pages entries match; neither Night Owls entry does.
    expect(options).toHaveLength(2);
    expect(within(screen.getByRole("listbox")).queryByText("Night Owls")).toBeNull();
  });

  it("navigates to the group and closes when a command is selected", async () => {
    render(<CommandPalette />);
    await openPalette();

    fireEvent.click(within(screen.getByRole("listbox")).getByText("Morning Pages"));

    expect(push).toHaveBeenCalledWith("/group/g2");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("navigates the highlighted result on Enter via keyboard", async () => {
    render(<CommandPalette />);
    await openPalette();

    const input = screen.getByRole("combobox");
    // Narrow to a single club, then press Enter.
    fireEvent.change(input, { target: { value: "night owls" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(push).toHaveBeenCalledWith("/group/g1");
  });

  it("shows an empty-state message when the user has no jump targets", async () => {
    getFullList.mockResolvedValue([]);
    render(<CommandPalette />);
    await openPalette();

    expect(screen.getByText(/nothing to jump to yet/i)).toBeTruthy();
  });

  it("does not query the backend until the palette is first opened", async () => {
    render(<CommandPalette />);
    expect(getFullList).not.toHaveBeenCalled();

    await openPalette();
    await waitFor(() => expect(getFullList).toHaveBeenCalledTimes(1));
  });
});
