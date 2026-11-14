# Implementation Plan: Native Desktop Migration

## Overview

This plan converts Reading Sync from a Supabase/OneSignal web app into a Tauri native desktop app backed by self-hosted PocketBase, while reusing the existing React UI. Work builds incrementally: first the Tauri shell and static-export scaffolding, then the shared design-token foundation, then the backend seam (endpoint config, `Backend_Client`, PocketBase schema), then auth, then Supabase removal and the functional screen migration, then group/session/progress operations, realtime sync, native notifications, and finally the scoped UI redesign (navigation rail, theme toggle, titlebar safe areas, Group Reading Room bento redesign), the one-time data migration script, and end-to-end verification/packaging.

Property-based tests use `fast-check` with Vitest (`--run`, single-run). Each property test is tagged with a comment in the format **Feature: native-desktop-migration, Property {number}: {property_text}** and runs a minimum of 100 generated cases. Test sub-tasks are marked optional with `*`; core implementation tasks are never optional.

## Tasks

- [x] 1. Scaffold Tauri desktop shell and static-export build pipeline
  - [x] 1.1 Add Tauri shell and configure static export
    - Create `src-tauri/` with `tauri.conf.json`, `Cargo.toml`, `capabilities/default.json`, and `src/main.rs`
    - Set `next.config.ts` to `output: "export"`; point Tauri `frontendDist` at `out/` and `devUrl` at the Next dev server
    - Configure `tauri dev` to run `next dev` and `tauri build` to run `next build` (static export) and bundle `out/`
    - Enable Windows (MSI/NSIS) and macOS (`.dmg`/`.app`) bundle targets so installers produce launchable entries
    - Handle the client-rendered dynamic route `app/group/[id]` under static export (id resolved via `useParams`)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 1.2 Add platform detection and launch watchdog
    - Add a platform-detection helper over the Tauri OS plugin that returns the current platform identifier
    - Add an `AppBootstrap`/React root launch watchdog: start a 5s timer at window creation; render a retry fallback (never a blank window) if the UI has not painted; show a native Tauri error dialog if the webview never signals ready
    - _Requirements: 1.6, 1.7_

  - [x] 1.3 Write property test for platform titlebar safe-area mapping
    - **Property 16: Platform titlebar safe-area mapping**
    - **Validates: Requirements 15.1, 15.2, 15.3**
    - Assert the resolver returns 76px left on `darwin`, 136px right on `win32`, 0 elsewhere

- [x] 2. Establish the Warm Editorial Bento design-token foundation
  - [x] 2.1 Rewrite globals.css as the single shared token stylesheet
    - Declare every semantic token named in `.kiro/steering/ui-design.md` (surfaces, pastel bento accents, text, borders, radii, spacing) once with exact light-theme values
    - Add `[data-theme="dark"]` block with the exact dark "Cozy Nightstand" values for every token
    - Load the editorial serif (Newsreader/Fraunces/Lora/Georgia) and UI sans-serif (Plus Jakarta Sans/Inter) typefaces; apply `font-variant-numeric: tabular-nums` to numeric UI elements
    - Remove the ad-hoc `--background` and `--foreground` variables so no stylesheet declares them; undeclared tokens fall back to the browser default
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_

  - [x] 2.2 Write unit tests for the token stylesheet
    - Assert every steering-named token is declared exactly once with the exact light value, and under `[data-theme="dark"]` with the exact dark value
    - Assert `--background`/`--foreground` are absent and tabular-nums is applied to numeric elements
    - _Requirements: 12.1, 12.2, 12.5, 12.6, 12.4_

- [x] 3. Implement the backend endpoint configuration store
  - [x] 3.1 Implement the config store for Backend_Endpoint and Theme_Preference
    - Create `lib/backend/config.ts` with `loadConfig`, `setBackendEndpoint`, `setThemePreference`, `isValidEndpoint` backed by the Tauri persistent store
    - Reject non-`http`/`https` endpoints with a format validation error and retain the previously persisted value; persist valid endpoints so launches do not re-prompt
    - Default `themePreference` to `system` when absent or invalid
    - _Requirements: 9.1, 9.2, 9.4, 14.8, 14.9, 14.10_

  - [x] 3.2 Add Backend Setup prompt and connection-error handling
    - When no endpoint is persisted, render a Backend Setup prompt and block all authenticated operations until a valid endpoint is persisted
    - Add a `pingBackend` health probe and surface an unreachable-backend connection error when a connection cannot be established within 10 seconds, retaining the configured endpoint
    - _Requirements: 9.3, 9.5_

  - [x] 3.3 Write property test for backend endpoint URL validity
    - **Property 14: Backend endpoint URL validity**
    - **Validates: Requirements 9.2**

  - [x] 3.4 Write unit test for config round-trip
    - Set valid endpoint then load returns it; unset shows the setup prompt
    - _Requirements: 9.3, 9.4_

