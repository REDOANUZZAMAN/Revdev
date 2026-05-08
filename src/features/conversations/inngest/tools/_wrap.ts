/**
 * Phase D — auto-recovery wrapper for agent tools.
 * Phase G — live, in-flight narration of every tool call.
 *
 * `wrapTool(tool, ctx)` decorates a tool's `handler` so that:
 *
 *   1. BEFORE the tool runs, it pushes a one-line, human-readable progress
 *      update directly to the assistant's draft message in Convex. The UI
 *      is already subscribed and re-renders instantly. This is THE fix for
 *      "the chat is silent for 90 seconds while the agent works"  — the
 *      user now sees Cline-style play-by-play in real time.
 *   2. Any thrown error is caught and reported to Sentry with rich tags
 *      (projectId, conversationId, messageId, toolName).
 *   3. The agent receives a structured error string instead of a silent
 *      failure — letting the LLM reason about it and try a different
 *      approach on the next iteration.
 *
 * Design notes:
 *   - We DO NOT use the `step.run()` wrapper here. Inside a tool handler we
 *     don't have a step reference, and adding one would only force replay
 *     determinism that's not needed for fire-and-forget progress writes.
 *   - Narration is best-effort: any failure is swallowed (we never want to
 *     crash a tool because the chat-message append hiccupped).
 *   - The convex client we import is the lib/convex-client wrapper, which
 *     reuses one singleton HTTP client across the whole Inngest run.
 */

import * as Sentry from "@sentry/nextjs";
import type { createTool } from "@inngest/agent-kit";

import { convex } from "@/lib/convex-client";

import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

// AgentKit's tool type is exported indirectly via the function return type.
type AgentTool = ReturnType<typeof createTool>;

export interface WrapToolContext {
  projectId: string;
  conversationId?: string;
  messageId?: string;
  /** Server-side internal key for hitting Convex mutations. */
  internalKey?: string;
}

/**
 * Translate a raw tool call into a single short line of human play-by-play.
 * Returning null suppresses narration (used for noisy / internal tools like
 * `updatePlanStep` that already animate the plan checklist on their own).
 *
 * Optional async lookup: when we have a fileId-only tool (readFiles /
 * updateFile / deleteFiles) we hit Convex to resolve the human-readable file
 * name so the narration says "Editing globals.css" instead of a useless
 * "Editing file (25 lines)". The lookup is best-effort and on miss we
 * fall through to a generic line.
 */
