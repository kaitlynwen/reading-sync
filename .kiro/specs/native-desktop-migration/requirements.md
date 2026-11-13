# Requirements Document

## Introduction

Reading Sync is currently a Next.js 16 / React 19 web application that lets small groups read books together, track per-member progress in real time, and receive push notifications when goals are reached. This feature converts Reading Sync into a native desktop application for Windows and macOS using Tauri, which reuses the existing React UI and produces native installers. The migration removes the Supabase backend entirely and replaces it with a self-hosted PocketBase backend that provides authentication, data storage, and realtime sync. OneSignal web push is replaced with native OS desktop notifications delivered through the Tauri notification API, with the backend remaining the source of notification events. All existing user-facing features — account management, multi-user groups, invite codes, reading sessions, goals, and per-member progress — are preserved, and cross-device/cross-member syncing remains the core of the product.

## Glossary

- **Reading_Sync_App**: The native desktop application built with Tauri that hosts the reused React user interface and runs on Windows and macOS.
- **Desktop_Shell**: The Tauri runtime layer that packages the web UI, produces native installers, and exposes native capabilities such as notifications and secure storage.
- **PocketBase_Backend**: The self-hosted PocketBase server instance that provides authentication, persistent data storage, and realtime subscriptions.
- **Backend_Client**: The client-side module inside the Reading_Sync_App that communicates with the PocketBase_Backend over HTTP and realtime connections.
- **Auth_Service**: The portion of the PocketBase_Backend and Backend_Client responsible for account creation, login, logout, and session handling.
- **Sync_Engine**: The realtime subscription mechanism that propagates changes to groups, reading sessions, members, and progress across all connected members and devices.
- **Notification_Service**: The component that evaluates notification events on the backend and triggers native OS desktop notifications through the Desktop_Shell.
- **Native_Notification**: An operating-system-level desktop notification shown by Windows or macOS through the Tauri notification API.
- **Group**: A reading group identified by an id, name, and invite code, containing members and reading sessions.
- **Member**: A user who belongs to a Group, identified by a user id and a display name.
- **Reading_Session**: A book being read by a Group, including progress type, goal configuration, optional cover, optional reading units, and per-member progress.
- **Progress_Record**: A per-member record of how many chapters, pages, or units a Member has completed in a Reading_Session.
- **Invite_Code**: A short code used to join a Group.
- **Backend_Endpoint**: The configurable URL of the PocketBase_Backend that the Backend_Client connects to.
- **Weekly_Goal_Event**: A notification event raised when a Member reaches the configured goal amount of a Reading_Session.
- **Group_Ready_Event**: A notification event raised when every Member of a Group has reached a shared progress point in a Reading_Session.
- **Migration_Path**: The one-time process that transfers existing Supabase data into the PocketBase_Backend.
- **Design_Tokens**: The set of semantic CSS variables (surfaces, bento accents, typography, borders, radii, spacing) defined by the Warm Editorial Bento design system for both light and dark themes.
- **Theme_Preference**: The user's selected color mode — Light, Dark, or System — where System follows the operating system color scheme.
- **Navigation_Rail**: The persistent left-hand navigation column of the Reading_Sync_App whose footer hosts the Theme_Preference toggle.
- **Group_Reading_Room**: The Group screen of the Reading_Sync_App (the group detail view showing the current book, group readiness, progress updates, reading goal, and per-member progress).
- **Titlebar_Safe_Area**: The platform-specific reserved padding in the top header/rail that keeps native window controls from overlapping application UI.

## Requirements

### Requirement 1: Native desktop packaging and distribution

**User Story:** As a reader, I want Reading Sync delivered as a native desktop app for Windows and macOS, so that I can install and run it without a web browser.

#### Acceptance Criteria