- [x] 4. Implement Backend_Client and the PocketBase collection schema
  - [x] 4.1 Implement Backend_Client wrapping the PocketBase SDK
    - Create `lib/backend/client.ts` as the only module importing `pocketbase`, with `initBackend`, `getBackend` (throws when unconfigured), typed collection accessors, and `BackendError { kind, message, fieldErrors }` normalization
    - Map PocketBase records (relation ids, `expand`) into the existing `app/group/[id]/types.ts` shapes without changing those shapes
    - _Requirements: 11.1, 11.3, 11.4, 11.5_

  - [x] 4.2 Define PocketBase collections, constraints, and validation hooks
    - Define `groups`, `group_members`, `reading_sessions`, `progress`, `notification_subscriptions`, `notification_events` collections with field types/ranges from the design data model
    - Add unique indexes: `groups.invite_code`, `(user, group)` on `group_members`, `(reading_session, user)` on `progress`, `(reading_session, event_type, event_key)` on `notification_events`
    - Add an invite-code generation hook (6–32 chars, retry on collision) and a `progress.chapter_completed` clamp/reject hook for `[0, total_chapters]` integer range
    - Store `reading_units` as an ordered JSON array preserving `order_index`
    - _Requirements: 11.1, 11.2, 11.4, 11.5, 11.6, 11.7_

  - [x] 4.3 Write property test for generated invite codes
    - **Property 4: Generated invite codes are unique and well-formed**
    - **Validates: Requirements 4.2, 11.1**

  - [x] 4.4 Write property test for group field validity and invite-code uniqueness
    - **Property 5: Group field validity and invite-code uniqueness**
    - **Validates: Requirements 11.1, 11.2**

  - [x] 4.5 Write property test for progress clamp/range validation
    - **Property 1: Completed count is clamped and validated to [0, total]**
    - **Validates: Requirements 6.1, 6.2, 6.3, 11.5, 11.6**

  - [x] 4.6 Write property test for one progress record per member per session
    - **Property 2: At most one progress record per member per session** (PocketBase SDK mocked)
    - **Validates: Requirements 11.7**

- [x] 5. Implement Auth_Service and client-side route guard
  - [x] 5.1 Implement Auth_Service over PocketBase authStore
    - Create `lib/backend/auth.ts` with `createAccount`, `login`, `logout`, `currentUser`, `onAuthChange`, `restoreSession`
    - Back `authStore` with the Tauri persistent/secure store so the session survives restarts until expiry or logout; `restoreSession` hydrates on boot
    - _Requirements: 3.1, 3.6, 3.8, 3.10_

  - [x] 5.2 Add AuthGuard replacing proxy.ts
    - Wrap dashboard/group/create-group/join-group routes with an `<AuthGuard>` that redirects to `/login` when no session exists
    - _Requirements: 3.9_

  - [x] 5.3 Write property test for email validity
    - **Property 13: Email validity**
    - **Validates: Requirements 3.3**

  - [x] 5.4 Write unit test for password mismatch gating
    - Password/confirmation mismatch blocks submission without a backend call
    - _Requirements: 3.4_

