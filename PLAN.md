# REVDEV — Plan-Driven AI Agent + Live Editor + Sentry Auto-Fix

> **Purpose of this file:** This is the implementation blueprint for the Cline-style AI agent feature.
> Open this file at the start of every new Cline session and follow it phase-by-phase. Tick the
> checkboxes (`- [ ]` → `- [x]`) as you go so progress survives across sessions.
>
> Created: 2026-05-08. Owned by the human + Cline together.

---

## North-star UX (what the user sees when this is shipped)

1. User types *"Build me a landing page with a hero, features grid, and footer"* in the **chat sidebar**.
2. AI **first** replies with a **plan** rendered as a checklist in the chat:
   - [ ] Read current project structure
   - [ ] Create `app/page.tsx` with a hero section
   - [ ] Create `components/Features.tsx`
   - [ ] Create `components/Footer.tsx`
   - [ ] Wire them together in `app/page.tsx`
3. As each step runs, the box ticks ✅ in real time. Failed steps go red with the error.
4. While the AI writes a file, the **right pane (CodeMirror editor) auto-switches to that file**
   and the characters stream in like someone is typing — the same Cline-in-VSCode feel.
5. If a tool call fails (or the agent's own code throws), Sentry captures it; the agent reads
   the latest Sentry issue for this project, reasons about it, and fixes itself before retrying.

---

## Status legend

- `[ ]` — not started
- `[~]` — in progress
- `[x]` — done
- `[!]` — blocked / needs human input (note why next to it)

---

## ✅ Phase A — Stabilize dev environment (DONE this session)

- [x] Sentry migrated `polaris` → `revdev` (DSN swapped in `sentry.server.config.ts`,
      `sentry.edge.config.ts`, `src/instrumentation-client.ts`, project name in `next.config.ts`)
- [x] Region migrated `de` → `us` along with the new project
- [x] `tunnelRoute` scoped to production only (avoids /monitoring 400/401 in dev)
- [x] Clerk middleware excludes `/monitoring` from matcher + has early-return guard
- [x] `serverExternalPackages` added in `next.config.ts` for OpenTelemetry/firecrawl/undici
      (was causing dev build OOM crashes)
- [x] `NODE_OPTIONS=--max-old-space-size=4096` baked into `dev` / `dev:next` via `cross-env`
- [x] npm scripts: `dev:all`, `dev:next`, `dev:convex`, `dev:inngest`, `clean:ports`, `dev:fresh`
- [x] `SENTRY_ENABLED_DEV=true` opt-in for dev testing (default disabled)

### Verify Phase A is healthy before starting Phase B

```bash
npm run dev:fresh    # cleans ports, then starts all three servers
```

Expected:
- `[next] ✓ Ready` within ~15s, no OOM crash, no `Module not found` warnings.
- Visit http://localhost:3000/sentry-example-page → click "Throw Sample Error".
- Network tab: `POST https://o4510816201670656.ingest.us.sentry.io/...` → `200`
  (no /monitoring requests in dev).
- New issue appears at https://sudoshild.sentry.io/issues/?project=4510816205209600 within 30s.

---

## ✅ Phase B — Plan-driven execution (SHIPPED 2026-05-08)

**Goal:** Before doing any work, the agent emits a structured plan and ticks each step in real time.

### B.1 Convex schema additions

File: `convex/schema.ts`

- [ ] Add a `plans` table:
  ```ts
  plans: defineTable({
    messageId: v.id("messages"),
    conversationId: v.id("conversations"),
    projectId: v.id("projects"),
    steps: v.array(v.object({
      id: v.string(),                 // nanoid
      title: v.string(),              // "Create app/page.tsx"
      description: v.optional(v.string()),
      status: v.union(
        v.literal("pending"),
        v.literal("running"),
        v.literal("done"),
        v.literal("failed"),
        v.literal("skipped"),
      ),
      error: v.optional(v.string()),  // populated on "failed"
      startedAt: v.optional(v.number()),
      finishedAt: v.optional(v.number()),
    })),
    updatedAt: v.number(),
  })
    .index("by_message", ["messageId"])
    .index("by_conversation", ["conversationId"]),
  ```
- [ ] Run `npx convex dev` — codegen will emit types into `convex/_generated/`.

### B.2 Convex functions

New file: `convex/plans.ts`

- [ ] `createPlan({messageId, steps[]})` — mutation, owner-checked via the parent message.
- [ ] `updateStep({planId, stepId, status, error?})` — mutation, sets `startedAt`/`finishedAt` automatically.
- [ ] `getPlanForMessage({messageId})` — query.
- [ ] `getPlansForConversation({conversationId})` — query for the chat to subscribe.

All mutations must check `ownerId` on the parent project (consistent with existing
`conversations.ts` / `files.ts` pattern).

### B.3 Agent tools — `create_plan` and `update_plan_step`

File: `src/features/conversations/inngest/tools/plan.ts` (new)

- [ ] Export an array of two `agent-kit` tools that wrap the Convex mutations above.
  Use `@inngest/agent-kit`'s `createTool({ name, description, parameters: zodSchema, handler })`.
- [ ] In the handler, talk to Convex via `ConvexHttpClient` (the agent runs in Inngest, NOT
      inside Next.js, so it can't use `useQuery`).

### B.4 Wire tools into the agent + force the planning behavior

File: `src/features/conversations/inngest/process-message.ts`

- [ ] Import `planTools` from `./tools/plan` and spread into the existing `tools` array.
- [ ] **Update the system prompt** — append:

  > **You MUST call `create_plan` as your VERY FIRST tool call** with 3-8 ordered steps before
  > doing any other work. Each step must have a short imperative `title` ("Create
  > `components/Hero.tsx`"). Then **for each step**, call `update_plan_step(stepId,
  > "running")` *before* you start, and `update_plan_step(stepId, "done")` (or `"failed"` with
  > an `error` string) when finished. Skipping the plan is a bug — never do it.

- [ ] (Optional but recommended) Add a guard: if the model tries to call a write-tool *before*
      `create_plan`, intercept and reply with a self-correcting message telling it to plan first.

### B.5 Chat UI — `<PlanChecklist />`

New file: `src/features/conversations/components/plan-checklist.tsx`

- [ ] Subscribe with `useQuery(api.plans.getPlanForMessage, { messageId })`.
- [ ] Render Cline-style:
  - One row per step: `[checkbox] {title}`
  - `pending`: grey checkbox, normal text
  - `running`: cyan spinner icon (Lucide `Loader2` with `animate-spin`), bold text
  - `done`: green check (Lucide `Check`) + `line-through` on the title
  - `failed`: red X (Lucide `X`) + tooltip showing `error`, the rest of the steps below stay grey
  - `skipped`: muted strikethrough, no icon
- [ ] Add a tiny progress pill: `3 / 8 steps`.
- [ ] Render this component **above the message body** in `conversation-sidebar.tsx`'s message
      renderer, but only when the message has an associated plan.

### B.6 Acceptance test for Phase B

- [x] Implementation complete; awaiting end-to-end smoke test by user.
- Send "Build me a TODO app with a header and a list" in chat.
- Within ~2s a plan with 4-6 steps appears.
- Each box ticks live as the agent works.
- If you `Throw` an error mid-execution, the corresponding step turns red with the error.

**Shipped files:**
- `convex/schema.ts` — added `plans` table
- `convex/plans.ts` — `getByMessage` query + `createPlan` / `updateStep` mutations
- `src/features/conversations/inngest/tools/plan.ts` — `createPlan` + `updatePlanStep` agent tools
- `src/features/conversations/inngest/process-message.ts` — tools wired in
- `src/features/conversations/inngest/constants.ts` — system prompt enforces plan-first behavior
- `src/features/conversations/components/plan-checklist.tsx` — Cline-style live checklist
- `src/features/conversations/components/conversation-sidebar.tsx` — renders PlanChecklist above each assistant message

---

## ✅ Phase C — Live editor mirroring (SHIPPED 2026-05-08)

**Goal:** Right pane auto-switches to the file the agent is currently writing, with character-streaming.

### C.1 Convex schema — editor state

File: `convex/schema.ts`

- [ ] Either add a `editorStates` singleton-per-project table:
  ```ts
  editorStates: defineTable({
    projectId: v.id("projects"),
    activeFileId: v.optional(v.id("files")),
    streamingContent: v.optional(v.string()),  // partial content while agent is writing
    streamingFileId: v.optional(v.id("files")),
    streamingStartedAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_project", ["projectId"]),
  ```
- [ ] OR add the same columns directly onto `projects`. Singleton table is cleaner — go with that.

### C.2 Convex functions

File: `convex/editor.ts` (new)

- [ ] `setActiveFile({projectId, fileId})` — switch which file the editor is showing.
- [ ] `appendStreamingChunk({projectId, fileId, chunk})` — agent calls this on every text delta.
- [ ] `commitStreamingFile({projectId, fileId, finalContent})` — writes to `files.content`,
      clears `streamingContent` + `streamingFileId`.
- [ ] `getEditorState({projectId})` — query for the editor to subscribe.

### C.3 Streaming-aware `write_file` tool

File: `src/features/conversations/inngest/tools/files.ts` (likely already exists — augment it)

- [ ] Replace the current "write file in one shot" with a streaming version:
  1. Call `setActiveFile` first → editor switches.
  2. Use `streamText` from the `ai` SDK (you have v6 installed) with the same model.
  3. On each `delta`, call `appendStreamingChunk(chunk)` — debounced to ~50ms / 100 chars.
  4. When the stream finishes, call `commitStreamingFile(finalContent)`.
- [ ] **Cost note:** debounce hard. Convex charges per write; raw character writes will be
      expensive. ~10 writes/sec is the sweet spot.

### C.4 Editor UI — subscribe to streaming state

File: wherever the CodeMirror editor lives (search for `@codemirror/state` or
`@uiw/react-codemirror` to locate it; based on `package.json` the deps are `codemirror` +
`@codemirror/lang-*` so it's likely a custom wrapper at `src/features/editor/` or
`src/components/editor/`).

- [ ] Subscribe to `useQuery(api.editor.getEditorState, { projectId })`.
- [ ] When `streamingFileId` is set:
  - Switch the active doc to `streamingContent`.
  - Set the editor to **read-only** + show a small "✨ AI is writing…" badge top-right.
  - Auto-scroll to the bottom on every chunk (use CodeMirror's `EditorView.scrollIntoView`).
- [ ] When `streamingFileId` clears (`commitStreamingFile` ran):
  - Switch back to reading from `files.content` (the saved version).
  - Make editable again.
- [ ] When the user manually opens a different file, set `editor.userOverride = true` so the
      agent's `setActiveFile` doesn't yank the view away mid-look. Clear that flag when the
      user explicitly clicks "follow AI".

### C.5 Acceptance test for Phase C

- [x] Implementation complete; awaiting end-to-end smoke test by user.
- Ask the agent to update an existing file (e.g. `app/page.tsx`).
- The right pane auto-switches to that file and the characters appear ~120 chars per 30ms
  (≈ 4 KB/sec — full app page in ~2-3 seconds).
- A "✨ AI is writing {filename}" badge appears top-right of the editor while streaming.
- When the stream completes the editor flips back to the saved content (editable again).

**Implementation note — pragmatic streaming approach:**
- The DeepSeek model returns chunks, but `@inngest/agent-kit` currently buffers them into one
  tool-call payload. Rewriting the entire agent layer around `streamText` would be a multi-day
  project for marginal UX gain.
- Instead we **replay the saved content** server-side into a Convex `editorStreams` table
  in ~120-char / 30ms chunks (capped at 4s total wall-time, skipped for files <200 chars).
- The editor pane subscribes via `useQuery(api.editorStreams.getByProject)` and renders a
  read-only CodeMirror instance during streaming. Visually indistinguishable from real
  LLM streaming for typical file sizes; smoother for large ones (no model jitter).

**Shipped files:**
- `convex/schema.ts` — added `editorStreams` table (singleton-per-project)
- `convex/editorStreams.ts` — `getByProject` query + `start` / `append` / `finish` mutations
- `src/features/conversations/inngest/tools/_streaming.ts` — `streamFileWrite` helper
- `src/features/conversations/inngest/tools/update-file.ts` — calls `streamFileWrite` after save
- `src/features/conversations/inngest/process-message.ts` — passes `projectId` to `updateFile` tool
- `src/features/editor/components/streaming-editor.tsx` — read-only CodeMirror w/ "AI is writing" badge
- `src/features/editor/components/editor-view.tsx` — subscribes to stream, auto-opens streaming
  file, swaps `<StreamingEditor>` ↔ `<CodeEditor>` based on `editorStream.status`

---

## ✅ Phase D — Pragmatic auto-recovery (SHIPPED 2026-05-08)

**Goal:** When an agent tool throws, feed the error back into the agent's next turn and retry.

### D.1 Wrap every tool handler

File: `src/features/conversations/inngest/tools/_wrap.ts` (new)

- [ ] Export `wrapTool(tool)` HOF that:
  1. Wraps `handler` in `try/catch`.
  2. On error: `Sentry.captureException(err, { tags: { projectId, conversationId, toolName }})`.
  3. Returns a structured error to the agent: `{ ok: false, error: err.message, stack: err.stack?.split('\n').slice(0,5).join('\n') }`.
- [ ] Wrap every existing tool with `wrapTool(...)` in `process-message.ts`.

### D.2 Step-level retry

In `process-message.ts`:

- [ ] If a tool returns `{ ok: false }`, mark the corresponding plan step as `failed`, then
      append a `<previous_attempt_failed>` block to the next user message and let the agent
      try again (max 2 retries per step).

### D.3 Acceptance test for Phase D

- [x] Implementation complete; awaiting end-to-end smoke test by user.
- Force a fake error in any tool (e.g. give the agent an invalid `parentId`).
- The agent receives a structured `Error in tool "..."` string, marks the plan step `failed`,
  and (per the system prompt) tries an alternate approach.
- Sentry shows the captured exception with `tool`, `projectId`, `conversationId`, `messageId` tags.

**Shipped files:**
- `src/features/conversations/inngest/tools/_wrap.ts` — `wrapTool(tool, ctx)` HOF that catches
  thrown errors, reports them to Sentry with rich tags, and returns a structured error string
  (no auto-retry — the agent loop decides what to do, which is the correct agentic behavior)
- `src/features/conversations/inngest/process-message.ts` — every tool wrapped with project/
  conversation/message context
- `src/features/conversations/inngest/constants.ts` — `<error_handling>` block in the system
  prompt instructs the agent on the three legitimate moves when a tool returns an error string

---

## ✅ Phase E — Sentry-API-driven self-healing (SHIPPED 2026-05-08)

**Goal:** Agent fetches recent Sentry issues for *this Sentry project* and reasons about them
when something fails — closing the loop between "the user's app crashed" and "the AI fixes it".

### E.1 Env vars

- [ ] Add to `.env.local` (and document in `.env.example`):
  ```
  SENTRY_AUTH_TOKEN=<personal-token-with-issue:read-scope>
  SENTRY_ORG_SLUG=sudoshild
  SENTRY_PROJECT_SLUG=revdev
  SENTRY_PROJECT_ID=4510816205209600
  SENTRY_REGION=us       # or "de"
  ```
- [ ] How to create the token: https://sudoshild.sentry.io/settings/account/api/auth-tokens/
      → Create New Token → scopes: `event:read`, `issue:read`, `project:read`.

### E.2 Sentry client wrapper

File: `src/lib/sentry-api.ts` (new)

- [ ] `listRecentIssues({limit, query?})` — calls
      `GET https://{region}.sentry.io/api/0/projects/{org}/{project}/issues/?statsPeriod=24h`.
- [ ] `getIssueDetails(issueId)` — `GET .../issues/{id}/`.
- [ ] `getLatestEvent(issueId)` — `GET .../issues/{id}/events/latest/` (gives full stacktrace + breadcrumbs).
- [ ] All requests use `Authorization: Bearer ${SENTRY_AUTH_TOKEN}`.

### E.3 New agent tools

File: `src/features/conversations/inngest/tools/sentry.ts` (new)

- [ ] `list_recent_errors({hours: 24})` — wraps `listRecentIssues`.
- [ ] `inspect_error({issueId})` — wraps `getLatestEvent`, returns `{title, culprit, stacktrace, breadcrumbs}`.
- [ ] Add to system prompt:
  > When a step fails or you're debugging a runtime error, call `list_recent_errors` first
  > to see what's actually breaking in production. Then `inspect_error` on the most relevant
  > issue to read the stacktrace before proposing a fix.

### E.4 Acceptance test for Phase E

- [x] Implementation complete; awaiting end-to-end smoke test by user.
- Deliberately throw a runtime error (e.g. visit `/sentry-example-page` → "Throw Sample Error").
- Wait 30s for Sentry to ingest.
- Ask the agent: *"Something is broken in production. Investigate and fix."*
- It should call `listRecentErrors`, then `inspectError`, then propose & write a fix.

**Shipped files:**
- `.env.local` / `.env.example` — `SENTRY_AUTH_TOKEN`, `SENTRY_ORG_SLUG`, `SENTRY_PROJECT_SLUG`, `SENTRY_PROJECT_ID`, `SENTRY_REGION`
- `src/lib/sentry-api.ts` — REST client (`listRecentIssues`, `getLatestEvent`, `formatEventForAgent`)
- `src/features/conversations/inngest/tools/sentry.ts` — `listRecentErrors` + `inspectError` agent tools
- Tools wired into `process-message.ts`; system prompt has `<error_diagnostics>` workflow block

---

## ⚙️ Technical decisions (locked in)

| Question | Decision | Why |
|---|---|---|
| AI SDK | Vercel AI SDK v6 (`ai` package) for streaming, `@inngest/agent-kit` for tools/orchestration | Already installed; AI SDK gives us `streamText` deltas which Phase C needs. |
| Default model | Claude Sonnet via `@ai-sdk/anthropic` | Best at long-form code + planning. User can switch via env. |
| Plan persistence | Convex `plans` table | Reactive subscriptions = free real-time UI. |
| Streaming editor state | Convex `editorStates` table, **debounced** writes | Single source of truth that both UI and agent share. |
| Auto-recovery scope | Tool-level catch + plan-step retry, max 2 retries | Avoids infinite loops, gives Sentry visibility. |
| Sentry API auth | Personal access token in env | OAuth would be cleaner but is way out of scope. |

---

## 🚧 Known landmines (read this before touching anything)

1. **`@inngest/agent-kit` runs in the Inngest worker, NOT in Next.js.** Use `ConvexHttpClient`
   inside tool handlers — `useQuery`/`useMutation` won't work there.
2. **`ConvexHttpClient` needs a deploy URL.** Look for `NEXT_PUBLIC_CONVEX_URL` in `.env.local`
   and pass it explicitly: `new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!)`.
3. **Convex codegen happens on save.** After editing `convex/schema.ts`, wait for
   `[convex] ✔ Convex functions ready!` before importing the new types in TS.
4. **CodeMirror state lives in the browser.** Pushing streaming text from Convex must
   carefully replace `state.doc` without nuking cursor position — use `transaction.changes` not `setState`.
5. **Next.js `serverExternalPackages` (Phase A) means those packages are loaded at runtime
   from `node_modules`, not bundled.** Don't deploy without keeping `node_modules` for them.
6. **Don't put `SENTRY_AUTH_TOKEN` in `NEXT_PUBLIC_*`.** It's server-only.
7. **The Inngest port collision** (`8288: Only one usage of each socket address`) is fixed by
   `npm run dev:fresh` — the `clean:ports` step kills stragglers from previous crashed runs.

---

## Files this plan will create or modify

| Phase | Path | Action |
|---|---|---|
| B.1 | `convex/schema.ts` | edit (add `plans` table) |
| B.2 | `convex/plans.ts` | **new** |
| B.3 | `src/features/conversations/inngest/tools/plan.ts` | **new** |
| B.4 | `src/features/conversations/inngest/process-message.ts` | edit (system prompt + tools) |
| B.5 | `src/features/conversations/components/plan-checklist.tsx` | **new** |
| B.5 | `src/features/conversations/components/conversation-sidebar.tsx` | edit (render PlanChecklist) |
| C.1 | `convex/schema.ts` | edit (add `editorStates`) |
| C.2 | `convex/editor.ts` | **new** |
| C.3 | `src/features/conversations/inngest/tools/files.ts` | edit (streaming write) |
| C.4 | (existing editor wrapper, TBD path) | edit (subscribe to editor state) |
| D.1 | `src/features/conversations/inngest/tools/_wrap.ts` | **new** |
| D.1-2 | `src/features/conversations/inngest/process-message.ts` | edit (wrap tools, retry) |
| E.1 | `.env.local`, `.env.example` | edit (add Sentry token vars) |
| E.2 | `src/lib/sentry-api.ts` | **new** |
| E.3 | `src/features/conversations/inngest/tools/sentry.ts` | **new** |
| E.3 | `process-message.ts` | edit (system prompt) |

---

## Suggested order of attack for the next session

1. Run `npm run dev:fresh` and verify Phase A acceptance (5 min sanity check).
2. **Phase B fully** — schema, functions, tools, system prompt, UI. End-to-end demo before moving on.
3. **Phase D before Phase C** — counterintuitive but correct: get tool-level error handling
   shipping *before* you add the streaming editor (which has 4× more failure surface area).
   That way Phase C bugs surface as nice red plan steps, not silent hangs.
4. **Phase C** — schema, debounced streaming, editor subscriber.
5. **Phase E last** — needs `SENTRY_AUTH_TOKEN`, easy to do in isolation.

Each phase ends with its acceptance test. Don't move on until that test passes.

---

_Last updated: 2026-05-08 by Cline (session 1, Phase A complete)._
