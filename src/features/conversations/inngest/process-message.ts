import { createAgent, createNetwork } from '@inngest/agent-kit';
import { deepseek, openai } from '@inngest/ai';

// Phase H — model selection.
//
// DeepSeek as of 2026-04 ships two next-gen models on the same OpenAI-compatible
// `/v1/chat/completions` endpoint:
//   • `deepseek-v4-flash` — 1M context, low latency, tool calling. Optimal for
//     interactive "vibe coding" where each turn does a few tool calls and the
//     user is watching the activity panel tick. THIS IS OUR DEFAULT.
//   • `deepseek-v4-pro`   — same architecture but tuned for deeper reasoning;
//     noticeably slower per token. Worth opting into for very large refactors
//     by setting DEEPSEEK_CODING_MODEL=deepseek-v4-pro in .env.local.
// Title generation is a one-shot 50-token call so v4-flash is plenty.
// Legacy names `deepseek-chat` (V3) and `deepseek-reasoner` (R1) will be sunset
// 2026-07-24 — only set them explicitly if you need to test the older models.
const CODING_MODEL = process.env.DEEPSEEK_CODING_MODEL || "deepseek-v4-flash";
const TITLE_MODEL = process.env.DEEPSEEK_TITLE_MODEL || "deepseek-v4-flash";

// AI provider routing.
//
// Real-world experience: DeepSeek's API has bouts of sustained 503 / 524
// (Cloudflare origin timeout) where retries don't help — the upstream
// model server is hung for tens of minutes. When that happens our existing
// HTTP retry loop just chews through 4 attempts and the user still gets
// "agent stopped early".
//
// Fix: when DEEPSEEK_API_KEY is missing OR the env var
// `AI_PROVIDER=openai` is set, we use OpenAI directly. When DeepSeek IS
// available (the normal case), we still use it first BUT after our
// transient-retry loop exhausts on a 5xx we automatically failover to
// OpenAI for that one request — see `runWithFallback` below. Keeps the
// happy path on DeepSeek (cheaper, works in CN without VPN) while
// guaranteeing the user always gets a result if EITHER provider is up.
const AI_PROVIDER = (process.env.AI_PROVIDER || "auto").toLowerCase();
const HAS_DEEPSEEK = !!process.env.DEEPSEEK_API_KEY;
const HAS_OPENAI = !!process.env.OPENAI_API_KEY;
const OPENAI_CODING_MODEL = process.env.OPENAI_CODING_MODEL || "gpt-4o-mini";
const OPENAI_TITLE_MODEL = process.env.OPENAI_TITLE_MODEL || "gpt-4o-mini";

/** Pick the primary model, used by default. */
function makeCodingModel() {
  if (AI_PROVIDER === "openai" || (!HAS_DEEPSEEK && HAS_OPENAI)) {
    return openai({
      model: OPENAI_CODING_MODEL,
      apiKey: process.env.OPENAI_API_KEY!,
      defaultParameters: {
        temperature: 0.3,
        max_tokens: 8000,
      } as Record<string, unknown>,
    });
  }
  return deepseek({
    model: CODING_MODEL,
    apiKey: process.env.DEEPSEEK_API_KEY!,
    defaultParameters: {
      temperature: 0.3,
      max_tokens: 8000,
      // ⚠️  thinking: { type: "disabled" } is REQUIRED — see the longer
      // comment below on the agent's model config for the rationale.
      thinking: { type: "disabled" },
    } as Record<string, unknown>,
  });
}

function makeOpenAiCodingModel() {
  return openai({
    model: OPENAI_CODING_MODEL,
    apiKey: process.env.OPENAI_API_KEY!,
    defaultParameters: {
      temperature: 0.3,
      max_tokens: 8000,
    } as Record<string, unknown>,
  });
}

function makeTitleModel() {
  if (AI_PROVIDER === "openai" || (!HAS_DEEPSEEK && HAS_OPENAI)) {
    return openai({
      model: OPENAI_TITLE_MODEL,
      apiKey: process.env.OPENAI_API_KEY!,
      defaultParameters: {
        temperature: 0.1,
        max_tokens: 50,
      } as Record<string, unknown>,
    });
  }
  return deepseek({
    model: TITLE_MODEL,
    apiKey: process.env.DEEPSEEK_API_KEY!,
    defaultParameters: {
      temperature: 0.1,
      max_tokens: 50,
      thinking: { type: "disabled" },
    } as Record<string, unknown>,
  });
}

import { inngest } from "@/inngest/client";
import { Id } from "../../../../convex/_generated/dataModel";
import { NonRetriableError } from "inngest";
import { convex } from "@/lib/convex-client";
import { api } from "../../../../convex/_generated/api";
import { 
  CODING_AGENT_SYSTEM_PROMPT, 
  TITLE_GENERATOR_SYSTEM_PROMPT
} from "./constants";
import { DEFAULT_CONVERSATION_TITLE } from "../constants";
import { createReadFilesTool } from './tools/read-files';
import { createListFilesTool } from './tools/list-files';
import { createUpdateFileTool } from './tools/update-file';
import { createCreateFilesTool } from './tools/create-files';
import { createCreateFolderTool } from './tools/create-folder';
import { createRenameFileTool } from './tools/rename-file';
import { createDeleteFilesTool } from './tools/delete-files';
import { createScrapeUrlsTool } from './tools/scrape-urls';
import {
  createCreatePlanTool,
  createUpdatePlanStepTool,
} from './tools/plan';
import {
  createListRecentErrorsTool,
  createInspectErrorTool,
} from './tools/sentry';
import { wrapTool } from './tools/_wrap';
import { waitForStreamsToDrain } from './tools/_streaming';
import { compileCheck } from "@/lib/compile-check";

interface MessageEvent {
  messageId: Id<"messages">;
  conversationId: Id<"conversations">;
  projectId: Id<"projects">;
  message: string;
};

