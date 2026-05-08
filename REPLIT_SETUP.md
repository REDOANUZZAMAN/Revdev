# 🟢 Running REVDEV on Replit — The Complete Guide

REVDEV is a multi‑service app: **Next.js + Convex + Inngest + Clerk**. Replit
can run all of it, but the default green **Run** button only starts Next.js
— so a fresh clone always looks broken until you wire up the other services.
This guide is the full path from "I just clicked Import from GitHub" to a
working app where you can create a project from a prompt.

> **All 6 known symptoms this guide fixes**
>
> 1. *"I cloned the repo to Replit but it can't open any projects."*
> 2. *"The project list is empty even after I create one."*
> 3. *"Clicking 'New Project' spins forever."*
> 4. *Browser console:* `Could not find public function for 'projects:getPartial'. Did you forget to run npx convex dev?`
> 5. *Browser console:* `Could not find public function for 'chat:list'` (same family — old bundle, hard reload).
> 6. *Convex push fails:* `Document with ID ... in table "conversations" does not match the schema: Object is missing the required field 'updatedAt'`.

---

## ⏱️ TL;DR — the 6 commands

If you're impatient, here's the whole guide compressed. Open **3 shell tabs**
in Replit and run one of these in each, then add secrets in the side panel:

```bash
# Tab 1 — Convex backend (must stay running)
npx convex dev

# Tab 2 — Inngest agent runner (must stay running)
npm i -g inngest-cli && inngest-cli dev

# Tab 3 — Next.js app (or just hit Replit's green Run button)
npm install
npm run dev
```

Plus secrets in **Tools → Secrets** (next section). If any of those steps is
missing or the daemon exits, the app breaks. Read on for the why and the
recovery steps.

---

## 0 · Before you start — fork or import the repo

In Replit, click **+ Create Repl → Import from GitHub** and paste:

```
https://github.com/AI4B-Team/Revdev
```

Replit will detect it's a Node.js project and run `npm install`
automatically. **Wait for that to finish** — `package-lock.json` has 1 200+
packages and it takes a few minutes on cold start. If you start typing
commands in the shell while install is still running, weird things happen.

When it's done you'll see `node_modules` populated and the green Run button
becomes clickable.

---

## 1 · Add secrets in **Tools → Secrets** (NOT in `.env.local`)

Replit's Secrets panel is the only place env vars are reliably injected into
both the dev server **and** the shell. **Do not** create a `.env.local` file
by hand — `.gitignore` will swallow it on the next push, your secrets won't
survive a fork, and worse, anyone who clones your fork will pull them out.

Open **Tools → Secrets** (left sidebar, the 🔒 icon) and click "+ New
Secret" for each row below.

