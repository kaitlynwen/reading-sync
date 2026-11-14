/**
 * Pure helpers for the Cmd/Ctrl+K command palette (task 14.5; steering §6).
 *
 * The React component under `components/CommandPalette.tsx` is a thin shell; all
 * of the keybinding resolution and the command-matching/filtering logic lives
 * here so it stays trivially unit- and property-testable under the project's
 * node test environment (matching the `lib/rail`, `lib/titlebar` convention).
 *
 * No DOM, no React, no backend imports.
 */

/**
 * A single palette destination the user can jump to (steering §6: "jump between
 * book clubs, books, or log progress").
 *
 * - `club`     → open a group's Reading Room.
 * - `book`     → open the group whose active book this is (deep-links to the
 *   same Reading Room; the book lives there).
 * - `progress` → jump to the group to log progress (the inline stepper lives in
 *   the Reading Room, Req 13.6).
 */
export type CommandKind = "club" | "book" | "progress";

/** A resolved, navigable palette command. */
export interface Command {
  /** Stable key for React lists and deduping. */
  id: string;
  /** Primary label shown in the palette row. */
  title: string;
  /** Optional secondary text (e.g. the club name beneath a book title). */
  subtitle?: string;
  /** What kind of destination this is (drives the row's leading glyph). */
  kind: CommandKind;
  /** In-app route to navigate to on selection. */
  href: string;
  /** Extra text folded into matching (never displayed) so search is forgiving. */
  keywords?: string;
}

/** The minimal group shape the palette needs to build its commands. */
export interface PaletteGroup {
  groupId: string;
  name: string;
  /** Title of the group's active book, if any. */
  activeBookTitle?: string | null;
}

/**
 * Normalizes a string for case/diacritic-insensitive matching: lowercased and
 * stripped of combining marks so "Café" matches a "cafe" query.
 */
export function normalizeForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * True when every whitespace-separated token of `query` appears somewhere in
 * `haystack` (order-independent subword match). An empty query matches
 * everything, so the palette shows all commands before the user types.
 */
export function matchesQuery(haystack: string, query: string): boolean {
  const normalizedQuery = normalizeForMatch(query);
  if (normalizedQuery.length === 0) return true;

  const normalizedHaystack = normalizeForMatch(haystack);
  return normalizedQuery
    .split(/\s+/)
    .every((token) => normalizedHaystack.includes(token));
}

/**
 * Builds the full, ordered command list from the user's groups (steering §6).
 *
 * For every group we emit:
 *   1. a `club` command (open the Reading Room),
 *   2. a `progress` command (log progress — same room, distinct intent), and
 *   3. a `book` command when the group has an active book.
 *
 * Clubs come first, then log-progress entries, then books, so the common
 * "jump to a club" case stays at the top.
 */
export function buildCommands(groups: readonly PaletteGroup[]): Command[] {
  const clubs: Command[] = [];
  const progress: Command[] = [];
  const books: Command[] = [];

  for (const group of groups) {
    const href = `/group/${group.groupId}`;

    clubs.push({
      id: `club:${group.groupId}`,
      title: group.name,
      kind: "club",
      href,
      keywords: "club group open go to",
    });

    progress.push({
      id: `progress:${group.groupId}`,
      title: `Log progress in ${group.name}`,
      subtitle: group.activeBookTitle ?? undefined,
      kind: "progress",
      href,
      keywords: "log progress update chapter page",
    });

    const bookTitle = group.activeBookTitle?.trim();
    if (bookTitle) {
      books.push({
        id: `book:${group.groupId}`,
        title: bookTitle,
        subtitle: group.name,
        kind: "book",
        href,
        keywords: "book reading currently",
      });
    }
  }

  return [...clubs, ...progress, ...books];
}

/**
 * Filters `commands` to those matching `query` across their title, subtitle,
 * and hidden keywords, preserving the input order (which {@link buildCommands}
 * already ranks). An empty query returns the full list.
 */
export function filterCommands(
  commands: readonly Command[],
  query: string,
): Command[] {
  return commands.filter((command) => {
    const haystack = [command.title, command.subtitle ?? "", command.keywords ?? ""].join(
      " ",
    );
    return matchesQuery(haystack, query);
  });
}

/**
 * True when a keyboard event is the command-palette toggle: `Cmd+K` on macOS or
 * `Ctrl+K` elsewhere (steering §6). Accepts either modifier on either platform
 * so the shortcut works regardless of how the key is reported, and ignores the
 * event when a plain `K` is typed without the accelerator.
 */
export function isPaletteToggle(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
}): boolean {
  const isK = event.key === "k" || event.key === "K";
  return isK && (event.metaKey || event.ctrlKey);
}
