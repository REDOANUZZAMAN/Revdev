import { z } from "zod";
import { createTool } from "@inngest/agent-kit";

import {
  listRecentIssues,
  getLatestEvent,
  formatEventForAgent,
  type SentryIssue,
} from "@/lib/sentry-api";

// =============================================================================
// listRecentErrors — agent calls this to see what's actually breaking in prod.
// =============================================================================
export const createListRecentErrorsTool = () =>
  createTool({
    name: "listRecentErrors",
    description:
      "List recent unresolved errors from Sentry for THIS project. Use this when the user asks why something is broken, when a step failed unexpectedly, or when you need to triage runtime issues. Returns one line per issue with its id, title, count, and last-seen timestamp. Follow up with inspectError(issueId) for stacktraces.",
    parameters: z.object({
      hours: z
        .number()
        .int()
        .min(1)
        .max(720)
        .optional()
        .describe("Time window in hours. Default 24."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Max issues to return. Default 10."),
      query: z
        .string()
        .optional()
        .describe(
          "Optional Sentry search query (e.g. 'is:unresolved level:error message:undefined')"
        ),
    }),
    handler: async (params, { step: toolStep }) => {
      try {
        return await toolStep?.run("list-recent-errors", async () => {
          const hours = params.hours ?? 24;
          const limit = params.limit ?? 10;
          const issues = await listRecentIssues({
            statsPeriod: `${hours}h`,
            limit,
            query: params.query ?? "is:unresolved",
          });

          if (issues.length === 0) {
            return "No matching issues in Sentry. (Either nothing's broken or the query returned empty.)";
          }

          const lines = issues.map(
            (i: SentryIssue) =>
              `- [${i.id}] ${i.level.toUpperCase()} · ${i.title}${i.culprit ? ` @ ${i.culprit}` : ""} · count=${i.count} users=${i.userCount} lastSeen=${i.lastSeen}`
          );
          return `Found ${issues.length} Sentry issue(s) in last ${hours}h:\n${lines.join("\n")}`;
        });
      } catch (error) {
        return `Error querying Sentry: ${error instanceof Error ? error.message : "Unknown error"}`;
      }
    },
  });

// =============================================================================
// inspectError — fetch the stacktrace + breadcrumbs for a specific issue.
// =============================================================================
export const createInspectErrorTool = () =>
  createTool({
    name: "inspectError",
    description:
      "Fetch the most recent event for a Sentry issue, including stacktrace, breadcrumbs, and request context. Use this AFTER listRecentErrors to dig into a specific failure before proposing a code fix.",
    parameters: z.object({
      issueId: z
        .string()
        .min(1)
        .describe("The Sentry issue id (the bracketed token from listRecentErrors output)"),
    }),
    handler: async (params, { step: toolStep }) => {
      try {
        return await toolStep?.run("inspect-error", async () => {
          // We need the issue summary AND the latest event. The simplest correct
          // path is: list one issue with id-equality, then fetch its event.
          // But Sentry's `/issues/{id}/` endpoint is also fine; we'll fetch the
          // event directly and synthesize a minimal "issue" from its fields.
          const event = await getLatestEvent(params.issueId);

          // Build a synthetic issue summary from the event for formatting.
          const syntheticIssue = {
            id: params.issueId,
            shortId: params.issueId,
            title: event.title,
            culprit: event.culprit ?? null,
            level: (event.tags?.find((t) => t.key === "level")?.value ?? "error"),
            status: "unresolved",
            count: "1",
            userCount: 0,
            firstSeen: event.dateCreated,
            lastSeen: event.dateCreated,
            permalink: "",
          };

          return formatEventForAgent(syntheticIssue, event);
        });
      } catch (error) {
        return `Error fetching Sentry event for issue ${params.issueId}: ${error instanceof Error ? error.message : "Unknown error"}`;
      }
    },
  });