1. THE Reading_Sync_App SHALL run as a native desktop application on supported Windows versions (Windows 10 and Windows 11) using the Desktop_Shell, without requiring a separately installed web browser.
2. THE Reading_Sync_App SHALL run as a native desktop application on supported macOS versions (macOS 12 or later) using the Desktop_Shell, without requiring a separately installed web browser.
3. THE Reading_Sync_App SHALL reuse the existing React user interface for all user-facing screens such that no user-facing screen requires reimplementation outside the existing React UI.
4. THE Desktop_Shell SHALL produce a native Windows installer artifact that installs the Reading_Sync_App and creates a launchable application entry.
5. THE Desktop_Shell SHALL produce a native macOS installer artifact that installs the Reading_Sync_App and creates a launchable application entry.
6. WHEN the Reading_Sync_App is launched, THE Reading_Sync_App SHALL render the application user interface within the Desktop_Shell window within 5 seconds.
7. IF the Reading_Sync_App fails to render the application user interface within 5 seconds of launch, THEN THE Reading_Sync_App SHALL display an error indication to the user and SHALL not remain on a blank window.

### Requirement 2: Remove the Supabase integration

**User Story:** As a maintainer, I want all Supabase code and configuration removed, so that the application has no dependency on Supabase.

#### Acceptance Criteria

1. THE Reading_Sync_App SHALL exclude all Supabase client libraries from its declared dependencies such that no dependency manifest entry references a Supabase package.
2. THE Reading_Sync_App SHALL contain zero source files that import, reference, or invoke Supabase authentication, data access, or realtime APIs.
3. THE Reading_Sync_App SHALL exclude all Supabase-specific environment variables from its configuration such that no configuration file or environment template declares a Supabase-prefixed variable.
4. THE Reading_Sync_App SHALL exclude the browser-based route-protection middleware that depends on Supabase such that no middleware file imports or invokes Supabase APIs.
5. WHERE Supabase database migration files exist in the repository, THE Reading_Sync_App SHALL NOT load, execute, or reference those migration files during application startup or request handling.
6. IF the application build or startup process attempts to resolve a Supabase dependency, environment variable, or code path, THEN THE Reading_Sync_App SHALL fail the build with an error indicating the unresolved Supabase reference and SHALL NOT produce a runnable artifact.

### Requirement 3: Account creation, login, and logout via PocketBase

**User Story:** As a reader, I want to create an account, log in, and log out, so that my identity and groups are tied to me across devices.

#### Acceptance Criteria

1. WHEN a user submits an email between 3 and 254 characters and a password between 8 and 72 characters on the create-account screen, THE Auth_Service SHALL create a new account in the PocketBase_Backend within 5 seconds and establish an authenticated session.
2. IF a user submits a create-account form with any empty required field, THEN THE Reading_Sync_App SHALL display a validation message identifying each empty field and SHALL NOT submit the request to the PocketBase_Backend.
3. IF a user submits a create-account form where the email does not contain a single "@" with non-empty local and domain parts, THEN THE Reading_Sync_App SHALL display a validation message indicating an invalid email and SHALL NOT submit the request to the PocketBase_Backend.
4. IF a user submits a create-account form where the password and confirmation do not match, THEN THE Reading_Sync_App SHALL display a mismatch message and SHALL NOT submit the request to the PocketBase_Backend.
5. IF the PocketBase_Backend rejects account creation because the submitted email is already registered, THEN THE Reading_Sync_App SHALL display an error message indicating the email is already in use and SHALL retain the entered email and password values in the form.
6. WHEN a user submits valid credentials on the login screen, THE Auth_Service SHALL authenticate the user against the PocketBase_Backend within 5 seconds and establish an authenticated session.
7. IF the PocketBase_Backend rejects the submitted login credentials, THEN THE Reading_Sync_App SHALL display an authentication error message and SHALL retain the entered email value in the form.
8. WHEN a user selects logout, THE Auth_Service SHALL end the authenticated session and THE Reading_Sync_App SHALL navigate to the login screen within 2 seconds.
9. WHILE no authenticated session exists, THE Reading_Sync_App SHALL restrict access to the dashboard, group, create-group, and join-group screens and SHALL route the user to the login screen.
10. THE Auth_Service SHALL persist the authenticated session across application restarts until the session expires or the user logs out.

### Requirement 4: Group creation and membership

**User Story:** As a reader, I want to create a group and invite others with a code, so that we can read together.

#### Acceptance Criteria

