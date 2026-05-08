/**
 * Phase C — Helper for "artificial character-streaming" of file writes.
 * Phase H — race-fixed.
 *
 * The LLM has already produced the FULL content by the time the tool fires
 * (DeepSeek returns chunks but agent-kit collects them into the tool call).
 * To still give the user a Cline-like "typing-in-the-editor" effect we
 * replay the saved content into the `editorStreams` Convex table in
 * ~120-character chunks at a fast interval. The UI subscribes and follows.
 *
 * Race-correctness (the bug this version fixes):
 * --------------------------------------------------------------------
 *   The earlier implementation called streamFileWrite as fire-and-forget
 *   from createFiles + updateFile tools. Two consecutive tool calls
 *   would each spin up their own background loop. Both wrote to the
 *   SAME per-project editorStream record (via convex.editorStreams.append),
 *   so the second tool's `start()` would replace the row with the new
 *   fileId/fileName but the FIRST tool's chunk-append loop kept running
 *   and appending OLD-file bytes to the NEW file's stream. Visible
 *   symptom: the editor pane shows "data.ts" in the breadcrumb but the
 *   content streaming in is half from the previous file. After the
 *   agent finishes, the stale loops also kept ticking content into the
 *   "completed" record so the AI-is-writing overlay stayed up.
 *
 * Two fixes here:
 *   1. Per-project serialization. We hold a small in-memory promise
 *      chain `inFlight: Map<projectId, Promise>` so a second stream for
 *      the same project waits for the first to fully resolve before it
 *      even calls `start()`. No more interleaved appends. Tool calls
 *      themselves still return immediately (we keep the fire-and-forget
 *      contract at the call site) — only the streaming loop is
 *      serialized.
 *   2. Generation guard. Each scheduled stream is given a monotonic
 *      `gen` number per project. Before every `append()` we re-check
 *      `latestGen.get(projectId) === ourGen`. If a newer stream has
 *      bumped the generation we abort silently — the new stream's start
 *      already replaced the DB row, no need to keep typing the old one.
 *
 * Cost knobs lowered too — `maxDurationMs` from 4000 → 1500ms — so
 * stacked streams flush quickly even when an agent creates many files
 * in a row.
 *
 * IMPORTANT — what we DON'T stream (config noise):
 *  Watching `tsconfig.json` or `tailwind.config.ts` get typed in is boring
 *  and steals attention from the real work. We skip those by name and only
 *  stream genuine source code (.tsx/.ts/.jsx/.js/.vue/.py/.css/.html/.md).
 */

import { convex } from "@/lib/convex-client";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

interface StreamFileOptions {
  internalKey: string;
  projectId: Id<"projects">;
  fileId: Id<"files">;
  fileName: string;
  content: string;
  /** Chunk size in chars. Default ~280 — bigger chunks → faster total wall clock. */
  chunkSize?: number;
  /** ms between chunks. Default 12 — ~80 writes/sec, just below perceptual limit. */
  intervalMs?: number;
  /** Skip streaming entirely for files smaller than this. Default 80. */
  skipBelowChars?: number;
  /** Hard cap on total streaming time (ms). Default 700 — beyond this, dump rest at once. */
  maxDurationMs?: number;
}


const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * File extensions worth visually streaming. Anything else (config, lockfile,
 * binary, env, dotfile-without-ext) is written silently to keep the editor
 * focused on actual code.
 */
const STREAMABLE_EXTS = new Set([
  // JS/TS source
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  // Web
  "vue", "svelte", "html", "htm", "css", "scss", "sass", "less",
  // Other languages
  "py", "rb", "go", "rs", "java", "kt", "swift", "c", "h", "cpp", "hpp",
  "cs", "php", "lua", "sh", "bash", "zsh",
  // Markup / docs
  "md", "mdx", "txt", "sql", "graphql", "gql", "yaml", "yml",
]);

/**
 * Filenames that always get skipped no matter the extension. These are the
 * "ceremonial" files that always look the same and bore the user.
 */
const SKIP_NAMES = new Set([
  "package.json",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "jsconfig.json",
  "tailwind.config.ts",
  "tailwind.config.js",
  "postcss.config.mjs",
  "postcss.config.js",
  "next.config.ts",
  "next.config.js",
  "next.config.mjs",
  "next-env.d.ts",
  "components.json",
  ".eslintrc.json",
  ".prettierrc",
  ".prettierrc.json",
  ".gitignore",
  ".env",
  ".env.local",
  ".env.example",
  "README.md", // boring boilerplate; agent doesn't really write to this
]);

function shouldStream(fileName: string): boolean {
  if (SKIP_NAMES.has(fileName)) return false;
  if (fileName.startsWith(".")) return false; // dotfiles
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot === -1) return false; // no extension = probably binary or system file
  const ext = fileName.slice(lastDot + 1).toLowerCase();
  return STREAMABLE_EXTS.has(ext);
}

