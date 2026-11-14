"use client";

/**
 * Cmd/Ctrl+K command palette (task 14.5; steering §6, "Desktop Ergonomics").
 *
 * A global overlay — mounted once at the layout root — that lets the user jump
 * between book clubs, their active books, or straight to logging progress,
 * without reaching for the mouse. The keybinding (`Cmd+K` on macOS, `Ctrl+K`
 * elsewhere) is resolved by the pure {@link isPaletteToggle}; the command list
 * and its fuzzy filtering come from the pure helpers in `lib/commandPalette.ts`
 * so this component stays a thin shell.
 *
 * Behavior:
 *   - A window-level keydown listener toggles the palette open/closed on the
 *     accelerator and closes it on Escape.
 *   - The user's groups (and each group's active book) are fetched lazily the
 *     first time the palette opens, over the Backend_Client — the same query
 *     shape the dashboard uses. Nothing is fetched until the palette is needed.
 *   - Typing filters the commands live; ↑/↓ move the highlight and Enter
 *     navigates. Selecting a command routes via the Next router and closes.
 *
 * Styling follows the Warm Editorial Bento tokens (steering §4, §12): a floating
 * card with the soft float shadow, hairline border, pill search field, and a
 * visible focus-visible outline for keyboard users (steering §11). The overlay
 * uses the 200ms ease-out modal timing (steering §8) and respects reduced
 * motion.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";

import { currentUser } from "@/lib/backend/auth";
import {
  groupMembersCollection,
  normalizeError,
  type GroupRecord,
  type ReadingSessionRecord,
} from "@/lib/backend/client";
import {
  buildCommands,
  filterCommands,
  isPaletteToggle,
  type Command,
  type CommandKind,
  type PaletteGroup,
} from "@/lib/commandPalette";
import { SHADOW_FLOAT } from "@/lib/bento";

/** Leading glyph per command kind (steering §10 — one consistent icon set). */
const KIND_GLYPH: Record<CommandKind, string> = {
  club: "◆",
  book: "📖",
  progress: "✎",
};

/** The floating palette panel geometry (Design_Tokens only; steering §12). */
const PANEL_STYLE: CSSProperties = {
  borderRadius: "var(--radius-card)",
  border: "1px solid var(--border-subtle)",
  boxShadow: SHADOW_FLOAT,
  background: "var(--bg-surface)",
};

/**
 * Loads the user's groups and each group's active book over the Backend_Client,
 * reusing the dashboard's membership-expand query. Returns an empty list when
 * unauthenticated or on error so the palette simply shows nothing to jump to.
 */
async function loadPaletteGroups(): Promise<PaletteGroup[]> {
  const { userId } = currentUser();
  if (!userId) return [];

  try {
    const memberships = await groupMembersCollection().getFullList({
      filter: `user = "${userId}"`,
      expand: `group.reading_sessions_via_group`,
    });

    const groups: PaletteGroup[] = [];

    for (const membership of memberships) {
      const group = membership.expand?.group as GroupRecord | undefined;
      if (!group) continue;

      const sessions =
        (group.expand?.reading_sessions_via_group as
          | ReadingSessionRecord[]
          | undefined) ?? [];
      const activeSession = sessions.find((session) => session.is_active);

      groups.push({
        groupId: group.id,
        name: group.name,
        activeBookTitle: activeSession?.book_title ?? null,
      });
    }

    return groups;
  } catch (err) {
    console.error(normalizeError(err));
    return [];
  }
}

export default function CommandPalette() {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<PaletteGroup[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo(() => buildCommands(groups), [groups]);
  const results = useMemo(
    () => filterCommands(commands, query),
    [commands, query],
  );

  // Keep the highlighted row in range as the filtered results change.
  const clampedIndex = results.length === 0 ? 0 : Math.min(activeIndex, results.length - 1);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  }, []);

  const navigate = useCallback(
    (command: Command) => {
      close();
      router.push(command.href);
    },
    [close, router],
  );

  // Global accelerator: toggle on Cmd/Ctrl+K, close on Escape (steering §6).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isPaletteToggle(event)) {
        event.preventDefault();
        setOpen((prev) => !prev);
        return;
      }
      if (event.key === "Escape" && open) {
        close();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  // Lazily load the jump targets the first time the palette opens, and focus
  // the search field so typing works immediately. The highlighted row is reset
  // to the top in `close()` and whenever the query changes, so the effect only
  // handles focus + the one-time load (no setState in its body).
  useEffect(() => {
    if (!open) return;

    inputRef.current?.focus();

    if (!loaded) {
      let cancelled = false;
      void loadPaletteGroups().then((loadedGroups) => {
        if (cancelled) return;
        setGroups(loadedGroups);
        setLoaded(true);
      });
      return () => {
        cancelled = true;
      };
    }
  }, [open, loaded]);

  if (!open) return null;

  function onListKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) =>
        results.length === 0 ? 0 : (i - 1 + results.length) % results.length,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = results[clampedIndex];
      if (command) navigate(command);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      data-command-palette=""
      onClick={close}
      className={[
        "fixed inset-0 z-50 flex items-start justify-center",
        "bg-text-primary/30 px-4 pt-[18vh]",
        "motion-safe:animate-[fade-in_200ms_ease-out]",
      ].join(" ")}
    >
      {/* Panel — stop propagation so clicks inside never close the overlay. */}
      <div
        onClick={(event) => event.stopPropagation()}
        style={PANEL_STYLE}
        className="flex w-full max-w-xl flex-col overflow-hidden"
      >
        <div
          style={{ padding: "var(--space-card-padding-min)" }}
          className="border-b border-border-subtle"
        >
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onListKeyDown}
            placeholder="Jump to a club, book, or log progress…"
            aria-label="Search clubs, books, and actions"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            style={{ borderRadius: "var(--radius-pill)" }}
            className={[
              "w-full bg-bg-surface-muted px-4 py-2 font-sans text-sm text-text-primary",
              "placeholder:text-text-secondary",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
              "focus-visible:outline-text-primary",
            ].join(" ")}
          />
        </div>

        <ul
          id="command-palette-list"
          role="listbox"
          aria-label="Results"
          className="max-h-80 overflow-y-auto p-2"
        >
          {results.length === 0 ? (
            <li
              role="status"
              className="px-3 py-6 text-center font-sans text-sm text-text-secondary"
            >
              {loaded
                ? "Nothing to jump to yet. Create or join a club to get started."
                : "Loading…"}
            </li>
          ) : (
            results.map((command, index) => {
              const active = index === clampedIndex;
              return (
                <li key={command.id} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    data-command-option=""
                    data-active={active ? "true" : "false"}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => navigate(command)}
                    style={{ borderRadius: "var(--radius-inner)" }}
                    className={[
                      "flex w-full items-center gap-3 px-3 py-2 text-left",
                      "transition-colors duration-150",
                      "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
                      "focus-visible:outline-text-primary",
                      active ? "bg-bg-surface-muted" : "hover:bg-bg-surface-muted",
                    ].join(" ")}
                  >
                    <span
                      aria-hidden
                      className="flex h-6 w-6 shrink-0 items-center justify-center text-sm"
                    >
                      {KIND_GLYPH[command.kind]}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span
                        className={[
                          "truncate text-sm text-text-primary",
                          command.kind === "book" ? "font-serif" : "font-sans",
                        ].join(" ")}
                      >
                        {command.title}
                      </span>
                      {command.subtitle && (
                        <span className="truncate font-sans text-xs text-text-secondary">
                          {command.subtitle}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
