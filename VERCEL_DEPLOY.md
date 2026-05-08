# 🚀 Deploying REVDEV to Production on Vercel

This is the full path from "I have a working dev environment" to a public
production URL on Vercel. Unlike dev, you'll **never run any service yourself**
in production — Convex, Inngest, and Sentry are all managed cloud platforms
that you point Vercel at via env vars.

> **Production architecture** — same 4 services as dev, but cloud-hosted:
>
> | Service | Dev (Replit/local) | Production (managed) |
> |---|---|---|
> | Next.js | `npm run dev` (you) | **Vercel** (auto-deploys from GitHub) |
> | Convex | `npx convex dev` (you) | **Convex Cloud Production deployment** |
> | Inngest | `inngest-cli dev` (you) | **Inngest Cloud** |
> | Auth | Clerk dev keys | Clerk **production** instance |
> | Errors | Sentry (optional) | Sentry **production** project |

The end result: every `git push origin main` triggers a Vercel rebuild, which
re-runs `npx convex deploy` (pushing your latest schema to production Convex)
and registers your latest Inngest functions, all in one step.

---

## 📋 Production launch checklist

Print this and tick each box. The whole thing takes ~30 minutes.

- [ ] **Step 1** — Create production Convex deployment
- [ ] **Step 2** — Create production Inngest environment + signing key + event key
- [ ] **Step 3** — Create production Clerk instance + JWT template for Convex
- [ ] **Step 4** — Create production Sentry project + auth token (optional but recommended)
- [ ] **Step 5** — Configure Vercel project: import repo, set env vars, override build command
- [ ] **Step 6** — First deploy + smoke test
- [ ] **Step 7** — Wire up the Inngest production webhook
- [ ] **Step 8** — Wire up the Clerk → Convex JWT issuer
- [ ] **Step 9** — Lock down rate limits, billing alerts, and monitoring
- [ ] **Step 10** — Custom domain + cache headers (optional polish)

---

## 1 · Create a production Convex deployment

In a local terminal at the repo root:

```bash
npx convex deploy --prod
```

The first time, this will:

1. Ask Convex to provision a brand-new **production** deployment (separate
   from your dev deployment — different URL, different DB).
2. Push the contents of `convex/*.ts` to it.
3. Print a `CONVEX_URL` and `CONVEX_DEPLOY_KEY` to your terminal.

**Save the deploy key somewhere safe** — Vercel will use it to push schema
changes on every build. You'll set:

- `CONVEX_DEPLOY_KEY` → the long `prod:org-name|...` string Convex prints
- `NEXT_PUBLIC_CONVEX_URL` → `https://<your-prod>.convex.cloud`
- `NEXT_PUBLIC_CONVEX_SITE_URL` → `https://<your-prod>.convex.site`

> ❗ **Don't reuse your dev deployment in production.** A single mistake
> (running `npx convex dev` against your prod URL) will replace your prod
> code with whatever you have locally and break live users. Production
> uses `CONVEX_DEPLOY_KEY` (one-shot, no watcher) — dev uses `npx convex
> dev` (long-running watcher).

---

## 2 · Create the production Inngest environment

1. Go to <https://app.inngest.com/> → sign in with GitHub.
2. **Create environment** → name it `production`.
3. In the new environment's **Settings → Keys**, copy:
   - `INNGEST_EVENT_KEY` (starts with `evt_…`)
   - `INNGEST_SIGNING_KEY` (starts with `signkey-…`)
4. Save both — they go into Vercel env vars.

Inngest will discover your serverless function endpoint at
`https://<your-vercel-domain>/api/inngest` once you wire up the webhook in
**Step 7**.

> The repo's `src/inngest/client.ts` already creates the Inngest client with
> ID `polaris`; in production it picks up `INNGEST_EVENT_KEY` /
> `INNGEST_SIGNING_KEY` from `process.env` automatically.

---

## 3 · Create a production Clerk instance

In Clerk dev mode you've been using `pk_test_…` / `sk_test_…` keys. Production
needs a separate **production instance** with its own domain verification.

1. <https://dashboard.clerk.com/> → switch your application to **Production**
   (top-right toggle, or "Create production instance" if first time).
2. Add your Vercel domain (e.g. `revdev.vercel.app` or `app.yourdomain.com`)
   in **Domains**, then verify ownership.
3. **API Keys** → copy the production `pk_live_…` and `sk_live_…`.
4. **JWT Templates** → click "+ New template" → choose **Convex** from the
   preset list (Clerk has a built-in Convex template).
   - Save the template.
   - On the same page, copy the **Issuer URL** — it looks like
     `https://<your-app>.clerk.accounts.dev` or `https://clerk.<yourdomain>.com`.