1. WHEN an authenticated user submits a non-empty group name and a non-empty display name on the create-group screen, THE PocketBase_Backend SHALL create a Group with a generated Invite_Code and SHALL record the creating user as a Member with the provided display name.
2. THE PocketBase_Backend SHALL generate each Invite_Code as a code that is unique across all existing Groups.
3. IF the create-group request fails at the PocketBase_Backend, THEN THE Reading_Sync_App SHALL display an error message indicating the group could not be created and SHALL NOT navigate to a Group screen.
4. IF a user submits the create-group form where the group name is empty after trimming surrounding whitespace or the display name is empty after trimming surrounding whitespace, THEN THE Reading_Sync_App SHALL display a validation message and SHALL NOT submit the request.
5. WHEN a Group is created, THE Reading_Sync_App SHALL navigate to that Group screen.
6. WHEN an authenticated user submits an Invite_Code matching an existing Group and a non-empty display name on the join-group screen, THE PocketBase_Backend SHALL add the user as a Member of the matching Group with the provided display name.
7. IF a user submits the join-group form where the display name is empty after trimming surrounding whitespace, THEN THE Reading_Sync_App SHALL display a validation message and SHALL NOT submit the request.
8. IF the submitted Invite_Code matches no Group, THEN THE Reading_Sync_App SHALL display a message that no group was found and SHALL NOT add the user as a Member.
9. IF the submitting user is already a Member of the Group matching the submitted Invite_Code, THEN THE PocketBase_Backend SHALL NOT create a duplicate Member record for that user in that Group and THE Reading_Sync_App SHALL navigate the user to that Group screen.
10. WHERE the joined Group has an active Reading_Session, THE PocketBase_Backend SHALL create a Progress_Record for the joining Member in that Reading_Session with an initial completed count of zero.
11. THE Reading_Sync_App SHALL display the Invite_Code on the Group screen.
12. WHEN the user selects the copy action on the Group screen, THE Reading_Sync_App SHALL copy the Invite_Code to the system clipboard and SHALL display a confirmation that the Invite_Code was copied.

### Requirement 5: Reading session management

**User Story:** As a group member, I want to start a book with a chosen progress-tracking style, so that the group can track reading together.

#### Acceptance Criteria

1. WHEN an authenticated Member submits a reading-session form with a non-empty book title and a valid progress configuration, THE PocketBase_Backend SHALL create a Reading_Session for the Group and SHALL set the Reading_Session active flag to true.
2. THE Reading_Sync_App SHALL offer exactly the progress types chapters, pages, milestones, and sections when creating a Reading_Session, and SHALL reject any submitted progress type outside this set with a validation message.
3. WHERE the progress type is milestones or sections, THE PocketBase_Backend SHALL store the custom reading units provided by the Member preserving their submitted order.
4. IF the progress type is chapters or pages and the submitted progress count is not a whole number greater than or equal to one, THEN THE Reading_Sync_App SHALL display a validation message indicating the count must be a positive whole number and SHALL NOT create the Reading_Session.
5. IF the progress type is milestones or sections and fewer than one non-blank custom unit label is provided, THEN THE Reading_Sync_App SHALL display a validation message indicating at least one unit label is required and SHALL NOT create the Reading_Session.
6. WHEN a Reading_Session is created, THE PocketBase_Backend SHALL create a Progress_Record with a completed count of zero for every existing Member of the Group.
7. WHEN a Member searches for a book title, THE Reading_Sync_App SHALL retrieve candidate book results from the external book search source and SHALL store the selected cover reference with the Reading_Session when the selected result includes a cover image.
8. IF the external book search source returns no candidate results or is unreachable, THEN THE Reading_Sync_App SHALL display a message indicating that book results could not be retrieved and SHALL allow the Member to create the Reading_Session without a cover reference.
9. WHEN a Member confirms deletion of the active Reading_Session, THE PocketBase_Backend SHALL delete the Reading_Session and its associated Progress_Records.

### Requirement 6: Per-member progress tracking

**User Story:** As a group member, I want to update my reading progress, so that the group can see how far each person has read.

#### Acceptance Criteria