// -----------------------------------------------------------------
// Module-level coordination state.
//
// `inFlight` chains per-project promises so streams serialize. Each new
// streamFileWrite hooks onto the previous one's resolution; only one
// stream actively writes to a project's editorStream record at a time.
//
// `latestGen` lets a *running* stream check if a newer one has been
// scheduled and bail mid-flight. Combined with serialization this is
// belt-and-suspenders — but during an Inngest replay we may end up with
// genuinely-overlapping invocations (e.g. dev hot reload), so the guard
// is cheap insurance.
// -----------------------------------------------------------------
const inFlight = new Map<string, Promise<void>>();
const latestGen = new Map<string, number>();

/**
 * Await whatever stream chain is currently in-flight for `projectId`.
 * Used by processMessage right before calling editorStreams.finish — that
 * way the "AI is writing X" overlay won't keep ticking after the agent
 * has already returned its final answer.
 *
 * Returns immediately if there's no active stream for the project.
 */
export function waitForStreamsToDrain(projectId: string): Promise<void> {
  return inFlight.get(projectId) ?? Promise.resolve();
}

/**
 * Schedule a visual replay of `content` into the project's editorStream
 * record. Fire-and-forget at the call site (tools don't await this), but
 * INTERNALLY each project's streams play back in order without trampling
 * each other.
 *
 * Returns the chained promise so callers who DO want to await (e.g. unit
 * tests) can.
 */
export function streamFileWrite(opts: StreamFileOptions): Promise<void> {
  const projectKey = String(opts.projectId);

  // Bump generation BEFORE we wait — that way any older still-in-flight
  // stream sees its generation is stale and bails on the next chunk.
  const gen = (latestGen.get(projectKey) ?? 0) + 1;
  latestGen.set(projectKey, gen);

  const prev = inFlight.get(projectKey) ?? Promise.resolve();
  const next = prev
    // Swallow the previous chain's errors so a failed stream doesn't poison
    // every subsequent one.
    .catch(() => undefined)
    .then(() => runStream(opts, gen, projectKey));

  inFlight.set(projectKey, next);

  // Once this stream finishes, clear it ONLY if we're still the most-recent
  // one — otherwise we'd drop a still-running successor's promise out of
  // the map.
  next.finally(() => {
    if (inFlight.get(projectKey) === next) {
      inFlight.delete(projectKey);
    }
  });

  return next;
}

async function runStream(
  opts: StreamFileOptions,
  gen: number,
  projectKey: string
): Promise<void> {
  // PERF — Defaults tuned aggressively in the Phase H "why is dev so slow"
  // pass. Per-project serialization means each file's stream gates the
  // next one, so a 1.5s/file budget across 10 files = 15 SECONDS of pure
  // typing animation before the agent's last tool call can flush. New
  // budget caps each file at 700ms, so 10 files = 7s worst case (and
  // typically much less since most files complete before the budget).
  // Chunk size doubled and interval halved → about 4× faster perceived
  // typing, still smooth enough that the user reads it as "AI typing".
  const {
    internalKey,
    projectId,
    fileId,
    fileName,
    content,
    chunkSize = 280,
    intervalMs = 12,
    skipBelowChars = 80,
    maxDurationMs = 700,
  } = opts;

  // Skip noisy config / boilerplate files — agent still saves them, just no animation.
  if (!shouldStream(fileName)) return;

  // Don't bother streaming trivial files — adds latency for no UX win.
  if (content.length < skipBelowChars) return;

  // If a newer stream has already been scheduled, skip ours entirely.
  // No point even calling start() — we'd just clobber the newer file's
  // metadata with our about-to-be-stale row.
  if (latestGen.get(projectKey) !== gen) return;

  try {
    await convex.mutation(api.editorStreams.start, {
      internalKey,
      projectId,
      fileId,
      fileName,
    });

    const startedAt = Date.now();
    const totalChunks = Math.ceil(content.length / chunkSize);

    for (let i = 0; i < totalChunks; i++) {
      // Guard: a newer stream has taken over. Stop typing the old file —
      // the new one's start() has already replaced the editorStreams row,
      // so any further appends from us would corrupt it with stale bytes.
      if (latestGen.get(projectKey) !== gen) return;

      const elapsed = Date.now() - startedAt;
      if (elapsed >= maxDurationMs) {
        // Out of time budget: dump the remainder in one final chunk.
        const remaining = content.slice(i * chunkSize);
        if (remaining.length > 0) {
          await convex.mutation(api.editorStreams.append, {
            internalKey,
            projectId,
            chunk: remaining,
          });
        }
        break;
      }

      const chunk = content.slice(i * chunkSize, (i + 1) * chunkSize);
      await convex.mutation(api.editorStreams.append, {
        internalKey,
        projectId,
        chunk,
      });

      // Last chunk: no need to sleep before finishing.
      if (i < totalChunks - 1) {
        await sleep(intervalMs);
      }
    }
  } finally {
    // Only fire `finish()` if we're still the latest stream. Otherwise the
    // newer stream will manage its own finish() — flipping status to
    // completed here would briefly hide the StreamingEditor and re-show
    // it, which looks like a stutter.
    if (latestGen.get(projectKey) === gen) {
      try {
        await convex.mutation(api.editorStreams.finish, {
          internalKey,
          projectId,
        });
      } catch {
        // Already finished or no active stream — ignore.
      }
    }
  }
}
