# Claude Handoff Plan: Make the Yoshi Dashboard Fully Functional

## Goal

Convert the existing React/Vite/Tailwind prototype into a production-capable application while preserving its current visual design and animations. Use Supabase for GitHub OAuth, authorization, Postgres data, Storage, and realtime messaging.

## Confirmed Product Decisions

- Backend: Supabase.
- Scope: every sidebar destination.
- Authentication: GitHub OAuth through Supabase Auth.
- Authorization: regular users plus administrators.
- Admin-only capabilities: create/edit/remove games and create/publish posts.
- Regular-user capabilities: view content, use messages, manage personal settings, and receive notifications.
- Game hosting: Supabase Storage; do not collect or store GitHub tokens in the browser.
- Messaging: real persisted conversations with Supabase Realtime updates.
- Design constraint: preserve the existing appearance, responsive behavior, animations, and local Figma assets.

## Current Repository Baseline

- React 19, Vite 8, TypeScript, Tailwind CSS v4.
- `src/App.tsx` currently contains the seven-page interactive prototype and shared sidebar.
- `src/index.css` contains the full visual system and responsive behavior.
- Figma assets are installed under `public/assets`.
- The project currently has no router, backend client, authentication, persistence, or tests.
- `pnpm build` currently succeeds.
- The development server is already supervised by Figma Make and must not be started manually.

## How to Give This to Claude

1. Give Claude Code access to this repository.
2. Create a Supabase project and connect it when Claude requests the project connection.
3. Paste the prompt in the **Claude Execution Prompt** section below.
4. Supply only these environment values through the environment/secret mechanism, never directly in source:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. In Supabase, enable the GitHub Auth provider and configure its GitHub OAuth application credentials in the Supabase dashboard.
6. Add local and production callback URLs in Supabase Auth URL Configuration. Claude should document the exact callback it implements.
7. After implementation, create the first user through GitHub sign-in and promote that user to `admin` using the Supabase SQL editor or a controlled bootstrap migration.

## Claude Execution Prompt

> Make the existing dashboard fully functional using Supabase, end to end. Preserve the current Figma-derived appearance, local assets, responsive behavior, and animations. Do not redesign the UI. Use GitHub OAuth through Supabase Auth. Add protected routes and role-based access: admins can create/edit/remove games and publish posts; regular users can view content, message other users, manage their own settings, and receive notifications. Use Supabase Storage for game HTML/build files, game images, and post banners. Remove the GitHub token field and replace it with a safe account/storage status row because secrets must not be stored client-side. Implement persisted realtime messages, persisted notifications, validation, loading states, error states, empty states, and success feedback. Create versioned Supabase migrations with tables, indexes, triggers where appropriate, RLS policies, and Storage policies. Generate/use typed database definitions. Keep service-role credentials out of the client. Refactor the monolithic component into focused pages/components/hooks without changing the visual result. Run the repository-prescribed verification commands and report migrations, environment variables, OAuth callback setup, admin bootstrap instructions, and any manual Supabase dashboard steps.

## Target Architecture

### Client modules

Refactor without changing visuals:

- `src/app/App.tsx`: application providers and route tree.
- `src/lib/supabase.ts`: one browser Supabase client using only URL and anon key.
- `src/lib/database.types.ts`: generated Supabase database types.
- `src/components/layout/AppShell.tsx`: sidebar and responsive page frame.
- `src/components/ui/*`: existing reusable controls such as action button, fields, file picker, toggle, toast, loading state, and confirmation dialog.
- `src/features/auth/*`: GitHub login, callback/session handling, sign-out, and access guards.
- `src/features/home/*`: notification list.
- `src/features/posts/*`: post editor and post preview/published content.
- `src/features/games/*`: add, edit, remove, and shared game form/upload logic.
- `src/features/messages/*`: conversation list, message timeline, composer, and realtime subscription.
- `src/features/settings/*`: personal notification preference and account/storage status.
- `src/hooks/*`: session/profile, toast, and realtime lifecycle hooks.

Use React Router so sidebar destinations have stable, refresh-safe paths:

- `/` or `/home`
- `/post`
- `/games/add`
- `/games/:gameId/edit`
- `/games/:gameId/remove`
- `/messages`
- `/messages/:conversationId`
- `/settings`
- `/auth/callback`

Protect routes by session and role. For non-admin users, hide admin-only navigation entries and also enforce authorization in route guards, RLS, and Storage policies. Client-side hiding alone is not security.

## Supabase Data Model

Create versioned migrations under `supabase/migrations`.

### Enums

- `app_role`: `admin`, `user`.
- `game_status`: `draft`, `published`, `archived`.
- `post_status`: `draft`, `published`.
- `notification_type`: `post_published`, `game_published`, `new_message`, `system`.

### `profiles`