1. WHEN a Member submits a completed count that is an integer from zero to the total count of the active Reading_Session, THE PocketBase_Backend SHALL update that Member's Progress_Record to the submitted completed count within 2 seconds.
2. IF a Member submits a completed count that is less than zero, greater than the total count of the active Reading_Session, or not an integer, THEN THE PocketBase_Backend SHALL reject the update, retain the Member's existing completed count, and return an error indicating the value is out of range.
3. WHEN a Member submits a completed count lower than their current completed count and within the range from zero to the total count, THE PocketBase_Backend SHALL update that Member's Progress_Record to the lower completed count within 2 seconds.
4. WHEN the active Reading_Session is displayed, THE Reading_Sync_App SHALL display each Member's current completed count and the total count of the Reading_Session.
5. WHEN an authenticated Member submits updated goal configuration for the active Reading_Session, THE PocketBase_Backend SHALL store the updated goal type, goal amount, and goal unit within 2 seconds.
6. IF an unauthenticated requester attempts to update the goal configuration of the active Reading_Session, THEN THE PocketBase_Backend SHALL reject the request, retain the existing goal configuration, and return an error indicating authentication is required.

### Requirement 7: Multi-user realtime synchronization

**User Story:** As a group member, I want changes from other members to appear on my device automatically, so that everyone sees the same up-to-date reading state.

#### Acceptance Criteria

1. WHILE a Member is viewing a Group screen, THE Sync_Engine SHALL maintain an active subscription to changes for that Group's progress records, reading sessions, and member list.
2. WHEN a Progress_Record changes in a Group the Member is viewing, THE Sync_Engine SHALL deliver the change to the Reading_Sync_App within 5 seconds of the change being committed to the backend, and THE Reading_Sync_App SHALL update the displayed progress to match the delivered value.
3. WHEN a Reading_Session is created, updated, or deleted in a Group the Member is viewing, THE Sync_Engine SHALL deliver the change to the Reading_Sync_App within 5 seconds of the change being committed to the backend, and THE Reading_Sync_App SHALL update the displayed reading session list to reflect the create, update, or delete.
4. WHEN a Member is added to or removed from a Group that another Member is viewing, THE Sync_Engine SHALL deliver the change to the Reading_Sync_App within 5 seconds of the change being committed to the backend, and THE Reading_Sync_App SHALL update the displayed member list to reflect the added or removed member.
5. WHEN a Member navigates away from the Group screen, THE Sync_Engine SHALL unsubscribe from that Group's change subscriptions within 2 seconds.
6. WHEN the realtime connection is re-established after an interruption, THE Reading_Sync_App SHALL reload the current Group's progress records, reading sessions, and member list so the displayed data matches the latest backend state within 5 seconds of re-establishment.
7. IF the realtime connection cannot be established or is lost and not re-established within 10 seconds, THEN THE Reading_Sync_App SHALL display a connection status indicator showing that realtime updates are unavailable, and SHALL retain the last successfully loaded Group state.
8. IF a delivered change fails to apply to the displayed state, THEN THE Reading_Sync_App SHALL retain the last successfully displayed Group state and SHALL display an indication that the displayed data may be out of date.

### Requirement 8: Native desktop notifications

**User Story:** As a group member, I want desktop notifications when a goal is reached or the group is ready for the next unit, so that I know when to keep reading.

#### Acceptance Criteria

1. WHEN a Member reaches or exceeds the configured goal amount of the active Reading_Session, THE Notification_Service SHALL raise a Weekly_Goal_Event exactly once for that goal amount and Member, and SHALL NOT raise an additional Weekly_Goal_Event for the same Member and goal amount on subsequent progress updates within that Reading_Session.
2. WHEN every Member of a Group has reached or exceeded a shared progress point in the active Reading_Session, THE Notification_Service SHALL raise a Group_Ready_Event exactly once for that progress point, and SHALL NOT raise an additional Group_Ready_Event for the same progress point and Group.
3. WHEN a Weekly_Goal_Event is raised, THE Notification_Service SHALL deliver a Native_Notification through the Desktop_Shell to each subscribed Member within 10 seconds of the event, where the Native_Notification identifies the Member who reached the goal and the goal amount reached.
4. WHEN a Group_Ready_Event is raised, THE Notification_Service SHALL deliver a Native_Notification through the Desktop_Shell to each subscribed Member within 10 seconds of the event, where the Native_Notification identifies the book title and the next unit the Group is ready for.
5. WHEN a Member enables notifications, THE Notification_Service SHALL request native notification permission through the Desktop_Shell, and IF permission is granted, THEN THE Notification_Service SHALL record the Member as subscribed to notifications.
6. WHEN a Member disables notifications, THE Notification_Service SHALL record the Member as not subscribed and SHALL NOT deliver any subsequent Native_Notification to that Member.
7. IF native notification permission is denied by the operating system, THEN THE Reading_Sync_App SHALL display an indication that notifications are unavailable and SHALL NOT attempt to deliver any Native_Notification to that Member.
8. IF delivery of a Native_Notification through the Desktop_Shell fails, THEN THE Notification_Service SHALL retry delivery at most 3 times and SHALL record the Member as not having received that Native_Notification if all attempts fail.