async function narrateToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  ctx: WrapToolContext
): Promise<string | null> {
  switch (toolName) {
    case "createPlan": {
      const steps = (toolInput.steps as { title?: string }[] | undefined) ?? [];
      return `📋 Drafting a ${steps.length}-step plan…`;
    }
    case "updatePlanStep": {
      // The plan checklist UI already shows step status visually — narrating
      // every status change here would just flood the chat. Skip.
      return null;
    }
    case "listFiles":
      return `📂 Listing project files`;
    case "read_files":
    case "readFiles": {
      // PARAMETER NAME FIX. The actual readFiles tool takes `fileIds`, not
      // `paths`. The previous narrator looked up `paths`, found nothing,
      // and emitted the bare "📖 Reading files" line every single time —
      // which is exactly the "looping with same text" the user reported.
      const fileIds =
        (toolInput.fileIds as string[] | undefined) ??
        (toolInput.paths as string[] | undefined) ??
        [];
      if (fileIds.length === 0) return `📖 Reading files`;
      const names = await resolveFileNames(ctx, fileIds);
      if (names.length === 1) return `📖 Reading ${names[0]}`;
      const head = names.slice(0, 2).join(", ");
      return `📖 Reading ${names.length} file(s)${head ? ` (${head}${names.length > 2 ? "…" : ""})` : ""}`;
    }
    case "update_file":
    case "updateFile": {
      // Same fix — schema is `fileId` (one), not `path`.
      const fileId =
        (toolInput.fileId as string | undefined) ??
        (toolInput.path as string | undefined);
      const content = String(toolInput.content ?? "");
      const lines = content ? content.split("\n").length : 0;
      const name =
        fileId ? (await resolveFileNames(ctx, [fileId]))[0] ?? "file" : "file";
      return `✏️  Editing ${name}${lines ? ` (${lines} lines)` : ""}`;
    }
    case "create_files":
    case "createFiles": {
      const files = (toolInput.files as { name?: string }[] | undefined) ?? [];
      const names = files.map((f) => f?.name).filter(Boolean) as string[];
      if (names.length === 0) return `📝 Creating files`;
      if (names.length === 1) return `📝 Creating ${names[0]}`;
      return `📝 Creating ${names.length} files (${names.slice(0, 3).join(", ")}…)`;
    }
    case "createFolder": {
      const name = String(toolInput.name ?? "folder");
      return `📁 Creating folder ${name}`;
    }
    case "rename_file":
    case "renameFile": {
      const newName = String(toolInput.newName ?? "");
      return `🔀 Renaming → ${newName}`;
    }
    case "delete_files":
    case "deleteFiles": {
      // Schema is `fileIds`. Resolve to names for a meaningful narration.
      const fileIds =
        (toolInput.fileIds as string[] | undefined) ??
        (toolInput.paths as string[] | undefined) ??
        [];
      if (fileIds.length === 0) return `🗑️  Deleting files`;
      const names = await resolveFileNames(ctx, fileIds);
      if (names.length === 1) return `🗑️  Deleting ${names[0]}`;
      return `🗑️  Deleting ${names.length} file(s) (${names.slice(0, 2).join(", ")}…)`;
    }
    case "scrape_urls":
    case "scrapeUrls": {
      const urls = (toolInput.urls as string[] | undefined) ?? [];
      return `🌐 Scraping ${urls.length} URL(s) for context`;
    }
    case "list_recent_errors":
    case "listRecentErrors":
      return `🔍 Checking Sentry for recent errors`;
    case "inspect_error":
    case "inspectError":
      return `🔬 Inspecting Sentry error details`;
    default:
      return null; // unknown tool — skip narration to avoid noise
  }
}

/**
 * Convert an array of Convex file IDs into human-readable file names. Used by
 * the narrator to turn opaque "j97k…" IDs into "globals.css". Best-effort: on
 * any error or miss we fall back to a short slice of the raw id so the user
 * still sees SOMETHING distinct between calls.
 */
async function resolveFileNames(
  ctx: WrapToolContext | undefined,
  fileIds: string[]
): Promise<string[]> {
  // Defensive: ctx should never be undefined since callers always pass it,
  // but a stale HMR state once produced an unhandledRejection here. Cheap
  // insurance — if anything is missing we just return the truncated id.
  if (!ctx?.internalKey) return fileIds.map((id) => id.slice(0, 6));
  const out: string[] = [];
  for (const id of fileIds) {
    try {
      const file = await convex.query(api.system.getFileById, {
        internalKey: ctx.internalKey,
        fileId: id as Id<"files">,
      });
      out.push(file?.name ?? id.slice(0, 6));
    } catch {
      out.push(id.slice(0, 6));
    }
  }
  return out;
}

/**
 * Append a single line to the assistant message's progressLog array.
 *
 * Phase H — DEDICATED ACTIVITY FEED.
 *   The previous implementation appended every line into `message.content`,
 *   which made the chat bubble grow into a massive wall of unstructured
 *   text and visually drowned the agent's actual final reply. We now write
 *   to a separate `progressLog: v.array(v.string())` field via a
 *   purpose-built atomic mutation. The UI renders that field in a fixed
 *   collapsible activity panel, separate from the message body.
 *
 * Best-effort: any failure (network, race) is swallowed. The mutation
 * itself dedupes immediate-repeat lines and caps history at 60 entries.
 */