// Type for tracking file operations
interface FileOperationMetadata {
  filesRead: string[];
  filesModified: { path: string; linesAdded: number; linesRemoved: number }[];
  filesCreated: string[];
  filesDeleted: string[];
}

export const processMessage = inngest.createFunction(
  {
    id: "process-message",
    // CRITICAL: disable Inngest's automatic retries.
    //
    // This function calls the LLM (token cost) and writes files to the
    // user's project (visible side effects). If any step throws an error
    // that escapes our internal try/catch, Inngest's default behavior is
    // to retry the WHOLE function up to 4 times — meaning the agent re-
    // creates the plan, re-creates files, re-streams content into the
    // editor, and the user sees the activity panel loop forever:
    //   📋 Drafting a 10-step plan…
    //   📝 Creating Navbar.tsx
    //   📝 Creating Hero.tsx
    //   📂 Listing project files
    //   📋 Drafting a 10-step plan…   ← ouch
    //   📝 Creating Navbar.tsx
    //   ...
    // We already have a more surgical retry inside the function (around
    // network.run for the JSON-parse hiccup), AND we have an `onFailure`
    // hook that writes a graceful message to the user. Outer retries
    // bring nothing but pain. Set to 0.
    retries: 0,
    cancelOn: [
      {
        event: "message/cancel",
        if: "event.data.messageId == async.data.messageId",
      },
    ],
    onFailure: async ({ event, step }) => {
      const { messageId } = event.data.event.data as MessageEvent;
      const internalKey = process.env.POLARIS_CONVEX_INTERNAL_KEY;

      // Update the message with error content
      if (internalKey) {
        await step.run("update-message-on-failure", async () => {
          await convex.mutation(api.system.updateMessageContent, {
            internalKey,
            messageId,
            content:
              "My apologies, I encountered an error while processing your request. Let me know if you need anything else!",
          });
        });

        // Skip any still-running plan steps so the chat doesn't show a
        // perma-spinner on a dead message. Best-effort: ignore failures.
        try {
          await step.run("skip-plan-on-failure", async () => {
            await convex.mutation(api.plans.cancelActiveSteps, {
              internalKey,
              messageId,
            });
          });
        } catch {
          /* swallow — plan cleanup is best-effort */
        }
      }
    }
  },
  {
    event: "message/sent",
  },
  async ({ event, step }) => {
    const { 
      messageId, 
      conversationId,
      projectId,
      message
    } = event.data as MessageEvent;

    console.log("[ProcessMessage] Starting processing", { messageId, conversationId });

    const internalKey = process.env.POLARIS_CONVEX_INTERNAL_KEY; 

    if (!internalKey) {
      throw new NonRetriableError("POLARIS_CONVEX_INTERNAL_KEY is not configured");
    }

    // Helper to append progress lines to the assistant message's progressLog.
    //
    // Phase H — DEDICATED ACTIVITY FEED. Was: every progress line was concat'd
    // into `message.content`, which made the chat bubble grow into an enormous
    // wall of mixed-up text. Now each line goes to a dedicated `progressLog`
    // array via the atomic `appendProgressLog` mutation, and the UI renders
    // it as a fixed-size collapsible Activity panel above the message body.
    //
    // CORRECTNESS — These calls MUST be wrapped in `step.run` even though it
    // adds ~100ms of latency per call. Without it, Inngest re-executes them
    // on every step replay (and a single function run replays its prefix
    // dozens of times as it advances), causing 30+ DUPLICATE Convex
    // mutations per progress line. In production this hammered Convex hard
    // enough that downstream operations (the agent's tool calls, the file
    // mutations, the build-check writes) timed out or 500'd. The "I
    // encountered an error" message users saw was downstream of this.
    //
    // step.run + a unique counter ID is the right way: Inngest caches the
    // result on first execution and skips it on every subsequent replay
    // of the same prefix.
    let progressCounter = 0;
    const appendProgress = async (line: string) => {
      const id = `progress-${++progressCounter}`;
      try {
        await step.run(id, async () => {
          await convex.mutation(api.system.appendProgressLog, {
            internalKey,
            messageId,
            line,
          });
        });
      } catch (err) {
        console.error("Failed to append progress:", err);
      }
    };

    // Map a raw tool call into a one-line, human-readable progress message.
    // Mirrors how Cline narrates each step in its chat panel.
    //
    // (Kept around as a reference / fallback even though wrapTool() now
    // handles the live narration. Some future code path may want to
    // synthesise a narration line from a tool call AFTER the fact —
    // e.g. for replay UIs — and re-using this keeps phrasing consistent.)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const narrateToolCall = (
      toolName: string,
      toolInput: Record<string, unknown>
    ): string | null => {
      switch (toolName) {
        case "createPlan": {
          const steps = (toolInput.steps as { title?: string }[] | undefined) ?? [];
          return `📋 Drafting a ${steps.length}-step plan…`;
        }
        case "updatePlanStep": {
          const status = String(toolInput.status ?? "");
          const stepId = String(toolInput.stepId ?? "");
          if (status === "running") return `▶️ Step ${stepId.slice(0, 6)}: starting`;
          if (status === "done") return `✓ Step ${stepId.slice(0, 6)}: done`;
          if (status === "failed") return `✗ Step ${stepId.slice(0, 6)}: failed`;
          return null;
        }
        case "listFiles":
          return `📂 Listing project files`;
        case "read_files":
        case "readFiles": {
          const paths = (toolInput.paths as string[] | undefined) ?? [];
          if (paths.length === 0) return null;
          if (paths.length === 1) return `📖 Reading ${paths[0]}`;
          return `📖 Reading ${paths.length} files (${paths.slice(0, 2).join(", ")}…)`;
        }
        case "update_file":
        case "updateFile": {
          const file = String(toolInput.path ?? toolInput.fileName ?? "file");
          const content = String(toolInput.content ?? "");
          const lines = content ? content.split("\n").length : 0;
          return `✏️  Editing ${file}${lines ? ` (${lines} lines)` : ""}`;
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
          const paths = (toolInput.paths as string[] | undefined) ?? [];
          return `🗑️  Deleting ${paths.length} file(s)`;
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
    };

    // Initial progress update
    await appendProgress("Processing request...");

    // PERF — Removed `step.sleep("wait-for-db-sync", "1s")`. It was a
    // legacy belt-and-suspenders against a long-fixed race where the
    // user's just-inserted message hadn't replicated to Convex's read
    // replicas yet. We now read the conversation by ID anyway (not by
    // the message), and Convex has been strongly-consistent on
    // single-key reads since at least mid-2025. That sleep was costing
    // every single user request an unconditional 1 full second.

    // PERF — Fetch conversation + recent messages in PARALLEL.
    // These two queries are independent, but were previously sequential
    // (~150ms each → 300ms total). Running them in parallel halves
    // the pre-agent latency and makes the "Processing request…" → first
    // tool call gap noticeably snappier.
    const [conversation, recentMessages] = await Promise.all([
      step.run("get-conversation", async () => {
        return await convex.query(api.system.getConversationById, {
          internalKey,
          conversationId,
        });
      }),
      step.run("get-recent-messages", async () => {
        return await convex.query(api.system.getRecentMessages, {
          internalKey,
          conversationId,
          limit: 10,
        });
      }),
    ]);


    if (!conversation) {
      throw new NonRetriableError("Conversation not found");
    }

    // Build system prompt with conversation history (exclude the current processing message)
    let systemPrompt = CODING_AGENT_SYSTEM_PROMPT;

    // Filter out the current processing message and empty messages
    const contextMessages = recentMessages.filter(
      (msg) => msg._id !== messageId && msg.content.trim() !== ""
    );

    if (contextMessages.length > 0) {
      const historyText = contextMessages
        .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
        .join("\n\n");

      systemPrompt += `\n\n## Previous Conversation (for context only - do NOT repeat these responses):\n${historyText}\n\n## Current Request:\nRespond ONLY to the user's new message below. Do not repeat or reference your previous responses.`;
    }

    // Generate conversation title sequentially, before the coding agent.
    //
    // We tried two flavours of "in-parallel-with-the-coding-agent":
    //   1. wrapping it in `step.run` and not awaiting → broke step-ID
    //      ordering, the function hung after the first tool call.
    //   2. fire-and-forget `titleAgent.run(message)` → ALSO broke,
    //      because @inngest/agent-kit's internals detect they're inside
    //      an Inngest function and call `step.run(...)` for each LLM
    //      round-trip. Two agents stepping concurrently against the
    //      same Inngest context = step-ID collisions = silent deadlock.
    //
    // So we're back to sequential. Title gen is ~1-3s on first message
    // only, which is a small price for correctness. All the OTHER perf
    // wins (removed 1s sleep, fire-and-forget progress, faster file-
    // streaming defaults, parallel pre-agent queries) are unaffected.
    const shouldGenerateTitle =
      conversation.title === DEFAULT_CONVERSATION_TITLE;

    if (shouldGenerateTitle) {
      console.log("[ProcessMessage] Generating title...");
      const titleAgent = createAgent({
        name: "title-generator",
        system: TITLE_GENERATOR_SYSTEM_PROMPT,
        model: makeTitleModel(),
      });

      try {
        // HARD TIMEOUT — DeepSeek occasionally accepts the request but never
        // sends a response body (open socket, no bytes, no error). Without a
        // ceiling, `await titleAgent.run` blocks forever and the user sees
        // a perma-spinner on "Processing request…". 15s is plenty for a
        // 50-token title — if it hasn't responded in that window something
        // is wrong upstream and we should just skip the title and move on.
        const TITLE_TIMEOUT_MS = 15_000;
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Title generation timed out after ${TITLE_TIMEOUT_MS}ms`)),
            TITLE_TIMEOUT_MS
          )
        );
        const { output } = await Promise.race([
          titleAgent.run(message),
          timeoutPromise,
        ]);
        const textMessage = output.find(
          (m) => m.type === "text" && m.role === "assistant"
        );
        if (textMessage?.type === "text") {
          const title =
            typeof textMessage.content === "string"
              ? textMessage.content.trim()
              : textMessage.content.map((c) => c.text).join("").trim();
          if (title) {
            await step.run("update-conversation-title", async () => {
              await convex.mutation(api.system.updateConversationTitle, {
                internalKey,
                conversationId,
                title,
              });
            });
          }
        }
      } catch (err) {
        // Don't let a title hiccup take down the whole user request.
        console.warn("[ProcessMessage] Title generation failed:", err);
      }
    }

    // Create the coding agent with file tools.
    // Uses `makeCodingModel()` to honour AI_PROVIDER routing — defaults to
    // DeepSeek when DEEPSEEK_API_KEY is present, otherwise OpenAI.
    // The retry loop below ALSO swaps the agent's model to OpenAI on the
    // FINAL retry attempt when DeepSeek keeps 5xx-ing — see the long
    // "PROVIDER FAILOVER" comment near the bottom of the retry loop.
    const codingAgent = createAgent({
      name: "revdev",
      description: "An expert AI coding assistant",
      system: systemPrompt,
      model: makeCodingModel(),
       tools: (() => {
        // Phase D: every tool gets wrapped with Sentry capture + structured-error reporting.
        // Phase G: same wrapper now also pushes a one-line human play-by-play
        // narration to the assistant message BEFORE each tool runs. So we pass
        // internalKey/conversationId/messageId here so the wrapper can hit
        // Convex directly, without the main fn touching it.
        const wrapCtx = {
          projectId,
          conversationId,
          messageId,
          internalKey,
        };
        return [
          // Plan tools — agent MUST call createPlan first.
          // projectId is now passed so the tools can also mirror the plan to
          // a `PLAN.md` file at the project root (Phase H).
          wrapTool(createCreatePlanTool({ messageId, projectId, internalKey }), wrapCtx),
          wrapTool(createUpdatePlanStepTool({ messageId, projectId, internalKey }), wrapCtx),
          // File / project tools
          wrapTool(createListFilesTool({ internalKey, projectId }), wrapCtx),
          wrapTool(createReadFilesTool({ internalKey }), wrapCtx),
          wrapTool(createUpdateFileTool({ internalKey, projectId }), wrapCtx),
          wrapTool(createCreateFilesTool({ projectId, internalKey }), wrapCtx),
          wrapTool(createCreateFolderTool({ projectId, internalKey }), wrapCtx),
          wrapTool(createRenameFileTool({ internalKey }), wrapCtx),
          wrapTool(createDeleteFilesTool({ internalKey }), wrapCtx),
          wrapTool(createScrapeUrlsTool(), wrapCtx),
          // Sentry diagnostic tools — agent uses these to investigate prod errors.
          wrapTool(createListRecentErrorsTool(), wrapCtx),
          wrapTool(createInspectErrorTool(), wrapCtx),
        ];
       })(),
    });

    // Create network with single agent.
    //
    // maxIter bumped 20 → 40 because a 7-step plan with ~3-5 tool calls per
    // step (listFiles → readFiles → updateFile → updatePlanStep) routinely
    // hits 20 iterations — and when it does agent-kit throws, which trips
    // our `onFailure` handler and shows the user a generic "I encountered
    // an error" message even though several plan steps already succeeded.
    // 40 leaves comfortable headroom for the largest realistic plans.
    const network = createNetwork({
      name: "revdev-network",
      agents: [codingAgent],
      maxIter: 40,
      router: ({ network }) => {
        const lastResult = network.state.results.at(-1);
        const hasTextResponse = lastResult?.output.some(
          (m) => m.type === "text" && m.role === "assistant"
        );
        const hasToolCalls = lastResult?.output.some(
          (m) => m.type === "tool_call"
        );

        // Anthropic outputs text AND tool calls together
        // Only stop if there's text WITHOUT tool calls (final response)
        if (hasTextResponse && !hasToolCalls) {
          return undefined;
        }
        return codingAgent;
      }
    });

    // Run the agent.
    //
    // We deliberately DO NOT re-throw network errors that happen mid-run —
    // a thrown error trips our `onFailure` hook and stamps the message with
    // a generic "I encountered an error" body, wiping out any partial
    // progress the user can see in the activity panel. Instead we catch,
    // narrate, and synthesize a graceful "ran out of room" reply that keeps
    // all completed plan steps intact and tells the user how to continue.
    //
    // ----- Transient-failure retry --------------------------------------
    // Observed in production: agent-kit's tool-call argument parser is
    // strict JSON, but DeepSeek V4 occasionally emits tool-call arguments
    // that contain literal unescaped backticks (when copying a markdown
    // code fence into a `content` field). Agent-kit then throws
    //   "Failed to parse JSON with backticks: Expected ',' or '}'…"
    // mid-plan, killing the whole run after only ~50% of the plan steps
    // are done.
    //
    // We retry up to 2 times on that specific error. Because the network
    // keeps state.results across runs, the agent picks up exactly where
    // it left off — same plan, same files already created — and just
    // re-emits the failed tool call (this time, with a slightly different
    // sample, almost always parseable). Anecdotally this saves ~80% of
    // the otherwise-doomed runs.
    // --------------------------------------------------------------------
    let result: Awaited<ReturnType<typeof network.run>> | null = null;
    let networkError: unknown = null;
    // Treat the following as transient and worth a retry:
    //   • Tool-call JSON parse errors (DeepSeek occasionally emits backticks
    //     unescaped — see the long block below).
    //   • Upstream HTTP 5xx / 429 from the AI provider. DeepSeek
    //     specifically has been flaky with intermittent 503s during peak
    //     hours; the AIGatewayError surface from agent-kit serializes the
    //     status into the error message ("unsuccessful status code: 503"),
    //     so we just regex-match. With backoff + retry we usually recover
    //     within 2-3 attempts. Without it, the user sees a hard "Agent
    //     stopped early" message for what's effectively a transient blip.
    const isTransientParseErr = (e: unknown): boolean => {
      const m = e instanceof Error ? e.message : String(e);
      return (
        /Failed to parse JSON/i.test(m) ||
        /Unexpected token/i.test(m) ||
        /JSON at position/i.test(m)
      );
    };
    const isTransientHttpErr = (e: unknown): boolean => {
      const m = e instanceof Error ? e.message : String(e);
      // Match ALL 4xx-rate-limit + 5xx status codes from the upstream gateway.
      // We've now observed 503 (overloaded), 524 (Cloudflare origin timeout —
      // DeepSeek's upstream model server didn't respond in 100s), and the
      // fetch-level errors below. Erring on the side of "retry the model
      // call once" is essentially free vs. "user sees Agent stopped early".
      return (
        /unsuccessful status code:\s*(408|425|429|5\d\d)/i.test(m) ||
        /AIGatewayError/i.test(m) ||
        /ECONNRESET/i.test(m) ||
        /ETIMEDOUT/i.test(m) ||
        /socket hang up/i.test(m) ||
        /fetch failed/i.test(m)
      );
    };
    // Bumped from 2 → 4 because real-world flaky-upstream events tend to
    // last 10-30 seconds — with linear backoff (3s, 6s, 9s, 12s) we cover
    // ~30s of jitter without giving up too soon.
    const MAX_TRANSIENT_RETRIES = 4;
    let runAttempt = 0;
    let runPrompt = message;
    // PROVIDER FAILOVER state.
    //
    // After the DeepSeek retry budget is exhausted with HTTP failures, we
    // make ONE more attempt against OpenAI (if OPENAI_API_KEY is configured).
    // This requires rebuilding the agent + network with the OpenAI-flavored
    // model — agent-kit binds the model at agent construction time and there's
    // no public API to swap it on a live agent. We do that lazily, only if
    // we actually need it, so the OpenAI dependency stays cold for happy-path
    // requests. `failoverAttempted` ensures we don't loop forever if OpenAI
    // ALSO returns a 5xx (extremely unlikely but defend in depth).
    let failoverAttempted = false;
    const canFailover = HAS_OPENAI && AI_PROVIDER !== "openai";
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        if (runAttempt === 0) {
          console.log("[ProcessMessage] Running coding agent network...");
          await appendProgress("Starting coding agent...");
        } else {
          console.log(
            `[ProcessMessage] Retrying network.run after transient parse error (attempt ${runAttempt + 1})…`
          );
          await appendProgress(
            `🔁 Hiccup parsing the model's last tool call — retrying (attempt ${runAttempt + 1} of ${MAX_TRANSIENT_RETRIES + 1})…`
          );
        }
        // We deliberately do NOT wrap this in step.run — `network.run`
        // returns a NetworkRun object whose methods (run/schedule/
        // execute/etc.) we'd lose to step.run's JSON-roundtrip. The
        // AUTOMATIC_PARALLEL_INDEXING warnings you see in the dev log
        // are from agent-kit's internal `step.run("<agent-name>")`
        // calls — Inngest replays the whole function on every step
        // boundary, so the same agent-name step ID gets re-issued
        // many times. THAT'S NORMAL. Agent-kit handles its own step
        // ID disambiguation internally. The warnings are cosmetic,
        // they don't affect correctness.
        // HARD TOTAL-TIME TIMEOUT — same defence as the title agent above.
        // A real multi-step network.run typically completes in 30-120s; if
        // we're past 5 minutes the upstream is almost certainly hung, not
        // legitimately working. Without this ceiling the user sees an
        // infinite "Processing request…" spinner because no error ever
        // bubbles up. The race rejects on timeout, our outer catch sees
        // the timeout error, classifies it via /ETIMEDOUT/i (which the
        // existing isTransientHttpErr regex matches), and we retry with
        // backoff. After all retries exhaust we surface the friendly
        // "upstream is overloaded" message.
        const NETWORK_RUN_TIMEOUT_MS = 5 * 60_000;
        const networkTimeoutPromise = new Promise<never>((_, reject) => {
          const t = setTimeout(
            () =>
              reject(
                new Error(
                  `network.run timed out after ${NETWORK_RUN_TIMEOUT_MS}ms (upstream likely hung; ETIMEDOUT)`
                )
              ),
            NETWORK_RUN_TIMEOUT_MS
          );
          // Don't keep the Node process alive just for this timer.
          if (typeof t.unref === "function") t.unref();
        });
        result = await Promise.race([
          network.run(runPrompt),
          networkTimeoutPromise,
        ]);
        console.log("[ProcessMessage] Coding agent finished");
        break;
      } catch (err) {
        const parseTransient = isTransientParseErr(err);
        const httpTransient = isTransientHttpErr(err);
        if ((parseTransient || httpTransient) && runAttempt < MAX_TRANSIENT_RETRIES) {
          runAttempt += 1;
          if (httpTransient) {
            // Linear backoff before retrying — gives the upstream a chance to
            // recover. 3s, 6s, 9s, 12s. We use a real sleep (not step.sleep)
            // because we're inside a try/catch loop, not a step boundary.
            const delayMs = runAttempt * 3000;
            const errMsg = err instanceof Error ? err.message : String(err);
            console.warn(
              `[ProcessMessage] Transient upstream error (${errMsg.slice(0, 80)}), backing off ${delayMs}ms before retry ${runAttempt}/${MAX_TRANSIENT_RETRIES}`
            );
            await appendProgress(
              `⏳ Upstream AI is busy — waiting ${delayMs / 1000}s and retrying (attempt ${runAttempt + 1} of ${MAX_TRANSIENT_RETRIES + 1})…`
            );
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            // Don't change the prompt for HTTP retries — just try again with
            // the same input. The model isn't at fault, the network is.
            continue;
          }
          // Re-prompt with an explicit reminder. The accumulated
          // state.results stays — only the seed message changes.
          runPrompt =
            `[CONTINUE] Your previous tool call failed to parse — likely due to ` +
            `unescaped backticks or a quoting mistake in the JSON arguments. ` +
            `Resume the plan from where you left off. When you next call any ` +
            `tool with a "content" field, AVOID putting raw backtick-fenced ` +
            `code blocks in that field; just emit the file's content directly ` +
            `as a plain string.`;
          continue;
        }
        // PROVIDER FAILOVER — last-ditch attempt against OpenAI.
        //
        // We get here when DeepSeek has burned the entire retry budget on
        // HTTP errors (503/524/etc.). Rather than ship the user a "sorry,
        // come back in a minute" message, swap the agent's model out for
        // OpenAI and try ONCE more. Conditions:
        //   • the error must be HTTP-transient (don't waste $$ on parse
        //     errors — those are model-output issues, not provider issues)
        //   • OpenAI must be configured (`OPENAI_API_KEY` set)
        //   • we haven't already tried failing over (one shot only)
        //   • we weren't already on OpenAI (AI_PROVIDER!=openai)
        // If the failover ALSO fails we just fall through to the
        // user-facing "stopped early" message below.
        if (httpTransient && canFailover && !failoverAttempted) {
          failoverAttempted = true;
          console.warn(
            `[ProcessMessage] DeepSeek exhausted ${MAX_TRANSIENT_RETRIES + 1} retries — failing over to OpenAI (${OPENAI_CODING_MODEL})`
          );
          await appendProgress(
            `🔀 DeepSeek is unreachable — switching to OpenAI (${OPENAI_CODING_MODEL}) for this request…`
          );
          try {
            // Hot-swap the model on the existing agent. agent-kit holds
            // it as a public mutable property, so this is safe — the
            // agent's tools, system prompt, and the network's
            // accumulated state.results all stay intact, meaning if the
            // DeepSeek run got partway (some plan steps already done,
            // some files already created) the OpenAI continuation
            // picks up from exactly there. No work redone.
            (codingAgent as unknown as { model: ReturnType<typeof makeOpenAiCodingModel> }).model =
              makeOpenAiCodingModel();
            // Same total-time guard as above. OpenAI is much faster
            // than DeepSeek so 5min is overkill but consistent.
            const ofTimeoutPromise = new Promise<never>((_, reject) => {
              const t = setTimeout(
                () => reject(new Error("OpenAI failover timed out (ETIMEDOUT)")),
                5 * 60_000
              );
              if (typeof t.unref === "function") t.unref();
            });
            result = await Promise.race([
              network.run(
                `[CONTINUE — provider switched from DeepSeek to OpenAI mid-run] ` +
                `Resume the plan from where you left off. Don't redo any plan ` +
                `step you've already marked done; just complete the remaining ones. ` +
                `Original user request: ${message}`
              ),
              ofTimeoutPromise,
            ]);
            console.log("[ProcessMessage] OpenAI failover succeeded");
            await appendProgress(
              "✅ OpenAI failover succeeded — finishing the request."
            );
            networkError = null;
            break;
          } catch (failoverErr) {
            const fmsg =
              failoverErr instanceof Error
                ? failoverErr.message
                : String(failoverErr);
            console.warn("[ProcessMessage] OpenAI failover ALSO failed:", fmsg);
            await appendProgress(
              `⚠️  OpenAI failover also failed: ${fmsg.slice(0, 160)}`
            );
            // Fall through to the "stopped early" message below — both
            // providers are down.
          }
        }
        // Either non-transient OR we've exhausted retries (and either
        // can't failover or failover already failed) — bail out
        // gracefully and show partial progress.
        networkError = err;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[ProcessMessage] network.run threw:", msg);
        // Friendlier message for the common 503 case so users don't think
        // it's our bug.
        const isUpstream503 = /503|524|AIGatewayError/i.test(msg);
        const userMsg = isUpstream503
          ? `⚠️  The AI provider is currently overloaded (HTTP 5xx). I retried ${MAX_TRANSIENT_RETRIES + 1} times${canFailover ? " and tried OpenAI failover" : ""}, but it's still failing. Please reply with "continue" in a minute or two and I'll pick up where I left off.`
          : `⚠️  Agent stopped early: ${msg.slice(0, 200)}. Partial progress is preserved — reply with "continue" to pick up where I left off.`;
        await appendProgress(userMsg);
        break;
      }
    }

    try {
      // If the network blew up with no usable result at all, write a
      // user-facing summary into the message body and bail out gracefully
      // (do NOT re-throw — that would trigger onFailure which clobbers
      // the activity panel and plan progress).
      if (!result) {
        await step.run("update-assistant-on-network-error", async () => {
          await convex.mutation(api.system.updateMessageContent, {
            internalKey,
            messageId,
            content:
              "I started working but had to stop before finishing. Any plan steps marked ✓ above are saved. Reply with **\"continue\"** and I'll pick up where I left off, or describe a different change you'd like.",
          });
        });
        return { success: true, messageId, conversationId, recovered: true };
      }

      // Track file operations from tool calls
      const metadata: FileOperationMetadata = {
        filesRead: [],
        filesModified: [],
        filesCreated: [],
        filesDeleted: [],
      };

      // Extract tool calls from all results to build the per-message metadata
      // (filesRead / filesModified / filesCreated etc.) used by the chat UI's
      // collapsible "Files touched" section.
      //
      // Note: live, in-flight narration of each tool call is handled by the
      // wrapTool() decorator — it pushes "📖 Reading X" / "✏️ Editing Y" lines
      // BEFORE each tool runs, so the user sees activity in real time. Doing
      // it again here would just duplicate every line.
      for (const agentResult of result.state.results) {
        for (const output of agentResult.output) {
          // The agent-kit ToolCallMessage type doesn't expose name/input on the
          // public union, but they're always present at runtime. Cast through
          // unknown to dodge the TS narrowing.
          if ((output as { type: string }).type !== "tool_call") continue;
          const tc = output as unknown as {
            type: "tool_call";
            name: string;
            input?: Record<string, unknown>;
          };
          const toolName = tc.name;
          const toolInput = tc.input ?? {};

          // Update metadata based on tool — note tool names match the Inngest
          // agent-kit `createTool({name})` strings, NOT the snake_case alias.
          if ((toolName === "readFiles" || toolName === "read_files") && toolInput.paths) {
            const paths = toolInput.paths as string[];
            metadata.filesRead.push(
              ...paths.filter((p) => !metadata.filesRead.includes(p))
            );
          } else if (
            (toolName === "updateFile" || toolName === "update_file") &&
            toolInput.path
          ) {
            const path = toolInput.path as string;
            const content = (toolInput.content as string) || "";
            const existingIdx = metadata.filesModified.findIndex(
              (f) => f.path === path
            );
            const lines = content.split("\n").length;
            if (existingIdx >= 0) {
              metadata.filesModified[existingIdx].linesAdded += lines;
            } else {
              metadata.filesModified.push({
                path,
                linesAdded: lines,
                linesRemoved: 0,
              });
            }
          } else if (
            (toolName === "createFiles" || toolName === "create_files") &&
            toolInput.files
          ) {
            // BUG FIX: createFiles tool's schema is { name, content } NOT { path }.
            // Reading f.path here was producing [undefined, undefined], which broke
            // the touchedTs check and meant the compile-gate never ran.
            const files = toolInput.files as { name?: string }[];
            const names = files
              .map((f) => f?.name)
              .filter((n): n is string => Boolean(n));
            metadata.filesCreated.push(
              ...names.filter((p) => !metadata.filesCreated.includes(p))
            );
          } else if (
            (toolName === "deleteFiles" || toolName === "delete_files") &&
            toolInput.paths
          ) {
            const paths = toolInput.paths as string[];
            metadata.filesDeleted.push(
              ...paths.filter((p) => !metadata.filesDeleted.includes(p))
            );
          } else if (
            (toolName === "renameFile" || toolName === "rename_file") &&
            toolInput.oldPath &&
            toolInput.newPath
          ) {
            metadata.filesModified.push({
              path: `${toolInput.oldPath} → ${toolInput.newPath}`,
              linesAdded: 0,
              linesRemoved: 0,
            });
          }
        }
      }

      // Extract the assistant's text response from the last agent result
      const lastResult = result.state.results.at(-1);
      const textMessage = lastResult?.output.find(
        (m) => m.type === "text" && m.role === "assistant"
      );

      let assistantResponse =
        "I processed your request. Let me know if you need anything else!";

      if (textMessage?.type === "text") {
        assistantResponse =
          typeof textMessage.content === "string"
            ? textMessage.content
            : textMessage.content.map((c) => c.text).join("");
      }

      // Build metadata object (only include non-empty arrays)
      const messageMetadata = {
        ...(metadata.filesRead.length > 0 && { filesRead: metadata.filesRead }),
        ...(metadata.filesModified.length > 0 && { filesModified: metadata.filesModified }),
        ...(metadata.filesCreated.length > 0 && { filesCreated: metadata.filesCreated }),
        ...(metadata.filesDeleted.length > 0 && { filesDeleted: metadata.filesDeleted }),
      };

      // Update the assistant message with the response and metadata
      await step.run("update-assistant-message", async () => {
        await convex.mutation(api.system.updateMessageContent, {
          internalKey,
          messageId,
          content: assistantResponse,
          ...(Object.keys(messageMetadata).length > 0 && { metadata: messageMetadata }),
        })
      });

      // -----------------------------------------------------------------
      // Phase F — Compile Gate
      // -----------------------------------------------------------------
      // Run a full TypeScript check across the project's files. The Preview
      // tab in the UI subscribes to `buildChecks.getByProject` and stays
      // disabled until this comes back "passed". On failure we don't crash
      // the run — we just record the errors so the user can ask the agent
      // to fix them.
      //
      // Skipped silently if the agent did NOT touch any .ts/.tsx files
      // (e.g. it only edited markdown or the user just chatted).
      const touchedTs =
        metadata.filesCreated.some((p) => /\.(ts|tsx)$/i.test(p)) ||
        metadata.filesModified.some((f) => /\.(ts|tsx)$/i.test(f.path));

      if (touchedTs) {
        try {
          // -----------------------------------------------------------
          // Self-healing compile loop.
          //
          // Was: we'd run the compile check ONCE, write the errors to
          // Convex, and leave the user staring at "❌ Build failed with
          // 12 errors" — they'd have to type "fix it" to get the agent
          // to take another swing. The user explicitly asked: "i want
          // there will be not such error thing there might 1 or 2 error
          // but not much".
          //
          // New approach: if the first compile fails, we feed the error
          // list back to the SAME agent network in-place and let it
          // patch the issues, then re-check. We repeat up to 2 fix
          // passes (so worst case 3 compiles total: initial + 2 retries)
          // before giving up and surfacing whatever errors remain. Two
          // passes is the right ceiling because:
          //   • single-shot fixes are common (one missing import, etc.)
          //   • compound fixes need a second look at the actual files
          //   • beyond 2, the model is probably going in circles and
          //     it's better to bail and let the user steer.
          // -----------------------------------------------------------
          const MAX_FIX_PASSES = 2;
          let pass = 0;
          // eslint-disable-next-line no-constant-condition
          while (true) {
            await step.run(`build-check-start-${pass}`, async () => {
              await convex.mutation(api.buildChecks.start, {
                internalKey,
                projectId,
              });
            });

            if (pass === 0) {
              await appendProgress("🛠️  Compiling project to verify everything builds…");
            } else {
              await appendProgress(
                `🛠️  Re-checking build after fix pass ${pass} of ${MAX_FIX_PASSES}…`
              );
            }

            const compileResult = await step.run(
              `build-check-run-${pass}`,
              async () => compileCheck(projectId, internalKey)
            );

            await step.run(`build-check-finish-${pass}`, async () => {
              await convex.mutation(api.buildChecks.finish, {
                internalKey,
                projectId,
                errors: compileResult.errors,
                fileCount: compileResult.fileCount,
                durationMs: compileResult.durationMs,
              });
            });

            if (compileResult.errors.length === 0) {
              if (pass === 0) {
                await appendProgress(
                  `✅ Build passed — ${compileResult.fileCount} file(s) checked in ${compileResult.durationMs}ms. Preview is unlocked.`
                );
              } else {
                await appendProgress(
                  `✅ Self-heal succeeded after ${pass} fix pass${pass === 1 ? "" : "es"} — Preview is unlocked.`
                );
              }
              break;
            }

            // We have errors. If we've burned all our fix passes, surface
            // the residual errors and exit the loop.
            if (pass >= MAX_FIX_PASSES) {
              const head = compileResult.errors.slice(0, 3);
              const lines = head
                .map(
                  (e) =>
                    `   • ${e.file}:${e.line}:${e.column}${e.code ? ` (TS${e.code})` : ""} — ${e.message.slice(0, 140)}`
                )
                .join("\n");
              const more =
                compileResult.errors.length > 3
                  ? `\n   …and ${compileResult.errors.length - 3} more`
                  : "";
              // MAX_FIX_PASSES is a compile-time constant = 2, so "passes"
              // (plural) is the only correct word here. Was previously a
              // ternary that TS rightly flagged as unreachable.
              await appendProgress(
                `❌ Build still failing after ${MAX_FIX_PASSES} self-heal passes — ${compileResult.errors.length} error(s) remain:\n${lines}${more}\n\nReply with "fix it" or describe the change you want and I'll keep patching.`
              );
              break;
            }

            // Otherwise dispatch a fix pass: feed errors back to the
            // agent network and let it patch them. We reuse the same
            // network (and its accumulated state.results history) so
            // the agent has full context of what it just built and
            // why something didn't compile.
            pass += 1;

            const head = compileResult.errors.slice(0, 8);
            const blob = head
              .map(
                (e) =>
                  `- ${e.file}:${e.line}:${e.column}${e.code ? ` (TS${e.code})` : ""}  ${e.message.slice(0, 200)}`
              )
              .join("\n");
            const more =
              compileResult.errors.length > 8
                ? `\n…and ${compileResult.errors.length - 8} more (same shape)`
                : "";
            await appendProgress(
              `🔧 Self-healing — feeding ${compileResult.errors.length} error(s) back to the agent (pass ${pass} of ${MAX_FIX_PASSES})…`
            );

            const fixPrompt =
              `[AUTO-FIX] The project I just generated has TypeScript compile errors. ` +
              `Please diagnose and patch them. Aim for zero residual errors after this pass.\n\n` +
              `Compile errors:\n\`\`\`\n${blob}${more}\n\`\`\``;

            try {
              // Wrap the fix-pass network.run in its own Inngest step.
              // Without this Inngest sees the agent-kit's internal step IDs
              // ("revdev", "revdev-tool-call-N", …) reused across passes
              // and emits AUTOMATIC_PARALLEL_INDEXING warnings — which in
              // some failure modes can also corrupt replay state. A unique
              // outer step ID per pass keeps each network.run isolated in
              // its own deterministic scope.
              await step.run(`self-heal-pass-${pass}`, async () => {
                await network.run(fixPrompt);
              });
            } catch (fixErr) {
              const msg = fixErr instanceof Error ? fixErr.message : String(fixErr);
              console.warn(`[ProcessMessage] Self-heal pass ${pass} threw:`, msg);
              await appendProgress(
                `⚠️  Self-heal pass ${pass} stopped early: ${msg.slice(0, 160)}`
              );
              // Don't break — give the next pass a chance with whatever
              // partial fixes did land. If `pass >= MAX_FIX_PASSES` the
              // top of the loop will surface the remaining errors.
            }
          }
        } catch (err) {
          console.error("[ProcessMessage] Compile check failed:", err);
          // Mark as failed-to-run so the UI doesn't hang on "Building..."
          try {
            await convex.mutation(api.buildChecks.finish, {
              internalKey,
              projectId,
              errors: [
                {
                  file: "(compile-check)",
                  line: 0,
                  column: 0,
                  message: `Compile check itself crashed: ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
              fileCount: 0,
              durationMs: 0,
            });
          } catch {
            /* swallow — Convex unreachable, nothing we can do */
          }
        }
      }
    } catch (error) {
       console.error("[ProcessMessage] Error in post-run processing:", error);
       // Same defence as above — never re-throw. The user's plan progress is
       // already in Convex; the worst-case is they see no final reply, which
       // is far better than a wiped message body.
       try {
         await step.run("update-assistant-on-post-error", async () => {
           await convex.mutation(api.system.updateMessageContent, {
             internalKey,
             messageId,
             content:
               "I finished working but ran into a problem writing the summary. Your changes are saved — open the editor to review them.",
           });
         });
       } catch {
         /* swallow — Convex unreachable, nothing we can do */
       }
    } finally {
      // ALWAYS force-finish any orphaned editor stream on the way out, even if
      // the agent threw mid-write. Otherwise the UI hangs forever showing
      // "AI is writing X" with a half-typed file. Race-safe: editorStreams.finish
      // is a no-op if there's no active stream.
      //
      // ORDERING IS LOAD-BEARING:
      //   1. First, await any background streamFileWrite loops still ticking
      //      out their last few chunks. These were started fire-and-forget
      //      from createFiles / updateFile and live in the in-process
      //      `inFlight` map of `_streaming.ts`. If we skip this and call
      //      finish() right away, the stream loops keep firing append()
      //      against a "completed" record — the UI sees content keep
      //      growing AFTER the agent has already returned its final
      //      summary. This was the bug the user reported as "after task
      //      finishes the stream is still going on, it's showing among
      //      all files".
      //   2. THEN flip the project's editorStream to status="completed".
      //      Now no one is racing us to keep it open and the UI cleanly
      //      switches from StreamingEditor → CodeEditor.
      try {
        await waitForStreamsToDrain(String(projectId));
      } catch (err) {
        // Streams already swallow their own errors, but defend in depth.
        console.warn("[ProcessMessage] waitForStreamsToDrain threw:", err);
      }
      try {
        await step.run("force-finish-editor-stream", async () => {
          await convex.mutation(api.editorStreams.finish, {
            internalKey,
            projectId,
          });
        });
      } catch (err) {
        console.warn("[ProcessMessage] Could not force-finish editor stream:", err);
      }

      // Same for the plan: if the network bailed mid-run, mark all still-
      // running/pending steps as skipped so the chat doesn't show a perma-
      // spinner on the orphaned plan. Best-effort, never blocks return.
      if (networkError) {
        try {
          await step.run("skip-plan-on-network-error", async () => {
            await convex.mutation(api.plans.cancelActiveSteps, {
              internalKey,
              messageId,
            });
          });
        } catch {
          /* swallow */
        }
      }
    }

    return { success: true, messageId, conversationId };
  }
);