### Requirement 9: Backend endpoint configuration

**User Story:** As a user running a self-hosted backend, I want to configure which PocketBase server the app connects to, so that the app reaches my server.

#### Acceptance Criteria

1. WHEN the Reading_Sync_App starts, THE Backend_Client SHALL read the Backend_Endpoint value from the persisted application configuration.
2. IF the Backend_Endpoint provided by the user is not a syntactically valid URL using the http or https scheme, THEN THE Reading_Sync_App SHALL reject the value, display a validation error indicating the endpoint format is invalid, and retain any previously persisted Backend_Endpoint.
3. WHERE no Backend_Endpoint is present in the application configuration, THE Reading_Sync_App SHALL prompt the user to provide a Backend_Endpoint and SHALL block all authenticated operations until a valid Backend_Endpoint is persisted.
4. WHEN a user provides a syntactically valid Backend_Endpoint, THE Reading_Sync_App SHALL persist the Backend_Endpoint to the application configuration so that it is read without re-prompting on subsequent launches.
5. IF the Backend_Client cannot establish a connection to the configured Backend_Endpoint within 10 seconds, THEN THE Reading_Sync_App SHALL display a connection error message identifying that the backend is unreachable and SHALL retain the configured Backend_Endpoint.

### Requirement 10: Offline behavior

**User Story:** As a reader, I want clear behavior when my device is offline, so that I understand why data is not updating.

#### Acceptance Criteria

1. IF the Backend_Endpoint is unreachable when the Reading_Sync_App attempts to load Group data, THEN THE Reading_Sync_App SHALL display an error state indicating that the Group data could not be loaded and SHALL retain any previously loaded Group data in view.
2. IF the Backend_Endpoint remains unreachable for more than 10 seconds during a Group data load attempt, THEN THE Reading_Sync_App SHALL stop the load attempt and SHALL present a retry control that allows the Member to reinitiate the load.
3. IF the Backend_Endpoint is unreachable when a Member submits a change, THEN THE Reading_Sync_App SHALL display an error message indicating that the change was not saved, SHALL NOT report the change as saved, and SHALL retain the Member's submitted input values.
4. WHEN connectivity to the Backend_Endpoint is restored, THE Reading_Sync_App SHALL resume realtime synchronization within 10 seconds and SHALL reload the current Group state.

### Requirement 11: Data model preservation and migration path

**User Story:** As a maintainer, I want the PocketBase data model to preserve existing concepts, so that groups, sessions, members, and progress continue to work after migration.

#### Acceptance Criteria

1. THE PocketBase_Backend SHALL represent each Group with a unique id, a name between 1 and 200 characters, and a unique Invite_Code between 6 and 32 characters.
2. IF a Group is created or updated with a name that is empty or exceeds 200 characters, or with an Invite_Code that duplicates an existing Invite_Code or falls outside 6 to 32 characters, THEN THE PocketBase_Backend SHALL reject the operation, return an error indicating the invalid or duplicate field, and leave existing Group records unchanged.
3. THE PocketBase_Backend SHALL represent each Member with a reference to exactly one user, a reference to exactly one Group, and a display name between 1 and 100 characters.
4. THE PocketBase_Backend SHALL represent each Reading_Session with a book title between 1 and 300 characters, a total count between 1 and 100000, a progress type, an active flag that is either true or false, an optional cover reference, an optional goal type, an optional goal amount between 1 and 100000, an optional goal unit, and an ordered list of 0 to 10000 reading units.
5. THE PocketBase_Backend SHALL represent each Progress_Record with a reference to exactly one Reading_Session, a reference to exactly one Member, and a completed count between 0 and the referenced Reading_Session total count.
6. IF a Progress_Record is created or updated with a completed count below 0 or above the referenced Reading_Session total count, THEN THE PocketBase_Backend SHALL reject the operation, return an error indicating the out-of-range completed count, and leave the existing Progress_Record unchanged.
7. THE PocketBase_Backend SHALL enforce that each Member has at most one Progress_Record per Reading_Session, rejecting any additional Progress_Record for the same Member and Reading_Session with an error indicating the uniqueness violation.
8. WHERE existing Supabase data must be carried over, THE Migration_Path SHALL map every Supabase group, group member, reading session, reading unit, and progress record to a corresponding PocketBase_Backend record, preserving all fields listed in criteria 1 through 5 with identical values and referential relationships.
9. IF any Supabase record cannot be mapped to a PocketBase_Backend record without loss of a field listed in criteria 1 through 5, THEN THE Migration_Path SHALL halt the affected record's migration, report an error identifying the unmapped record and field, and leave already-migrated PocketBase_Backend records intact.