async function appendNarrationLine(
  ctx: WrapToolContext,
  line: string
): Promise<void> {
  if (!ctx.messageId || !ctx.internalKey) return;
  try {
    await convex.mutation(api.system.appendProgressLog, {
      internalKey: ctx.internalKey,
      messageId: ctx.messageId as Id<"messages">,
      line,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[wrapTool] narration append failed:", err);
  }
}

/**
 * Decorate an `agent-kit` tool with:
 *   - Live, pre-execution narration → flushed to chat before the tool runs.
 *   - Sentry capture on hard / soft errors.
 *   - Structured error string returned to the LLM on hard error.
 *
 * Use it like:
 *   const ctx = { projectId, conversationId, messageId, internalKey };
 *   const tools = [
 *     wrapTool(createReadFilesTool(...), ctx),
 *     wrapTool(createUpdateFileTool(...), ctx),
 *   ];
 */
export function wrapTool<T extends AgentTool>(tool: T, ctx: WrapToolContext): T {
  const original = tool as unknown as { handler: Function; name: string };
  const originalHandler = original.handler;
  const toolName = original.name;

  const wrapped: typeof originalHandler = async (
    params: unknown,
    helpers: unknown
  ) => {
    // 1. Narrate FIRST — even before parsing — so the user sees activity
    //    while the tool is still running. Best-effort, never blocks > a few ms.
    //    The narrator is async because it may resolve fileIds → file names
    //    via Convex, but each lookup is in-process and quick. We swallow
    //    any throw so a narration hiccup never blocks the actual tool.
    try {
      const line = await narrateToolCall(
        toolName,
        (params as Record<string, unknown>) ?? {},
        ctx
      );
      if (line) {
        await appendNarrationLine(ctx, line);
      }
    } catch (narrErr) {
      console.warn("[wrapTool] narration failed:", narrErr);
    }

    try {
      const result = await originalHandler(params, helpers);

      // The agent-kit convention is "tools return a string". If a tool
      // already produced a string starting with "Error" we still want to
      // report it to Sentry as a soft failure so we can see how often the
      // model gets bad inputs.
      if (typeof result === "string" && /^Error\b/i.test(result)) {
        Sentry.captureMessage(`Tool soft-error: ${toolName}`, {
          level: "warning",
          tags: {
            tool: toolName,
            projectId: ctx.projectId,
            ...(ctx.conversationId && { conversationId: ctx.conversationId }),
            ...(ctx.messageId && { messageId: ctx.messageId }),
          },
          extra: { params, result },
        });
        // Also tell the user the soft-error happened — agent will likely
        // self-correct on the next iteration.
        await appendNarrationLine(
          ctx,
          `   ⚠️  ${toolName} returned: ${String(result).slice(0, 140)}`
        );
      }

      return result;
    } catch (err) {
      // Hard error inside the tool: capture + return a structured string the
      // model can read. We DON'T re-throw; throwing crashes the Inngest step
      // and the agent gets nothing back (which is what causes silent hangs).
      const message = err instanceof Error ? err.message : String(err);
      const stack =
        err instanceof Error && err.stack
          ? err.stack.split("\n").slice(0, 5).join("\n")
          : undefined;

      Sentry.captureException(err, {
        tags: {
          tool: toolName,
          projectId: ctx.projectId,
          ...(ctx.conversationId && { conversationId: ctx.conversationId }),
          ...(ctx.messageId && { messageId: ctx.messageId }),
        },
        extra: { params },
      });

      await appendNarrationLine(
        ctx,
        `   ❌ ${toolName} crashed: ${message.slice(0, 140)}`
      );

      return `Error in tool "${toolName}": ${message}${
        stack ? `\nStack (top frames):\n${stack}` : ""
      }\n\nThis error has been logged. Decide whether to retry with different inputs, mark the current plan step as failed, or try a different approach.`;
    }
  };

  // Mutate the handler in place — agent-kit holds the same object reference.
  (original as { handler: typeof wrapped }).handler = wrapped;
  return tool;
}
