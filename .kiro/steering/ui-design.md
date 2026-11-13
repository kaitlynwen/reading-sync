---
inclusion: always
---

# UI Design System — Warm Editorial Bento

## 1. Design Philosophy & Aesthetic
- **Theme:** Warm Editorial Bento — tactile, cozy, bookish, and high-contrast without feeling sterile or corporate.
- **Layout:** Bento-grid cards with generous whitespace, soft rounded corners, and subtle hairline borders.
- **Visual Hierarchy:** Book covers, reading progress, and friend activity are the hero elements; chrome and navigation stay quiet.

---

## 2. Color Tokens
Use semantic CSS variables (or Tailwind theme tokens) mapped to these exact values:

### Surfaces & Backgrounds
- `--bg-app`: `#FAF7F2` (Warm alabaster / paper canvas — main app background)
- `--bg-surface`: `#FFFFFF` (Crisp white — primary bento cards and discussion threads)
- `--bg-surface-muted`: `#F3EFE6` (Warm oat — secondary panels, inputs, and hover states)
- `--bg-rail`: `#1C1B20` (Deep espresso charcoal — left navigation rail and primary active pills)

### Pastel Bento Accents (Use for category cards, group banners & stat tiles)
- `--accent-peach`: `#FADCD9` (Currently Reading / Active Book hero card)
- `--accent-sage`: `#DCECE3` (Reading streak & pace-on-track indicators)
- `--accent-lavender`: `#E5DFF5` (Group milestones & upcoming club meetings)
- `--accent-butter`: `#F9ECCB` (Highlights, saved quotes & chapter notes)
- `--accent-sky`: `#DCEBF7` (Friend activity & buddy-read invites)

### Typography & Borders
- `--text-primary`: `#1C1B20` (Primary ink — headings, body copy, active labels)
- `--text-secondary`: `#5E5B66` (Muted slate — timestamps, page counts, metadata)
- `--text-on-dark`: `#FAF7F2` (Text/icons inside `#1C1B20` dark pills and left rail)
- `--border-subtle`: `rgba(28, 27, 32, 0.08)` (`1px` card outlines and dividers)
- `--border-strong`: `rgba(28, 27, 32, 0.18)` (Active inputs and focused cards)

---

## 3. Typography
- **Editorial Serif (Book Titles, Club Names, Saved Quotes):** `'Newsreader'`, `'Fraunces'`, `'Lora'`, or system `'Georgia'`, serif.
- **UI & Stats Sans-Serif (Controls, Progress Numbers, Chat):** `'Plus Jakarta Sans'`, `'Inter'`, or system UI sans-serif.
- **Tabular Numerals:** Apply `font-variant-numeric: tabular-nums` to all page numbers, percentages, and streak counters so progress bars never jitter when updated.

---

## 4. Shape, Spacing & Elevation
- **Card Border Radius:** `18px` for primary bento cards; `12px` for inner sub-cards and book cover thumbnails; `9999px` (full pill) for filter chips, badges, and primary CTA buttons.
- **Borders over Heavy Shadows:** Rely on `1px solid var(--border-subtle)` for structure. Use soft shadows (`0 4px 16px rgba(28, 27, 32, 0.04)`) only on floating popovers, modals, and quick-log widgets.
- **Grid Rhythm:** `16px`–`20px` gap between bento cards; `20px`–`24px` internal card padding.

---

## 5. Social Reading & Book Club Patterns
- **Book Covers:** Always render with a subtle book-spine shadow (`-3px 4px 10px rgba(0, 0, 0, 0.12)`), `6px–8px` corner radius, and an authentic `2:3` aspect ratio.
- **Multi-Friend Progress Bar:** Show a shared horizontal track (`0%` to `100%` or Chapter 1 to Final Chapter) with overlapping circular friend avatars (`28px`) pinned directly to each member's current position, plus a vertical dashed marker for the club's target checkpoint.
- **Spoiler Protection:** Any comment or note tagged past the user's current chapter/page must default to a blurred/collapsed spoiler card (`"Spoiler · Ch. X — Click to reveal"`) until clicked.
- **Quick Progress Update:** Keep logging frictionless — inline page/chapter stepper (`+10 pages` / `Next Chapter`) plus optional 1-click emoji reaction or margin note.

---

## 6. Cross-Platform Desktop Rules (macOS & Windows)
- **Window Titlebar Safe Areas:**
  - Leave `76px` of left-side safe padding in the top header/rail when running on macOS (`darwin`) to clear native traffic-light window buttons.
  - Leave `136px` of right-side safe padding in the top bar when running on Windows (`win32`) to clear native minimize/maximize/close controls, and mark empty header regions as draggable (`-webkit-app-region: drag`) with `no-drag` on interactive buttons.
- **Responsive Desktop Breakpoints:**
  - **Compact / Half-Screen (`< 960px`):** Collapse the left navigation rail to icon-only (`64px` wide) and stack the right-hand member/activity column below the main reading bento grid.
  - **Standard Desktop (`960px – 1360px`):** Compact rail (`72px`) + 2-column bento workspace.
  - **Wide Monitor (`> 1360px`):** Expanded rail (`220px`) + 3-column bento workspace capped at `1440px` max content width.
- **Desktop Ergonomics:**
  - Support `Cmd/Ctrl + K` command palette to jump between book clubs, books, or log progress.
  - Style custom thin scrollbars (`6px` wide, warm translucent thumb) so Windows builds never display harsh default system scrollbars.
  - Ensure visible `:focus-visible` outlines (`2px solid #1C1B20`) for keyboard navigation.
  ---