### Requirement 12: Warm Editorial Bento design-token foundation

**User Story:** As a maintainer, I want the Warm Editorial Bento design tokens and typography available app-wide, so that screens can be restyled consistently starting with the Group Reading Room.

#### Acceptance Criteria

1. THE Reading_Sync_App SHALL define the semantic Design_Tokens for surfaces, pastel bento accents, text, borders, radii, and spacing using the light-theme values specified in the ui-design.md steering as the authoritative source of exact token values, such that every token named in the ui-design.md steering is declared with a value matching that source.
2. WHILE the active theme is the dark "Cozy Nightstand" theme indicated by a `[data-theme="dark"]` selector on a root element, THE Reading_Sync_App SHALL apply the dark-theme Design_Tokens values specified in the ui-design.md steering, such that every semantic token defined for the light theme has a corresponding dark-theme value matching that source.
3. THE Reading_Sync_App SHALL load the editorial serif typeface for book and club titles and the sans-serif typeface for user-interface and statistics text using the exact typeface names specified in the ui-design.md steering, such that each of those text categories resolves to its designated typeface.
4. WHERE a user-interface element displays a progress number, percentage, or counter, THE Reading_Sync_App SHALL render that number using tabular numerals so that each digit occupies equal horizontal width.
5. THE Reading_Sync_App SHALL define all Design_Tokens exactly once in a single shared stylesheet, such that every Design_Token is declared in that one stylesheet and no other stylesheet redeclares it, and any screen can reference the same Design_Tokens.
6. THE Reading_Sync_App SHALL replace the existing ad-hoc `--background` and `--foreground` variables with the Design_Tokens, such that no stylesheet declares the `--background` or `--foreground` variables.
7. IF a Design_Token referenced by a screen is not declared in the shared stylesheet, THEN THE Reading_Sync_App SHALL fall back to the browser default for that CSS property rather than applying an undefined or empty value.

### Requirement 13: Group Reading Room redesign vertical slice

**User Story:** As a group member, I want the Group_Reading_Room restyled in the Warm Editorial Bento system, so that I can review the new layout and colors before the design is applied elsewhere.

#### Acceptance Criteria

1. WHEN the Group_Reading_Room is displayed, THE Reading_Sync_App SHALL render it using the Design_Tokens and a bento-grid card layout, applying the card border radii, hairline border widths, grid gaps, and internal card padding exactly as specified in the ui-design.md steering.
2. WHERE the active Reading_Session has a stored cover reference, THE Group_Reading_Room SHALL render the book cover at a 2:3 aspect ratio with the book-spine shadow and corner radius specified in the ui-design.md steering.
3. IF the active Reading_Session has no stored cover reference, THEN THE Group_Reading_Room SHALL render a placeholder in place of the book cover that preserves the same 2:3 aspect ratio and card layout.
4. WHEN the Group_Reading_Room displays group readiness, THE Reading_Sync_App SHALL present each Member on a single shared horizontal progress track that spans from 0 percent to 100 percent, positioning each Member's circular avatar at the horizontal point corresponding to that Member's completed count as a percentage of the shared goal, and SHALL render a vertical dashed club-target marker at the horizontal point corresponding to the shared goal.
5. WHERE the Group_Reading_Room displays a progress number, THE Reading_Sync_App SHALL render that number using tabular numerals as specified in the ui-design.md steering.
6. WHEN the Group_Reading_Room is displayed, THE Reading_Sync_App SHALL present the quick progress update control as an inline stepper that increments the Member's progress in a single interaction without navigating away from the Group_Reading_Room.
7. WHEN the Group_Reading_Room is redesigned, THE Reading_Sync_App SHALL preserve all existing Group_Reading_Room behaviors, including copying the Invite_Code, completing and undoing progress, setting and clearing the reading goal, deleting and replacing the book, and displaying the per-member progress list.
8. WHILE the Group_Reading_Room is displayed, THE Reading_Sync_App SHALL apply the responsive Navigation_Rail widths and content column breakpoints specified in the ui-design.md steering and SHALL constrain content to a maximum width of 1440 pixels.
9. THE Reading_Sync_App SHALL restyle only the Group_Reading_Room in this slice and SHALL NOT require any other screen to be restyled for this slice to be complete.