That issuer URL is what `convex/auth.config.ts` reads as
`CLERK_JWT_ISSUER_DOMAIN`. We'll set it on Convex in **Step 8**.

---

## 4 · (Recommended) Create a production Sentry project

`next.config.ts` is already wired for Sentry; you just need a project + auth
token so Vercel can upload source maps on each build.

1. <https://sentry.io/> → create a new project → platform: **Next.js**.
2. Note your **DSN** (used at runtime), **Org slug** (already pinned to
   `sudoshild` in `next.config.ts`; if you fork, edit it), and **Project slug**
   (`revdev`).
3. **Settings → Account → Auth Tokens** → "Create New Token" with the scope
   `project:releases` (and `project:write` if you want issues management
   later). Copy the `sntrys_…` token.

Env vars you'll set on Vercel:

```
SENTRY_DSN          = https://<key>@<org>.ingest.sentry.io/<project>
SENTRY_AUTH_TOKEN   = sntrys_…
SENTRY_ORG          = sudoshild        # match next.config.ts
SENTRY_PROJECT      = revdev           # match next.config.ts
```

If you don't want Sentry, you can skip this step — the app degrades
gracefully (the `sentry` agent tool just won't have data to query).

---

## 5 · Set up the Vercel project

### 5a · Import the repo

1. <https://vercel.com/new> → "Import Git Repository" → pick
   `REDOANUZZAMAN/Revdev` (or your fork).
2. Framework preset: **Next.js** (auto-detected).
3. Root directory: **`.`** (leave default).
4. **Don't deploy yet** — first set env vars + override the build command.

### 5b · Override the build command (critical!)

In **Build & Output Settings → Build Command**, override to:

```
npx convex deploy --cmd 'npm run build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL
```

This single command:

1. Pushes your `convex/*.ts` to Convex Cloud production using `CONVEX_DEPLOY_KEY`.
2. Then runs the regular `npm run build` (which is `next build`) with
   `NEXT_PUBLIC_CONVEX_URL` injected from the just-deployed deployment.

Without this override, Vercel only runs `next build` and your Convex code
will fall further out of sync with each commit.

> 📚 Reference: <https://docs.convex.dev/production/hosting/vercel>

### 5c · Set environment variables

In **Settings → Environment Variables**, add each of the following. Apply
them to **Production** (and Preview if you want preview deploys to work,
though those need their own Convex/Clerk dev instances — see "Preview
deployments" below).

```
# Convex
NEXT_PUBLIC_CONVEX_URL              = https://<prod>.convex.cloud
NEXT_PUBLIC_CONVEX_SITE_URL         = https://<prod>.convex.site
CONVEX_DEPLOY_KEY                   = prod:<long-token>          # SECRET

# Clerk (production keys, NOT pk_test_)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY   = pk_live_…
CLERK_SECRET_KEY                    = sk_live_…                  # SECRET
NEXT_PUBLIC_CLERK_SIGN_IN_URL       = /sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL       = /sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL  = /projects
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL  = /projects

# Inngest
INNGEST_EVENT_KEY                   = evt_…                      # SECRET
INNGEST_SIGNING_KEY                 = signkey-…                  # SECRET

# AI provider — pick at least one
DEEPSEEK_API_KEY                    = sk-…                       # SECRET
# OPENAI_API_KEY                    = sk-…                       # SECRET
# ANTHROPIC_API_KEY                 = sk-ant-…                   # SECRET
# GOOGLE_API_KEY                    = AIza…                      # SECRET
AI_PROVIDER                         = deepseek                   # or openai|anthropic|google

# Sentry (recommended)
SENTRY_DSN                          = https://…@sentry.io/…
SENTRY_AUTH_TOKEN                   = sntrys_…                   # SECRET
SENTRY_ORG                          = sudoshild
SENTRY_PROJECT                      = revdev

# Optional integrations
FIRECRAWL_API_KEY                   = fc-…                       # SECRET (URL scrape tool)
GITHUB_TOKEN                        = ghp_…                      # SECRET (GitHub export tool)
```

Mark every key annotated `# SECRET` as **encrypted** (Vercel's "Sensitive"
toggle). The `NEXT_PUBLIC_*` ones are public by design — they ship to the
browser bundle.

> ⚠️ Don't set `CONVEX_DEPLOYMENT` in Vercel — that's a dev-only var. Use
> `CONVEX_DEPLOY_KEY` instead.

---

## 6 · Deploy + smoke test

Hit **Deploy**. Watch the build log:

1. `Cloning github.com/REDOANUZZAMAN/Revdev` ✓
2. `npm install` (takes 60-120s) ✓
3. `npx convex deploy --cmd 'npm run build' …` —
   - "Deploying to https://<prod>.convex.cloud"
   - "✔ Convex functions ready!"
   - Then `next build` runs with `NEXT_PUBLIC_CONVEX_URL` injected.
4. `Compiled successfully in N.Ns` ✓
5. `Sentry] Successfully uploaded source maps` (if Sentry is configured) ✓
6. `Build completed in N.Ns` ✓

If any of those steps fails, click into it and the error tells you which
env var or service is misconfigured. Common issues:

| Build error | Fix |
|---|---|
| `Could not authenticate with Convex (401)` | `CONVEX_DEPLOY_KEY` missing/wrong/from dev environment |
| `Module not found: '@opentelemetry/winston-transport'` | Already handled by `serverExternalPackages` in `next.config.ts`; only happens if you've removed that line |
| `Sentry CLI errored: 401` | `SENTRY_AUTH_TOKEN` missing or doesn't have `project:releases` scope |
| Build hangs at `Generating static pages` | Usually a Convex query failing during prerender; mark the page `export const dynamic = "force-dynamic"` |

After the build succeeds, open `https://<your-app>.vercel.app/`. You should
see the landing page. Click Sign In → Clerk modal (production keys, not the
"Development keys" warning) → land on `/projects`. The list will be empty
because production Convex has no data yet.

---

## 7 · Wire up the Inngest production webhook

Until you do this step, "New Project" in production will hang exactly like
it did in dev — Inngest doesn't know where your serverless functions live.

1. <https://app.inngest.com/> → switch to your `production` environment.
2. **Apps** → "+ Sync new app" → **HTTP**.
3. URL: `https://<your-app>.vercel.app/api/inngest`
4. Click **Sync**. Inngest will hit that URL, your Next.js app responds with
   the function manifest, and you'll see all registered functions appear:
   - `process-message`
   - `export-to-github`
   - `import-github-repo`
5. **Resync** any time you add a new function and redeploy.

---

## 8 · Wire up Clerk → Convex JWT

Convex needs to verify Clerk tokens to know which user owns which row. This
is a one-time configuration on the Convex side.

1. <https://dashboard.convex.dev/> → your **production** deployment →
   **Settings → Environment Variables**.
2. Add: `CLERK_JWT_ISSUER_DOMAIN = https://<your-clerk-domain>` (the
   Issuer URL you copied from Clerk's JWT template in Step 3).
3. Save. Convex re-deploys with the new auth config (which `convex/auth.config.ts`
   reads via `process.env.CLERK_JWT_ISSUER_DOMAIN`).

You can verify it worked by signing into your prod app, then checking the
Convex dashboard's **Logs** — every authenticated query/mutation should
show `userId: user_…` instead of `userId: null`.

---

## 9 · Lock down for production

### 9a · Rate limits & retries

Inngest already has built-in rate limiting and retries (3 attempts with
exponential backoff). Default settings are fine for low-volume launches.

For Convex, set per-table caps in the **Convex dashboard → Settings →
Function Limits** to prevent runaway agents from blowing through your
quota.

### 9b · Billing alerts

Enable spend alerts for each provider:
- **Vercel**: Dashboard → Billing → "Notify me when usage exceeds…"
- **Convex**: Settings → Plan & Billing → "Send alert at $X"
- **Inngest**: Settings → Billing
- **DeepSeek/OpenAI/Anthropic**: Each has a "monthly usage cap" setting.
  Set it. **An infinite-loop agent without a cap can burn $1000+ overnight.**

### 9c · Sentry alerts

Sentry dashboard → **Alerts → Create Alert**. Recommended starter alerts:

- New issue in `revdev` → notify you on Slack/email
- Error rate exceeds 5% over 5 min → page you

The agent's `sentry` tool will read these issues automatically and try to
self-heal — but you still want a human in the loop for the first few weeks.

### 9d · Clerk Web Application Firewall

In Clerk production, enable **Bot Protection** and **Bot Protection for
sign-in**. The free tier has reasonable defaults; the paid tier adds
device fingerprinting.

---

## 10 · Custom domain + final polish

### 10a · Custom domain

Vercel: Settings → Domains → "Add" → enter `app.yourdomain.com` → follow
the CNAME instructions at your DNS registrar.

After DNS propagates:
1. Update Clerk → Domains → swap `revdev.vercel.app` for `app.yourdomain.com`.
2. Update Inngest webhook URL in Inngest dashboard to use the new domain.
3. Hard reload, log in, verify everything still works.

### 10b · Cache headers

Vercel auto-caches `_next/static`. The COEP/COOP headers in `next.config.ts`
mean WebContainer's `SharedArrayBuffer` works in production (which doesn't
work on most preview deployments / iframes). Nothing extra to do.

### 10c · Analytics & speed insights

Optional but lightweight: in your Vercel project, enable **Web Analytics**
and **Speed Insights** (one click each). They auto-instrument; nothing to
add to the codebase.

---

## 🔁 Day-2 operations

### Deploying changes

Just `git push origin main`. Vercel auto-builds, the build command pushes
schema/functions to Convex, Inngest re-syncs functions on first request,
and your users get the new code without any downtime.

### Rolling back

Vercel: Deployments tab → previous green deployment → "Promote to
Production". Convex: dashboard → Deployments tab → "Roll back to previous
push". Inngest: also has push history; roll back from the dashboard.

### Preview deployments

Each PR gets a `https://revdev-git-<branch>-<user>.vercel.app` URL. By
default these share **production** Convex/Clerk/Inngest, which is bad —
one buggy PR can corrupt prod data. Two options:

1. **Easy:** disable preview deployments for everything except `main`. In
   Vercel → Settings → Git → "Production Branch" = `main`, "Auto Deploy"
   for branches off.
2. **Right way:** create a `preview` Convex deployment + `preview` Inngest
   environment + Clerk dev instance, then in Vercel set those env vars to
   only apply to "Preview" environment (not Production). Now your
   per-branch URLs hit a sandbox.

### Cost ballpark (small launch)

| Service | Free tier | Paid tier kicks in around |
|---|---|---|
| Vercel | 100 GB bandwidth, 100 GB-hr serverless | $20/mo Pro |
| Convex | 1 M function calls/mo, 1 GB storage | $25/mo Pro |
| Inngest | 50 K events/mo, 25 K function runs | $20/mo Pro |
| Clerk | 10 K MAU | $25/mo Pro |
| Sentry | 5 K errors/mo | $26/mo Team |
| DeepSeek API | Free during launch promo (check current pricing) | $0.14 / M input tokens |
| **Total** | $0/mo to start | ~$120/mo for a small startup |

---

## 🆘 Troubleshooting reference

| Symptom in prod | Root cause | Fix |
|---|---|---|
| Build fails with `CONVEX_URL is undefined` | Build command override missing | Set Build Command in Vercel to `npx convex deploy --cmd 'npm run build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL` |
| `Could not authenticate with Convex (401)` during build | `CONVEX_DEPLOY_KEY` missing or for wrong deployment | Use the prod key from `npx convex deploy --prod` |
| Sign-in redirects in a loop | Production Clerk keys missing/wrong, or domain not verified | Use `pk_live_…` not `pk_test_…`; verify domain in Clerk dashboard |
| `userId: null` in Convex logs after sign-in | `CLERK_JWT_ISSUER_DOMAIN` not set on Convex prod | Step 8 |
| New Project hangs forever in production | Inngest webhook not synced | Step 7: Apps → Sync new app → `https://…/api/inngest` |
| Sentry sourcemaps not uploading | `SENTRY_AUTH_TOKEN` missing / wrong scope | Generate new token with `project:releases` scope |
| WebContainer Preview blank | COEP/COOP headers missing on Vercel | Already set in `next.config.ts`; if you forked and removed it, restore |
| `next build` OOMs on Vercel | Default Vercel build memory too low | Set `NODE_OPTIONS=--max-old-space-size=8192` env var (Vercel Pro plan) |
| AI requests fail with 401 | Provider key missing | Check `AI_PROVIDER` matches a key you've actually set |
| First request after idle takes 10+ s | Vercel cold start of serverless function | Normal; subsequent requests are fast. Pro tier has reduced cold starts |

---

## ⚡ Quick reference: env var matrix

| Variable | Dev (Replit/local) | Production (Vercel) | Lives in |
|---|---|---|---|
| `NEXT_PUBLIC_CONVEX_URL` | dev URL from `npx convex dev` | prod URL | Vercel env vars |
| `CONVEX_DEPLOYMENT` | dev:`<name>` | — *(use deploy key instead)* | dev `.env.local` only |
| `CONVEX_DEPLOY_KEY` | — | `prod:<key>` | Vercel env vars |
| `CLERK_*` | `pk_test_…` / `sk_test_…` | `pk_live_…` / `sk_live_…` | Both |
| `INNGEST_EVENT_KEY` | unset (uses dev server) | `evt_…` | Vercel env vars |
| `INNGEST_SIGNING_KEY` | unset (uses dev server) | `signkey-…` | Vercel env vars |
| `CLERK_JWT_ISSUER_DOMAIN` | dev Clerk issuer | prod Clerk issuer | **Convex** dashboard env vars (NOT Vercel) |
| `SENTRY_AUTH_TOKEN` | optional | recommended | Vercel env vars |
| AI provider keys | yours | yours | Both |

---

<div align="center">

**You're live!** Bookmark <https://app.inngest.com/>,
<https://dashboard.convex.dev/>, <https://dashboard.clerk.com/>, and your
Vercel project — those four tabs are your prod control plane.

</div>