- [x] 6. Remove Supabase and migrate screens to the new backend seam
  - [x] 6.1 Remove Supabase/OneSignal code, deps, and env vars
    - Delete `lib/supabase.ts`, `lib/supabase/client.ts`, `proxy.ts`, `app/api/notifications/progress/route.ts`, `components/OneSignalProvider.tsx`, `public/OneSignalSDKWorker.js`, `app/manifest.ts`
    - Remove `@supabase/ssr`, `@supabase/supabase-js`, `react-onesignal` from `package.json` and all `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SECRET_KEY`, `*ONESIGNAL*` env vars from config/templates
    - Leave `supabase/migrations/*.sql` in place but unreferenced at build/runtime
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 6.2 Migrate auth screens to Auth_Service (functional only)
    - Rewire `app/login`, `app/create-account`, and the logout control to `Auth_Service`, keeping existing behavior and validation (required fields, single-`@` email, password match, retain entered values on backend rejection); navigate to login within 2s on logout
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [x] 6.3 Migrate dashboard and group/session screens to Backend_Client (functional only)
    - Rewire `app/dashboard`, `app/create-group`, `app/join-group`, and `app/group/[id]/create-session` to `Backend_Client`, preserving current data flows without visual redesign
    - _Requirements: 2.2, 4.1, 5.1, 6.1_

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement group, membership, session, and progress operations
  - [x] 8.1 Implement create-group and join-group operations
    - Validate trimmed non-empty group/display names; create group with backend-generated unique invite code and creator membership; on backend failure show error and do not navigate; navigate to group on success
    - Join by invite code (no match -> message), avoid duplicate membership and still navigate when already a member, display and copy invite code with confirmation
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.11, 4.12_

  - [x] 8.2 Implement reading-session creation and deletion
    - Validate book title and progress configuration: progress type in {chapters, pages, milestones, sections}; positive whole total for chapters/pages; >=1 non-blank unit label for milestones/sections; store custom units preserving order; external book search with graceful no-cover fallback
    - Set session active on create; seed a zeroed progress record for every existing member; deleting the active session deletes its progress records
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9_

  - [x] 8.3 Implement progress and goal update operations
    - Update a member's completed count within `[0, total]` (including lower values) within 2s; reject out-of-range/non-integer values retaining the existing value; display each member's completed count and the session total
    - Store updated goal type/amount/unit for authenticated members within 2s; reject unauthenticated goal updates retaining existing config
    - Seed a zeroed progress record for a member joining a group that already has an active session
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 4.10_

  - [x] 8.4 Write property test for zeroed progress on session availability
    - **Property 3: Members have a zeroed progress record when a session is available**
    - **Validates: Requirements 4.10, 5.6**

  - [x] 8.5 Write property test for progress type membership
    - **Property 6: Progress type membership**
    - **Validates: Requirements 5.2**

  - [x] 8.6 Write property test for session numeric total validity
    - **Property 7: Session numeric total validity**
    - **Validates: Requirements 5.4**

  - [x] 8.7 Write property test for session unit-label validity
    - **Property 8: Session unit-label validity**
    - **Validates: Requirements 5.5**

  - [x] 8.8 Write property test for custom unit order preservation
    - **Property 9: Custom unit order is preserved**
    - **Validates: Requirements 5.3**

  - [x] 8.9 Write unit test for unauthenticated goal-update rejection
    - Unauthenticated goal update is rejected, config retained, auth-required error returned
    - _Requirements: 6.6_

- [x] 9. Implement Sync_Engine with PocketBase realtime
  - [x] 9.1 Implement realtime subscriptions and lifecycle
    - Create `lib/backend/sync.ts` with `subscribeGroup` that subscribes to `progress`, `reading_sessions`, and `group_members` filtered to the current group, triggering `loadGroup()` on any change; unsubscribe within 2s on unmount
    - Replace the three Supabase channels in `app/group/[id]/page.tsx`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 9.2 Implement reconnect-reload, connection status, and offline behavior
    - On reconnect, reissue `loadGroup()` to re-sync within 5s; emit `offline`/`stale` and show a connection-status indicator if not (re)connected within 10s, retaining last loaded state
    - Stop a load exceeding 10s and present a retry control; failed submits show "not saved", do not report success, and retain input; keep last good state with a "data may be out of date" indicator when a delivered change fails to apply
    - Resume realtime and reload current group state within 10s when connectivity is restored
    - _Requirements: 7.6, 7.7, 7.8, 10.1, 10.2, 10.3, 10.4_

  - [x] 9.3 Write integration tests for realtime lifecycle and offline states
    - Committed change -> handler -> `loadGroup`; unmount -> unsubscribe within 2s; forced 10s+ outage -> status indicator; slow load -> retry control; offline submit retains input
    - _Requirements: 7.1, 7.2, 7.5, 7.6, 7.7, 10.1, 10.2, 10.3_