### Requirement 14: Light, Dark, and System theme toggle

**User Story:** As a reader, I want a Light, Dark, and System theme toggle in the Navigation_Rail footer, so that I can control the appearance of the app including for late-night reading.

#### Acceptance Criteria

1. THE Navigation_Rail footer SHALL present a control that allows the user to select exactly one Theme_Preference from the set {Light, Dark, System}.
2. THE Navigation_Rail footer control SHALL visually indicate which one of the Light, Dark, and System options is currently selected.
3. WHEN the user selects a Theme_Preference of Light or Dark, THE Reading_Sync_App SHALL apply that theme's Design_Tokens within 200 milliseconds of the selection.
4. WHEN the user selects a Theme_Preference of System, THE Reading_Sync_App SHALL apply the Design_Tokens that match the operating system color scheme within 200 milliseconds of the selection.
5. WHILE the Theme_Preference is System and the operating system color scheme changes, THE Reading_Sync_App SHALL apply the Design_Tokens matching the new operating system color scheme within 1 second of the change and without requiring an application restart.
6. WHEN the user selects a Theme_Preference, THE Reading_Sync_App SHALL persist the selected Theme_Preference such that it is retained across application restarts.
7. IF persisting the selected Theme_Preference fails, THEN THE Reading_Sync_App SHALL retain and continue applying the currently applied Design_Tokens for the active session and present an indication to the user that the preference could not be saved.
8. WHEN the Reading_Sync_App starts and a Theme_Preference is persisted, THE Reading_Sync_App SHALL apply the persisted Theme_Preference.
9. WHEN the Reading_Sync_App starts and no Theme_Preference is persisted, THE Reading_Sync_App SHALL apply a Theme_Preference of System.
10. IF the persisted Theme_Preference is missing or is not one of {Light, Dark, System} when the Reading_Sync_App starts, THEN THE Reading_Sync_App SHALL apply a Theme_Preference of System.

### Requirement 15: Cross-platform titlebar safe areas and draggable header

**User Story:** As a desktop user, I want the app chrome to respect native window controls on macOS and Windows, so that controls never overlap the user interface and I can drag the window by its header.

#### Acceptance Criteria

1. WHERE the Reading_Sync_App runs on macOS, THE Reading_Sync_App SHALL reserve a macOS Titlebar_Safe_Area of exactly 76 pixels of left padding in both the top header and the Navigation_Rail such that no native traffic-light control overlaps any application user interface element.
2. WHERE the Reading_Sync_App runs on Windows, THE Reading_Sync_App SHALL reserve a Windows Titlebar_Safe_Area of exactly 136 pixels of right padding in the top bar such that no native window control overlaps any application user interface element.
3. WHERE the Reading_Sync_App runs on a platform other than macOS or Windows, THE Reading_Sync_App SHALL reserve 0 pixels of Titlebar_Safe_Area padding in the top header, top bar, and Navigation_Rail.
4. THE Reading_Sync_App SHALL mark each empty non-interactive region of the top header as draggable.
5. THE Reading_Sync_App SHALL mark each interactive control within the top header as non-draggable such that activating the control does not initiate a window drag.
6. WHEN the Group_Reading_Room is displayed on macOS, THE Reading_Sync_App SHALL apply the 76-pixel macOS Titlebar_Safe_Area left padding, and WHEN the Group_Reading_Room is displayed on Windows, THE Reading_Sync_App SHALL apply the 136-pixel Windows Titlebar_Safe_Area right padding.