### 1a · Clerk (auth) — get keys at <https://dashboard.clerk.com/>

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY    = pk_test_...
CLERK_SECRET_KEY                     = sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL        = /sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL        = /sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL = /projects
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL = /projects
```

> **NB:** earlier docs used `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` — Clerk
> renamed those to `…_FALLBACK_REDIRECT_URL`. The old names still work but
> log a deprecation warning. Use the new names.

In your Clerk dashboard → **API Keys**, copy "Publishable key" (the
`pk_test_…`) and "Secret key" (the `sk_test_…`). Free tier is fine.

### 1b · Convex (database) — get URL via the CLI in step 2

You can leave these blank for now; step 2 will fill them in:

```
NEXT_PUBLIC_CONVEX_URL          = (filled by `npx convex dev`)
NEXT_PUBLIC_CONVEX_SITE_URL     = (filled by `npx convex dev`)
CONVEX_DEPLOYMENT               = (filled by `npx convex dev`)
```

### 1c · AI provider — pick at least ONE

```
DEEPSEEK_API_KEY     = sk-...           # recommended in CN, free + tool calling
OPENAI_API_KEY       = sk-...           # if outside CN
ANTHROPIC_API_KEY    = sk-ant-...       # alt
GOOGLE_API_KEY       = AIza...          # alt
AI_PROVIDER          = deepseek         # or: openai | anthropic | google
```

`AI_PROVIDER` tells the model‑router in `lib/ai.ts` which key to use. If you
don't set it, the code defaults to `deepseek` (because the network we
developed on couldn't reach OpenAI). Change to `openai` if you only have an
OpenAI key.

### 1d · Optional but recommended

```
SENTRY_DSN                       = https://...@sentry.io/...   # error reporting
SENTRY_AUTH_TOKEN                = sntrys_...                  # source maps
SENTRY_ORG                       = your-org
SENTRY_PROJECT                   = revdev
FIRECRAWL_API_KEY                = fc-...                      # URL scraping tool
```

---

## 2 · Provision a Convex deployment (Tab 1)

Open a **shell tab** (look for "Shell" at the bottom of the Replit window —
the tab labeled `>_`). Run:

```bash
npx convex dev
```

The very first time:

1. Convex prints a URL — open it, log in with GitHub.
2. CLI asks "which project?" → choose **"create new project"**, name it
   something like `revdev-replit`.
3. CLI prints a `CONVEX_DEPLOYMENT=...`, `CONVEX_URL=...`, `CONVEX_SITE_URL=...`
   block. **Copy each one into Tools → Secrets**, replacing the blanks from
   step 1b.
4. **The CLI keeps running.** It's now a daemon watching `convex/*.ts`. When
   you (or the AI) edit a Convex file, it auto‑pushes the change.

> 🚨 **Critical:** `npx convex dev` is NOT a one‑shot setup command. It must
> stay alive in this shell tab the whole time you're using REVDEV. If you
> exit it (Ctrl+C, close shell, etc.), the very next change to `convex/*.ts`
> will not propagate to the backend, and your browser will start showing
> `Could not find public function for 'X'` errors.

### Schema validation errors during `convex dev`?

If `npx convex dev` fails with something like:

```
✖ Schema validation failed.
Document with ID "j5782td0…" in table "conversations" does not match the schema:
Object is missing the required field `updatedAt`.
```

This means there are **legacy rows** from an older version of the schema in
your Convex deployment. The repo's `convex/schema.ts` already has these
fields marked optional to handle this case — pull the latest `main`:

```bash
git pull origin main
```

…then re‑run `npx convex dev`. The push should succeed and report
`✔ Convex functions ready!`.

---

## 3 · Install + run the Inngest dev server (Tab 2)

The repo *used to* ship an `inngest.exe` Windows binary at the root, which
won't run on Replit's Linux container. The Linux Inngest CLI is a one‑line
install. **Open a second shell tab** and run:

```bash
npm i -g inngest-cli
inngest-cli dev
```

You'll see something like:

```
Inngest dev server running at http://localhost:8288
```

The Next app discovers it automatically via `src/inngest/client.ts` (which
talks to `http://localhost:8288/e/dev` in development).

> **EACCES on the install?** Replit's free tier sometimes blocks global npm
> installs. Use `npx` instead:
>
> ```bash
> npx inngest-cli@latest dev
> ```
>
> The `npx` form downloads the binary on demand — slower the first time
> but doesn't need permissions.

**Leave this tab open too.** Same rule as Convex: it's a daemon, not a
setup command.

---

## 4 · Run the Next.js dev server (Tab 3 / Run button)

Open a **third shell tab** (or use Replit's green Run button — it executes
`npm run dev` automatically) and run:

```bash
npm run dev
```

Expected output:

```
▲ Next.js 16.1.1 (Turbopack)
- Local:        http://localhost:3000
- Environments: .env.local
✓ Starting...
✓ Ready in 1.8s
```

If you see **"Port 3000 is in use"**, something else is already on that port
— either a stuck previous run, or Replit's preview hijacked it. Use the
fresh‑start helper:

```bash
npm run dev:fresh
```

That kills anything on dev ports 3000/3001/8288/50053 and restarts cleanly.

---

## 5 · Open the app

Replit's preview pane (right side of the screen) auto‑attaches to the first
HTTP port your dev server opens — usually 3000. If you see a "Run web view"
icon at the top, click it. Otherwise the preview should load
`http://localhost:3000` directly.

You should see the REVDEV landing page. Click **Sign In** → Clerk's modal →
sign in or sign up → land on `/projects`.

Now click **+ New Project**, type a prompt like *"Build a landing page with
a hero section, three‑column features grid, and a footer"*, hit Enter, and
watch the magic:

1. Chat sidebar shows the AI's plan checklist.
2. Steps tick ✅ as the agent works.
3. The right‑pane editor auto‑switches to the file currently being written,
   characters streaming in live.
4. When the build passes, the UI auto‑switches to the **Preview** tab.
5. WebContainer runs `npm install` and starts the dev server inside your
   browser — when it boots, you'll see the live page rendered in the iframe.

---

## ⚠️ Replit‑specific limitations & how to work around them

### A. Preview tab fails inside Replit's iframe webview

The in‑browser **WebContainer** that runs your generated app needs
`SharedArrayBuffer`, which requires the page to be cross‑origin isolated
(COEP `credentialless` + COOP `same-origin`). REVDEV's `next.config.ts`
sets those headers, but Replit's iframe occasionally strips them.

**Workaround:** click the "Open in new tab" arrow in the top‑right of
Replit's preview pane. The Preview tab works in a real browser tab; it just
doesn't always work nested inside Replit's iframe.

### B. WebContainer install is slow regardless of your network

WebContainer runs Node *inside the browser*, so `npm install` for a
generated project happens through **your laptop's** network connection —
not Replit's high‑bandwidth datacenter pipe. If you're on a slow or
filtered network (CN ISPs throttle `registry.npmjs.org`), the install
inside Preview will be slow.

**REVDEV defaults the WebContainer registry to `registry.npmmirror.com`**
(an exact CDN‑fronted mirror of npmjs that's fast globally and never
throttled). You can change it per‑project in **Project Settings → Install
Command**.

### C. Replit free tier sleeps after inactivity

If your repl has been idle for a while, the first request hitting
`/api/messages` may take 30+ seconds while Inngest re‑attaches to a cold
container. Subsequent requests are fast. Pro accounts ("Always On") avoid
this.

### D. The 8GB heap flag may exceed Replit's free tier RAM

Our `npm run dev` script sets `NODE_OPTIONS=--max-old-space-size=8192`
because the agent occasionally generates very large files. Free Replit has
~512MB RAM. If `npm run dev` gets killed with `SIGKILL`, lower the heap:

```bash
NODE_OPTIONS="--max-old-space-size=512" npx next dev
```

### E. "Stale browser tab" errors after `convex dev` push

If you fix a Convex schema/function and the browser still shows
`Could not find public function for 'chat:list'` (or any other name):
that's an old JS bundle still loaded in the tab. **Hard‑reload**
(`Ctrl+Shift+R` on Win/Linux, `Cmd+Shift+R` on macOS) to pick up the new
bundle.

---

## ✅ Final sanity checklist

After all 5 steps, verify each box. If any is unchecked, that's exactly
what's broken — fix it and the rest will fall into place.

- [ ] **Tools → Secrets** has all of: Clerk publishable + secret keys, the
      4 Clerk URL keys, all 3 Convex keys, and at least one AI provider key.
- [ ] **Shell tab 1** is running `npx convex dev` (not exited, not
      "✔ Convex functions ready" then prompt waiting — it should be
      tailing logs).
- [ ] **Shell tab 2** is running `inngest-cli dev` (or `npx inngest-cli
      dev`) and shows `Inngest dev server running at http://localhost:8288`.
- [ ] **Shell tab 3** (or Run button) is running `npm run dev` and shows
      `✓ Ready in N.Ns` with no red error lines.
- [ ] You can reach Clerk's sign‑in modal at the preview URL and complete
      sign‑in to land on `/projects`.
- [ ] In the Convex dashboard at <https://dashboard.convex.dev/>, your
      deployment shows the tables: `projects`, `files`, `conversations`,
      `messages`, `plans`, `editorStreams`, `buildChecks`.
- [ ] DevTools **Network** tab shows `*.convex.cloud` requests returning
      200 (not 401, not 404, no `Could not find public function`).
- [ ] DevTools **Console** is clean — only Clerk's "development keys"
      warning is expected.

If all 8 are green, "New Project" will work end‑to‑end.

---

## 🆘 Troubleshooting reference table

| Symptom in console / UI | Root cause | Fix |
|---|---|---|
| `Could not find public function for 'projects:getPartial'` | `npx convex dev` exited; backend has stale code | Re-run `npx convex dev` and **leave it running** |
| `Could not find public function for 'chat:list'` | Stale browser bundle from before the rename | Hard-reload the tab (`Ctrl+Shift+R`) |
| `Schema validation failed … missing field 'updatedAt'` | Legacy rows in dev DB | `git pull` (the schema marks those fields optional) and re-run `npx convex dev` |
| New Project spinner hangs | Inngest dev server not running | Start `inngest-cli dev` in tab 2 |
| Always redirected to sign-in | Clerk keys missing or wrong | Re-check `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` in Secrets |
| Preview tab is blank with "Failed to register service worker" | Cross-origin isolation stripped by Replit iframe | Click "Open in new tab" |
| `npm install` fails with `EACCES` | Replit free tier can't write to global node modules | Use `npx <cmd>` instead of `npm i -g <cmd>` |
| `Port 3000 is in use` | Stuck previous run | `npm run dev:fresh` |
| Cold first response takes 30s+ | Replit free tier was idle | Upgrade to Always On, or wait |
| "Out of memory" / SIGKILL on Next | Default heap too big for free tier | `NODE_OPTIONS=--max-old-space-size=512 npx next dev` |
| `inngest.exe: not found` or `cannot execute binary file: Exec format error` | Trying to use Windows binary on Linux | Use `inngest-cli` Linux build (step 3) |

---

## 🧱 Why this is more setup than a typical Next app

REVDEV is essentially **four** apps glued together:

- **Next.js** — the user-facing UI + API routes
- **Convex** — realtime database with reactive queries (`projects`, `files`,
  `messages`, `plans`, `editorStreams`, `buildChecks`)
- **Inngest** — durable background workflow runner that hosts the AI agent
- **WebContainer** — a Node.js runtime that runs *inside the browser* to
  preview generated apps

Each of those needs its own dev server in dev mode. In production
(Vercel/Netlify + Convex Cloud + Inngest Cloud) you only deploy the Next
app, and the others are managed services — much simpler. But for **local
dev on Replit**, you need to run all four daemons.

That's why a bare clone with no setup looks broken: it's missing 3 out of 4
of its required services. Once they're running, REVDEV becomes one of the
fastest IDEs out there.

---

<div align="center">

**You're set.** If you're still stuck after the checklist, open an issue
with the contents of all three shell tabs + your browser console and we'll
help debug it.

</div>