- [x] 10. Implement native Notification_Service
  - [x] 10.1 Implement notification permission and subscription
    - Create `lib/notifications/service.ts` with `requestPermission`, `setSubscribed`, `isSubscribed` over the Tauri notification plugin and `notification_subscriptions`
    - Granted -> mark subscribed; denied -> show "notifications unavailable" and never attempt delivery; disabling clears subscription and stops delivery
    - Remove the OneSignal provider/button/api route/worker/manifest references and replace `components/EnableNotificationsButton.tsx` with a native-notification control
    - _Requirements: 8.5, 8.6, 8.7_

  - [x] 10.2 Implement fire-once event evaluation and native delivery
    - Evaluate on progress write: raise Weekly_Goal_Event once per `(reading_session, goalAmount, memberId)` and Group_Ready_Event once per `(reading_session, progressPoint)`, claiming via the unique `notification_events` index
    - Deliver native notifications identifying member+goal (weekly) or book title+next unit (group-ready) within 10s, retrying at most 3 times and recording not-received on total failure
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.8_

  - [x] 10.3 Write property test for notification fire-once semantics
    - **Property 10: Notification events fire at most once per key** (PocketBase SDK mocked)
    - **Validates: Requirements 8.1, 8.2**

  - [x] 10.4 Write property test for notification content completeness
    - **Property 11: Notification content completeness**
    - **Validates: Requirements 8.3, 8.4**

  - [x] 10.5 Write property test for notification delivery retry bound
    - **Property 12: Notification delivery retry bound**
    - **Validates: Requirements 8.8**

  - [x] 10.6 Write unit test for permission/subscription gating
    - Granted -> subscribed; denied -> unavailable; unsubscribed member -> no `deliver()` call
    - _Requirements: 8.5, 8.6, 8.7_

- [x] 11. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Implement Navigation_Rail and theme toggle
  - [x] 12.1 Implement NavigationRail and AppShell
    - Create `NavigationRail.tsx` and `AppShell` hosting the rail, content region, and titlebar safe-area padding, with responsive rail widths from the steering
    - _Requirements: 13.8, 14.1_

  - [x] 12.2 Implement the Light/Dark/System theme toggle in the rail footer
    - Create `ThemeToggle.tsx` as a segmented control indicating the selected preference; apply Light/Dark tokens within 200ms and System matching the OS within 200ms
    - Follow live OS color-scheme changes within 1s while System is selected; persist the preference and apply it on start; on persist failure keep applying current tokens and indicate the preference could not be saved
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8_

  - [x] 12.3 Write property test for theme-preference resolution
    - **Property 15: Theme-preference resolution**
    - **Validates: Requirements 14.9, 14.10**

  - [x] 12.4 Write UI tests for the theme toggle
    - Light/Dark set `data-theme` within 200ms; System matches and follows live OS changes; persisted preference applied on start; default System
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.8, 14.9_

- [x] 13. Implement cross-platform titlebar safe areas and draggable header
  - [x] 13.1 Apply platform safe-area padding and drag regions
    - Apply 76px left padding on macOS (top header and rail), 136px right padding on Windows (top bar), 0 elsewhere, driven by the platform detector
    - Mark empty header regions draggable (`-webkit-app-region: drag`) and interactive controls non-draggable (`no-drag`)
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6_

  - [x] 13.2 Write UI test for drag regions and safe-area application
    - Empty header regions are draggable with interactive controls non-draggable; correct safe-area padding applied per detected platform
    - _Requirements: 15.4, 15.5, 15.6_

