<div align="center">

# REVDEV

### **Plan‑Driven AI Pair Programmer with a Live Editor & In‑Browser Dev Server**

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-149eca?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript)](https://www.typescriptlang.org/)
[![Convex](https://img.shields.io/badge/Convex-realtime%20DB-ff6b6b)](https://convex.dev/)
[![Inngest](https://img.shields.io/badge/Inngest-agent%20kit-blue)](https://www.inngest.com/)
[![License](https://img.shields.io/badge/license-MIT-green)](#license)

REVDEV is an AI‑powered IDE in your browser. You describe what you want in
plain English, the agent writes a **plan**, ticks each step ✅ live as it
executes, streams every file character‑by‑character into a CodeMirror editor,
boots an in‑browser **WebContainer** to install dependencies and run the dev
server, and **auto‑detects build errors and fixes them** without you ever
leaving the page.

</div>

---

## ✨ Highlights

| | |
|---|---|
| 🧠 **Plan‑first agent** | The model first replies with a checklist of steps. Each step ticks ✅ in real time, failed steps go red with the error. No more guessing what the AI is doing. |
| ⌨️ **Live‑typed CodeMirror editor** | The right pane auto‑switches to the file currently being written, with characters streaming in like someone is typing. |
| 🌐 **In‑browser dev server** | A full Node.js sandbox runs inside the page via WebContainers. `npm install`, `npm run dev`, hot reload — all without ever leaving the tab. |
| 🪄 **Auto‑fix on build errors** | When the dev server prints `Failed to compile` or a `Module not found`, REVDEV automatically dispatches an `[AUTO‑FIX]` request to the agent, which plans → fixes → retries. |
| 🔁 **Self‑healing via Sentry** | Runtime exceptions in the agent itself get surfaced via Sentry; the agent reads the latest issue for the project, reasons about it, and fixes itself before retrying. |
| 🌏 **CN‑friendly out of the box** | DeepSeek as the default coding model + `registry.npmmirror.com` as the default WebContainer registry. Works on networks where OpenAI / public npm are throttled or blocked. |
| ↔️ **Tab keep‑alive** | Switching Code ↔ Preview is instant — the WebContainer keeps running in the background instead of re‑installing every visit. |

---

## 🏛️ Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              Browser (Next.js)                           │
│                                                                          │
│   ┌────────────────┐      ┌────────────────────┐    ┌─────────────────┐  │
│   │ Chat sidebar   │      │ CodeMirror editor  │    │ WebContainer    │  │
│   │ (plan, msgs)   │ ◀──▶ │ (live‑typed code)  │ ◀▶ │ npm i + dev     │  │
│   └────────┬───────┘      └─────────┬──────────┘    └────────┬────────┘  │
│            │                        │                        │           │
│            │   Convex realtime queries (files, plan, build status)       │
│            ▼                        ▼                        ▼           │
└─────────────────────────────────────┬────────────────────────────────────┘
                                      │
              ┌───────────────────────┼─────────────────────────┐
              ▼                       ▼                         ▼
       ┌─────────────┐         ┌────────────┐           ┌──────────────┐
       │ Convex DB   │         │  Inngest   │           │ Sentry       │
       │ projects/   │         │  agent kit │           │ issues +     │
       │ files/plans │ ◀─────▶ │  (DeepSeek │ ◀──────▶  │ source maps  │
       │ /messages   │         │   /OpenAI) │           │              │
       └─────────────┘         └────────────┘           └──────────────┘
```

**Key pieces**

- **`src/features/conversations/inngest/`** — the Inngest agent. `plan` tool drafts the checklist, `createFiles` / `updateFile` tools stream into the editor, `sentry` tool reads the latest issue for the active project.
- **`src/features/editor/components/streaming-editor.tsx`** — CodeMirror wrapper that watches `convex/editorStreams` and types in characters as they arrive.
- **`src/features/preview/hooks/use-webcontainer.ts`** — singleton WebContainer manager. Boots once per session, mounts files from Convex, runs install + dev, exposes `previewUrl` + `terminalOutput`.
- **`src/features/projects/components/preview-view.tsx`** — the Preview tab. Detects build errors in the terminal stream and auto‑dispatches an `[AUTO‑FIX]` chat message.
- **`convex/`** — schema + queries/mutations for `projects`, `files`, `plans`, `messages`, `editorStreams`, `buildChecks`.

---

## 🚀 Quick start

### Prerequisites

- **Node.js 20+** and **npm 10+**
- A free [Convex](https://convex.dev) account
- A free [Clerk](https://clerk.com) account
- An AI provider API key (one of):
  - **DeepSeek** — recommended in CN, fast + cheap, native tool calling
  - OpenAI / Anthropic / Google — work outside CN
- (Optional) [Sentry](https://sentry.io) for error reporting + AI self‑healing
- (Optional) [Firecrawl](https://www.firecrawl.dev/) for the URL‑scraping tool

### 1 · Clone & install

```bash
git clone https://github.com/AI4B-Team/Revdev.git
cd Revdev
npm install
```

### 2 · Configure environment

```bash
cp .env.example .env.local
# then open .env.local and fill in the blanks
```

The file is heavily commented; the absolute minimum to get a working app is:

```env
# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# Convex
NEXT_PUBLIC_CONVEX_URL=https://<your-deployment>.convex.cloud
NEXT_PUBLIC_CONVEX_SITE_URL=https://<your-deployment>.convex.site
CONVEX_DEPLOYMENT=dev:<your-deployment>

# AI provider (pick at least one)
DEEPSEEK_API_KEY=sk-...
# or: OPENAI_API_KEY=sk-...
```

### 3 · Run all three services

REVDEV needs the Next dev server, the Convex dev daemon, and the Inngest dev
server running side‑by‑side. The repo ships an Inngest CLI (`inngest.exe` on
Windows; install [the binary](https://github.com/inngest/inngest) on macOS /
Linux), and a single npm script runs everything:

```bash
npm run dev:all
```

This is `concurrently`‑driven, so all three logs are colour‑coded in one
terminal. Open <http://localhost:3000>.

If you ever get a port conflict (e.g. a previous run hung):

```bash
npm run dev:fresh   # kills 3000/3001/8288/50053 first, then restarts
```

> **Running on Replit?** See [`REPLIT_SETUP.md`](./REPLIT_SETUP.md) — the
> default Replit "Run" button only starts Next.js, but REVDEV needs Convex
> and Inngest running too, plus secrets configured in the Replit Secrets
> panel (not `.env.local`). Skipping that setup is why a bare clone "can't
> open any projects."
>
> **Going to production on Vercel?** See [`VERCEL_DEPLOY.md`](./VERCEL_DEPLOY.md)
> — a 10‑step launch checklist covering production Convex / Inngest / Clerk
> setup, the **build‑command override** that pushes Convex on every deploy,
> the Inngest production webhook, the Clerk → Convex JWT wiring, billing
> alerts, custom domain, and rollback procedure. Includes an env‑var matrix
> showing exactly which keys differ between dev and prod.

---



## 🔐 What goes in `.env.local` vs `.env.example`

`.env.example` is the **public template** — it lists every variable the app
reads, with comments. It's safe to commit.

`.env.local` is your **personal copy** with real keys. It is git‑ignored.
Do not commit it. Do not paste it into Slack. Do not check it into a zip.

---

## 🌏 Why DeepSeek + npmmirror by default?

REVDEV was developed and tested partly on a network in mainland China where
two things bit us repeatedly:

1. **`api.openai.com` was MITM'd** by the local middlebox, returning a cert
   for `*.ar.meta.com` and trashing every TLS handshake. DeepSeek (hosted in
   CN with native tool calling, 1M context, and a generous free tier) just
   works.
2. **`registry.npmjs.org` was throttled** to single‑digit kbps, so the
   in‑browser `npm install` would stall for 5–10 minutes. The default
   install command points WebContainer at `registry.npmmirror.com` — an
   exact mirror of the public registry, CDN‑fronted globally. Outside CN
   it's just as fast.

Both defaults are overrideable per project (see Project Settings → Install
Command) so non‑CN users can opt back into the public registry.

---

## 🧪 Try it

Inside the app:

1. Click **New Project**, type a prompt like *"Build a landing page with a
   hero section, three‑column features grid, and a footer"*, hit Enter.
2. Watch the chat sidebar — you'll see the **plan checklist** appear first,
   then steps tick ✅ as the agent works.
3. Watch the **right pane** — files are typed in live as they're written.
4. After the last step, the build status flips to ✅ and the UI **auto‑switches
   to the Preview tab**, where the in‑browser dev server is already starting.
5. Make an intentional typo by editing a file in the editor → switch to
   Preview → see the **auto‑fix banner** and a 4 s countdown before AI
   dispatches a fix request.

---

## 📁 Project layout

```
.
├── convex/                    # Convex schema + server functions
│   ├── schema.ts              # tables: projects, files, plans, messages, …
│   ├── projects.ts
│   ├── files.ts
│   ├── plans.ts               # plan checklist persistence
│   ├── editorStreams.ts       # live‑typed editor pipe
│   └── buildChecks.ts         # compile‑check status per project
│
├── src/
│   ├── app/                   # Next.js app router
│   │   ├── (landing)/         # marketing pages
│   │   ├── projects/          # project list + detail
│   │   ├── preview/           # /preview?url=… wrapper for WebContainer iframe
│   │   └── api/               # REST handlers (messages, suggestion, quick-edit)
│   │
│   ├── features/
│   │   ├── auth/              # Clerk integration
│   │   ├── conversations/     # chat sidebar + Inngest agent
│   │   │   ├── components/    # plan-checklist, activity-panel, …
│   │   │   └── inngest/       # the agent kit pipeline
│   │   │       ├── process-message.ts
│   │   │       └── tools/     # plan, createFiles, updateFile, sentry, …
│   │   ├── editor/            # CodeMirror live-typed editor
│   │   ├── preview/           # WebContainer + xterm + zip download
│   │   └── projects/          # project list, detail view, file explorer
│   │
│   ├── lib/                   # compile-check, sentry-api, utils
│   └── inngest/               # Inngest function registration
│
├── public/                    # static assets
├── scripts/                   # dev helpers (restart-dev.ps1, probe.ps1, …)
└── PLAN.md                    # phase-by-phase implementation roadmap
```

---

## 🛠️ Scripts cheat‑sheet

| Command | What it does |
|---|---|
| `npm run dev:all` | Run Next + Convex + Inngest concurrently (recommended) |
| `npm run dev` | Just the Next dev server (8 GB heap) |
| `npm run dev:next` | Same, explicit |
| `npm run dev:convex` | Just the Convex dev daemon |
| `npm run dev:inngest` | Just the Inngest dev server |
| `npm run dev:fresh` | Free up dev ports 3000/3001/8288/50053 then `dev:all` |
| `npm run clean:ports` | Kill anything listening on the dev ports |
| `npm run build` | Production Next build (also runs Convex codegen) |
| `npm run start` | Run the production build |
| `npm run lint` | ESLint |

---

## 🗺️ Roadmap

See [`PLAN.md`](./PLAN.md) for the full phase‑by‑phase blueprint. Highlights
of what's already shipped:

- ✅ **Phase A** — Sentry migrated, env var template, dev port cleanup
- ✅ **Phase B** — Plan tool, plan checklist UI, plan persistence in Convex
- ✅ **Phase C** — Live‑typed CodeMirror editor (`editorStreams` Convex pipe)
- ✅ **Phase D** — In‑browser WebContainer dev server with xterm terminal
- ✅ **Phase E** — Sentry tool: agent reads its own runtime errors
- ✅ **Phase F** — Compile‑check on every agent run, gates the Preview tab
- ✅ **Phase G** — Auto‑fix banner when the dev server prints a build error
- ✅ **Phase H** — Auto‑switch to Preview, clickable URL strip, /preview wrapper, tab keep‑alive

---

## 🤝 Contributing

Issues and PRs welcome. Please:

1. Fork → branch → PR against `main`.
2. Keep changes focused; one concern per PR.
3. Don't commit `.env.local`, `*.log`, `inngest.exe`, or zip archives —
   `.gitignore` already excludes them.
4. Run `npm run lint` before pushing.

---

## 🪪 License

MIT — see [`LICENSE`](./LICENSE) if present, otherwise this code is
distributed under the terms of the MIT License.

---

<div align="center">

Built with ❤️ by the AI4B Team — <https://github.com/AI4B-Team/Revdev>

</div>