- `id uuid primary key references auth.users(id) on delete cascade`
- `display_name text not null`
- `avatar_url text`
- `role app_role not null default 'user'`
- `notifications_enabled boolean not null default true`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Create a safe `auth.users` insert trigger that initializes a profile from GitHub metadata. Do not allow users to update their own role.

### `games`

- `id uuid primary key default gen_random_uuid()`
- `name text not null`
- `slug text unique not null`
- `description text`
- `game_file_path text not null`
- `image_path text not null`
- `status game_status not null default 'draft'`
- `created_by uuid not null references profiles(id)`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `published_at timestamptz`

Validate slugs and prevent duplicate names/slugs. Store Storage object paths, not expiring signed URLs.

### `posts`

- `id uuid primary key default gen_random_uuid()`
- `title text not null`
- `body text not null`
- `banner_path text not null`
- `status post_status not null default 'draft'`
- `created_by uuid not null references profiles(id)`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `published_at timestamptz`

### `conversations`

- `id uuid primary key default gen_random_uuid()`
- `title text`
- `is_group boolean not null default false`
- `created_by uuid not null references profiles(id)`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

### `conversation_members`

- `conversation_id uuid references conversations(id) on delete cascade`
- `user_id uuid references profiles(id) on delete cascade`
- `joined_at timestamptz not null default now()`
- Composite primary key on `(conversation_id, user_id)`.

### `messages`

- `id uuid primary key default gen_random_uuid()`
- `conversation_id uuid not null references conversations(id) on delete cascade`
- `sender_id uuid not null references profiles(id)`
- `body text not null`
- `created_at timestamptz not null default now()`
- Optional `edited_at timestamptz` for future edits.

Add an index on `(conversation_id, created_at)`.

### `notifications`

- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references profiles(id) on delete cascade`
- `type notification_type not null`
- `title text not null`
- `body text`
- `entity_type text`
- `entity_id uuid`
- `read_at timestamptz`
- `created_at timestamptz not null default now()`

Add indexes on `(user_id, created_at desc)` and unread queries. Generate post/game notifications when an admin publishes content. Generate message notifications only for conversation members other than the sender and only when their preference permits it.

## Authorization and RLS

Create a stable SQL helper such as `public.is_admin()` that checks the authenticated user’s profile role without allowing recursive policy failures.

Policies must enforce:

- Profiles: authenticated users can read profiles required for messaging; users can update only their own permitted fields; only admins can change roles.
- Games: authenticated users can read published games; admins can read drafts and insert/update/archive/delete.
- Posts: authenticated users can read published posts; admins can read drafts and insert/update/delete/publish.
- Conversations/members/messages: only members can read a conversation and its messages; only members can send messages; sender identity must equal `auth.uid()`.
- Notifications: users can read/update/delete only their own notifications.
- Never put a Supabase service-role key in Vite environment variables or browser code.

## Storage

Create buckets through migrations or documented dashboard setup:

- `game-builds`: stores uploaded HTML or zipped game builds.
- `game-images`: stores game artwork.
- `post-banners`: stores announcement banners.

Recommended access model:

- Authenticated users can read published assets.
- Only admins can upload, replace, or delete objects.
- Object paths include a stable entity ID, for example `games/<game-id>/index.html` and `games/<game-id>/cover.<ext>`.
- Validate file extension, MIME type, and size in the client before upload.
- Render uploaded HTML on the Supabase Storage origin in a sandboxed iframe if a playable preview is added. Do not inject uploaded HTML into the dashboard DOM.

Upload transaction behavior:

1. Validate form and files.
2. Create or reserve the database entity ID.
3. Upload files to deterministic paths.
4. Save object paths and metadata to the database.
5. On failure, report the exact stage and best-effort clean up newly uploaded objects.
6. For replacements, persist the new object/database state before deleting the old object.
7. Disable duplicate submissions while work is in progress.

Deletion should require a confirmation dialog. Prefer archiving records first unless permanent deletion is explicitly selected. If permanently deleting, remove database references and Storage objects with clear partial-failure reporting.

## Page Behavior

### Authentication

- Unauthenticated users see a design-matched GitHub sign-in screen.
- `signInWithOAuth({ provider: 'github' })` redirects through `/auth/callback`.
- Restore sessions on refresh and listen for auth changes.
- Show a recoverable error when OAuth is cancelled or callback exchange fails.
- Provide sign-out in Settings.

### Home

- Replace skeleton-only notifications with database-backed records.
- Keep skeletons as loading states.
- Clicking a notification marks it read and navigates to the related entity when possible.
- Provide mark-one and mark-all-read behavior.
- Subscribe to relevant notification inserts so the sidebar badge updates without refresh.

### Post

- Admin only.
- Banner picker uploads to `post-banners` and previews the local selection before upload.
- Title/body update the preview live.
- Save draft and publish actions are separate even if the primary visual action remains the existing Upload button.
- Validate title, body, and banner.
- Publishing creates notifications for eligible users.

### Add Game

- Admin only.
- Accept either a game file upload or an external game URL, but not both.
- Accept either an image upload or external image URL, but not both.
- If external URLs remain supported, validate HTTPS URLs and store them in explicit nullable URL columns added to `games`; do not overload Storage path columns.
- Show real per-stage upload progress and errors.
- Save as draft or publish.

### Edit Game

- Admin only.
- Load the selected game into the form.
- Preserve existing files when no replacement is selected.
- Update metadata and replace assets safely.
- Handle stale/deleted records and unauthorized access.

### Remove Game

- Admin only.
- Load a real game selection.
- Require explicit confirmation that includes the selected game name.
- Default to archive. Permanent deletion requires a second, stronger confirmation.
- Clear selection and navigate after success.

### Messages

- List conversations in updated order.
- Load paginated messages oldest-to-newest within the active conversation.
- Subscribe to message inserts for the active conversation and avoid duplicates between optimistic and realtime messages.
- Composer trims text, rejects empty messages, disables during submission, and supports Enter to send plus Shift+Enter for a newline if converted to a textarea.
- Autoscroll only when the user is already near the bottom; do not yank someone reading history.
- Show sending, sent, and failed/retry states.
- Dispose old channels when switching conversations or unmounting.

### Settings

- Persist `notifications_enabled` to the current profile.
- Theme can remain locally persisted in `localStorage` unless cross-device theme sync is desired later.
- Replace the GitHub Token row with a safe read-only row such as `Storage: Supabase connected` or `Account: Connected with GitHub`.
- Add sign-out.
- Never accept, display, or persist a personal access token.

## Error, Loading, and Empty States

Every asynchronous view must distinguish:

- Initial loading.
- Empty result.
- Permission denied.
- Network/backend failure with retry.
- Successful mutation.
- Partial upload/delete failure where cleanup may be needed.

Use the existing toast style for transient feedback and inline messages for errors that require user action. Keep controls keyboard accessible, retain visible focus indicators, label icon-only buttons, and respect `prefers-reduced-motion`.

## Implementation Order

1. Install only required dependencies: Supabase JS client and React Router; add a lightweight form/schema library only if it materially reduces validation complexity.
2. Add environment typing and the singleton Supabase client.
3. Create database migrations, enums, tables, indexes, triggers, RLS, and Storage policies.
4. Generate database TypeScript types.
5. Implement GitHub OAuth, callback handling, profile bootstrap, and session provider.
6. Add router, authenticated shell, role guards, and role-aware sidebar.
7. Refactor current visual components without changing their rendered design.
8. Implement Settings/profile persistence and sign-out to validate the auth/data path.
9. Implement games and Storage upload lifecycle.
10. Implement posts, banner storage, and publication notifications.
11. Implement notifications page and realtime badge updates.
12. Implement conversations, messages, pagination, optimistic sends, and realtime subscriptions.
13. Add resilient loading/error/empty states and accessibility checks.
14. Verify all role boundaries manually and through policy tests.

## Verification Strategy

### Automated

- Run `pnpm build` and require a zero exit code.
- Run the repository formatter using its existing script and verify no unintended files changed.
- Add focused tests if a test framework is introduced; do not add a large framework solely for superficial coverage.
- Run Supabase migration reset in a local/test project if the Supabase CLI is configured.
- Add SQL policy tests or scripted checks for admin, regular user, conversation member, non-member, and anonymous access.

### Manual acceptance matrix

Test with at least two GitHub users: one admin and one regular user.

- Both can sign in, refresh, restore sessions, and sign out.
- Regular users cannot see or directly open admin routes.
- Direct client attempts by regular users to mutate posts/games fail under RLS.
- Admin can create, edit, publish/archive, and remove a game with real Storage objects.
- Admin can publish a post with a banner.
- Regular user receives resulting notifications and can mark them read.
- Two users can exchange messages in realtime in the same conversation.
- A non-member cannot read or insert messages in another conversation.
- Notification preference persists and suppresses future generated notifications where intended.
- Theme choice persists locally.
- No secret or service-role key appears in source, built assets, logs, or browser storage.
- Desktop and narrow layouts preserve the current design and remain keyboard usable.
- Existing local Figma assets remain local; no expiring Figma asset URLs are introduced.

## Completion Report Claude Should Return

- Summary of implemented functionality by page.
- List of migrations and Storage buckets.
- Environment variable names only, with no values.
- GitHub OAuth callback/configuration instructions.
- Exact admin bootstrap procedure.
- Verification commands and their real results.
- Any dashboard steps that could not be automated.
- Known limitations or follow-up work, especially around uploaded game formats and permanent deletion cleanup.