- [x] 14. Redesign the Group Reading Room vertical slice
  - [x] 14.1 Build reusable bento primitives
    - Create `BentoCard`, `BookCover`, `ProgressTrack`, `PillButton`, `Stepper`, `MonogramAvatar` using Design_Tokens with the steering radii, hairline borders, grid gaps, and padding
    - _Requirements: 13.1_

  - [x] 14.2 Restyle GroupHeader, CurrentBook, ProgressList, and ReadingGoal
    - Lay out the Group Reading Room as a bento grid; render the book cover at 2:3 with spine shadow and corner radius, and a 2:3 placeholder when no cover; render progress numbers with tabular numerals
    - Present a single shared horizontal progress track (0-100%) with each member avatar at their completed-count percentage and a vertical dashed club-target marker at the shared goal; keep the frictionless inline stepper
    - Preserve all existing behaviors: copy invite, complete/undo progress, set/clear goal, delete/replace book, per-member list
    - Apply responsive rail/content breakpoints and constrain content to 1440px max width; restyle only this screen
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9_

  - [x] 14.3 Write property test for avatar position mapping
    - **Property 17: Avatar position maps to goal percentage**
    - **Validates: Requirements 13.4**

  - [x] 14.4 Write UI tests for the redesigned Group Reading Room
    - Bento layout uses steering radii/borders/gaps/padding; cover present -> 2:3 with spine shadow, absent -> 2:3 placeholder; inline stepper increments in one interaction without navigation; preserved behaviors invoke their handlers; responsive widths and 1440px max at the three breakpoints
    - _Requirements: 13.1, 13.2, 13.3, 13.6, 13.7, 13.8_

  - [x] 14.5 Add Cmd/Ctrl+K command palette and custom thin scrollbars
    - Optional polish from the steering: a command palette to jump between clubs/books/log progress and custom 6px warm translucent scrollbars for Windows builds
    - _Requirements: 13.1_

- [x] 15. Implement the one-time Supabase-to-PocketBase migration script
  - [x] 15.1 Implement migration mapping and halt-on-unmappable
    - Create `migration/` script that reads the Supabase dataset (service key used only here, never bundled) and writes to PocketBase via the admin API
    - Map users, groups, group_members, reading_sessions (+`reading_units` JSON preserving `order_index`), and progress preserving fields 11.1-11.5 and referential relationships via an id-remap table (re-runnable/idempotent)
    - Halt an individual record missing a required field, report the record and field, and leave already-migrated records intact
    - _Requirements: 11.8, 11.9_

  - [x] 15.2 Write property test for migration field/relationship preservation
    - **Property 18: Migration preserves fields and relationships**
    - **Validates: Requirements 11.8, 11.9**

- [x] 16. End-to-end verification and packaging
  - [x] 16.1 Verify static export, build-time Supabase guard, and installers
    - Confirm `next build` static export succeeds and that any lingering Supabase dependency, env var, or import fails the build with the unresolved reference
    - Produce `tauri build` Windows (MSI/NSIS) and macOS (`.dmg`/`.app`) installers with launchable entries and verify the launch watchdog renders an error indication instead of a blank window
    - _Requirements: 1.4, 1.5, 1.6, 1.7, 2.6_

  - [x] 16.2 Write integration test for end-to-end native notification delivery
    - Deliver one weekly-goal and one group-ready native notification end to end
    - _Requirements: 8.3, 8.4_

- [x] 17. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP; task 14.5 (command palette + custom scrollbars) is polish from the steering.
- Each task references specific requirements for traceability; every requirement (1-15) is covered by at least one implementation task.
- Checkpoints (tasks 7, 11, 17) ensure incremental validation.
- Property tests validate the 18 universal correctness properties; unit, integration, and UI tests cover examples, realtime wiring, permissions, rendering, and packaging.
- `.kiro/steering/ui-design.md` is the authoritative source for all token values, typography, breakpoints, and titlebar dimensions.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "3.1"] },
    { "id": 2, "tasks": ["1.3", "3.2", "3.3", "3.4", "4.1"] },
    { "id": 3, "tasks": ["4.2", "5.1"] },
    { "id": 4, "tasks": ["4.3", "4.4", "4.5", "4.6", "5.2", "5.3", "5.4", "6.1"] },
    { "id": 5, "tasks": ["6.2", "6.3", "8.1", "8.2", "8.3"] },
    { "id": 6, "tasks": ["8.4", "8.5", "8.6", "8.7", "8.8", "8.9", "9.1", "10.1"] },
    { "id": 7, "tasks": ["9.2", "10.2", "12.1"] },
    { "id": 8, "tasks": ["9.3", "10.3", "10.4", "10.5", "10.6", "12.2", "14.1"] },
    { "id": 9, "tasks": ["12.3", "12.4", "13.1", "14.2", "15.1"] },
    { "id": 10, "tasks": ["13.2", "14.3", "14.4", "14.5", "15.2", "16.1"] },
    { "id": 11, "tasks": ["16.2"] }
  ]
}
```