## 7. Dark Mode — "Cozy Nightstand" Theme (`[data-theme="dark"]`)
- **Theme Behavior:** Support a manual Light / Dark / System toggle in the left navigation rail footer. Avoid pure `#000000` blacks; use warm espresso-slate surfaces so late-night reading feels like a dimmed lamp rather than harsh OLED contrast.

### Dark Surfaces & Backgrounds
- `--bg-app`: `#151418` (Warm charcoal-espresso — main canvas)
- `--bg-surface`: `#1E1D23` (Elevated warm slate — primary bento cards & discussion threads)
- `--bg-surface-muted`: `#27252E` (Soft cocoa-slate — secondary panels, inputs & hover states)
- `--bg-rail`: `#100F13` (Deepest ink — left navigation rail)

### Muted Pastel Bento Accents (Dark Mode)
Use rich, desaturated jewel-pastel fills with light ink text so bento cards keep their warm color coding without glowing aggressively at night:
- `--accent-peach`: `#3D2829` (Muted terracotta-blush — Currently Reading hero card)
- `--accent-sage`: `#22332B` (Deep moss-sage — Reading streak & pace indicators)
- `--accent-lavender`: `#2C273D` (Dusk plum-lavender — Group milestones & club meetings)
- `--accent-butter`: `#38301E` (Warm amber-ochre — Highlights, saved quotes & chapter notes)
- `--accent-sky`: `#21303D` (Midnight slate-blue — Friend activity & buddy-read invites)

### Dark Typography & Borders
- `--text-primary`: `#F4EFE6` (Warm cream ink — headings, body copy, active labels)
- `--text-secondary`: `#A6A0AD` (Soft warm gray — timestamps, page counts, metadata)
- `--text-on-accent`: `#F8F4EC` (High-legibility cream text inside dark pastel bento cards)
- `--border-subtle`: `rgba(244, 239, 230, 0.08)` (`1px` subtle warm hairline borders)
- `--border-strong`: `rgba(244, 239, 230, 0.18)` (Active inputs and focused cards)

---

## 8. Motion & Micro-Interactions
- **Tactile & Gentle Feel:** Animations should feel like turning a page or placing a bookmark—never bouncy, flashy, or sluggish.
- **Timing Tokens:**
  - Micro-interactions (button hovers, pill toggles, checkboxes): `150ms cubic-bezier(0.2, 0, 0, 1)`
  - Card expansions, spoiler reveals & progress bar fills: `260ms cubic-bezier(0.22, 1, 0.36, 1)`
  - Modals & command palette (`Cmd/Ctrl + K`): `200ms ease-out`
- **Signature Moments:**
  - Animate friend avatars smoothly along the shared reading progress track when a user logs new pages.
  - Give book covers a subtle lift (`translateY(-2px)`) and slightly deeper spine shadow on hover.
- **Reduced Motion:** Always respect `@media (prefers-reduced-motion: reduce)` by disabling slide/scale transitions.

---

## 9. Empty, Loading & Offline States
- **Skeleton Loaders:** Never show a generic spinning wheel for whole pages. Render warm tinted skeleton placeholders (`--bg-surface-muted` with a subtle pulse) that match the exact bento card layout.
- **Warm, Bookish Empty States:** Every empty view needs a friendly illustration/icon, a 1-line prompt, and a single pill CTA:
  - *No active book:* "Your club's shelf is empty — pick your next read together." + `[ Choose a Book ]`
  - *No chapter notes yet:* "Quiet in the margins so far. Drop the first thought on Chapter 1."
  - *No friends in group:* "Reading is better with company — copy an invite link for your friends."
- **Offline / Sync Tolerance:** Since desktop users often read or log pages offline, show a subtle `"Saved locally · Syncs when online"` status pill rather than blocking the UI with error modals.

---

## 10. Iconography & Avatars
- **Icon Library:** Use a single consistent icon set across the entire app (prefer **Lucide** or **Phosphor Regular**) with a `1.75px` stroke weight and rounded line caps. Never mix filled and outlined icons in the same toolbar.
- **Avatar Stack Rules:**
  - Always give circular friend avatars a `2px solid var(--bg-surface)` ring so overlapping avatars on the progress track separate cleanly.
  - When a user has no profile photo, generate a deterministic pastel monogram avatar using `--accent-peach`, `--accent-sage`, `--accent-lavender`, or `--accent-butter` with `--text-primary` initials.

---

## 11. Accessibility & Contrast Guardrails
- **Text on Pastel Cards:** Never place muted gray (`--text-secondary`) small text directly on top of pastel accent backgrounds (`--accent-*`) unless contrast meets WCAG AA (`4.5:1`). Use `--text-primary` (or `--text-on-accent` in dark mode) for labels inside colored bento tiles.
- **Interactive Semantics:**
  - Give all icon-only rail buttons and stepper controls (`+10 pages`) explicit `aria-label` attributes and native `<title>` tooltips (helpful on desktop hover).
  - Implement the shared book progress bar with `role="progressbar"` and readable `aria-valuetext` (e.g., `"Chapter 8 of 24, 33% complete"`).

---

## 12. Implementation Hygiene (For Kiro)
- **Zero Hardcoded Hex Values:** Never write raw hex colors inside component files; always reference CSS variables (`var(--bg-surface)`) or mapped Tailwind design tokens.
- **Reusable Bento Primitives:** Build and reuse core layout primitives (`<BentoCard>`, `<BookCover>`, `<ProgressTrack>`, `<SpoilerGuard>`, `<PillButton>`) instead of re-styling raw `<div>` containers per screen.