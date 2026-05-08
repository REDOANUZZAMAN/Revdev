/**
 * Thin client for the Sentry REST API.
 *
 * Used by the Inngest agent (Phase E) so the LLM can fetch real production
 * errors and reason about fixes. Server-side ONLY — never import this from
 * any client component, the auth token must not leak to the browser.
 *
 * Docs: https://docs.sentry.io/api/
 */

interface SentryEnv {
  token: string;
  org: string;
  project: string;
  region: string; // e.g. "us" or "de" — controls the API hostname
}

const getEnv = (): SentryEnv => {
  const token = process.env.SENTRY_AUTH_TOKEN;
  const org = process.env.SENTRY_ORG_SLUG;
  const project = process.env.SENTRY_PROJECT_SLUG;
  const region = process.env.SENTRY_REGION ?? "us";

  if (!token) throw new Error("SENTRY_AUTH_TOKEN is not configured");
  if (!org) throw new Error("SENTRY_ORG_SLUG is not configured");
  if (!project) throw new Error("SENTRY_PROJECT_SLUG is not configured");

  return { token, org, project, region };
};

const apiBase = (region: string) => `https://${region}.sentry.io/api/0`;

const sentryFetch = async <T>(
  path: string,
  env: SentryEnv,
  init?: RequestInit
): Promise<T> => {
  const res = await fetch(`${apiBase(env.region)}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Sentry API ${res.status} ${res.statusText} on ${path}: ${body.slice(0, 300)}`
    );
  }

  return res.json() as Promise<T>;
};

// =============================================================================
// Public types — kept minimal; we only surface the fields the agent will use.
// =============================================================================
export interface SentryIssue {
  id: string;
  shortId: string;
  title: string;
  culprit?: string | null;
  level: string; // "error" | "warning" | "info" | …
  status: string; // "unresolved" | "resolved" | "ignored"
  count: string; // Sentry returns this as a string
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  permalink: string;
}

export interface SentryEventFrame {
  filename?: string;
  function?: string;
  lineNo?: number;
  colNo?: number;
  inApp?: boolean;
  contextLine?: string;
  preContext?: string[];
  postContext?: string[];
}

export interface SentryEventException {
  type?: string;
  value?: string;
  stacktrace?: {
    frames?: SentryEventFrame[];
  };
}

export interface SentryEventDetail {
  id: string;
  eventID: string;
  title: string;
  message?: string;
  culprit?: string | null;
  platform?: string;
  dateCreated: string;
  exception?: { values?: SentryEventException[] };
  breadcrumbs?: { values?: Array<{ category?: string; message?: string; level?: string; timestamp?: string }> };
  request?: { url?: string; method?: string };
  user?: { id?: string; email?: string; ip_address?: string };
  tags?: Array<{ key: string; value: string }>;
}

// =============================================================================
// API methods
// =============================================================================

/**
 * List recent issues for the configured Sentry project.
 *
 * @param opts.statsPeriod e.g. "24h", "7d", "30d". Default 24h.
 * @param opts.limit       Max issues to return. Default 25, max 100.
 * @param opts.query       Sentry search query string (e.g. "is:unresolved level:error").
 */
export async function listRecentIssues(opts?: {
  statsPeriod?: string;
  limit?: number;
  query?: string;
}): Promise<SentryIssue[]> {
  const env = getEnv();
  const params = new URLSearchParams();
  params.set("statsPeriod", opts?.statsPeriod ?? "24h");
  params.set("limit", String(Math.min(Math.max(opts?.limit ?? 25, 1), 100)));
  if (opts?.query) params.set("query", opts.query);

  return sentryFetch<SentryIssue[]>(
    `/projects/${env.org}/${env.project}/issues/?${params.toString()}`,
    env
  );
}

/**
 * Fetch the latest event (with stacktrace + breadcrumbs) for an issue.
 *
 * Sentry "issues" group similar events; the latest event is what you'd want
 * to see in the UI when debugging "what's actually broken right now".
 */
export async function getLatestEvent(issueId: string): Promise<SentryEventDetail> {
  const env = getEnv();
  return sentryFetch<SentryEventDetail>(
    `/issues/${encodeURIComponent(issueId)}/events/latest/`,
    env
  );
}

/**
 * Convenience: list issues, pick the most recent N, fetch their latest events.
 * Returns issues paired with their event detail for one-shot agent inspection.
 */
export async function getRecentIssuesWithEvents(opts?: {
  statsPeriod?: string;
  limit?: number;
  query?: string;
}): Promise<Array<{ issue: SentryIssue; event: SentryEventDetail | null }>> {
  const issues = await listRecentIssues({
    ...opts,
    limit: Math.min(opts?.limit ?? 5, 10), // cap heavy hydration
  });

  return Promise.all(
    issues.map(async (issue) => {
      try {
        const event = await getLatestEvent(issue.id);
        return { issue, event };
      } catch {
        return { issue, event: null };
      }
    })
  );
}

/**
 * Format an issue + event into a compact, model-friendly summary string.
 * Used by the agent tool so the LLM gets just the high-signal bits.
 */
export function formatEventForAgent(
  issue: SentryIssue,
  event: SentryEventDetail | null
): string {
  const lines: string[] = [];
  lines.push(`# ${issue.title}`);
  lines.push(`Issue ID: ${issue.id}  ·  Level: ${issue.level}  ·  Count: ${issue.count}  ·  Affected users: ${issue.userCount}`);
  if (issue.culprit) lines.push(`Culprit: ${issue.culprit}`);
  lines.push(`First seen: ${issue.firstSeen}  ·  Last seen: ${issue.lastSeen}`);
  lines.push(`Link: ${issue.permalink}`);

  if (!event) {
    lines.push("\n(No event detail available — only the summary above.)");
    return lines.join("\n");
  }

  const exc = event.exception?.values?.[0];
  if (exc) {
    lines.push(`\n## Exception\n${exc.type ?? "Error"}: ${exc.value ?? ""}`);
    const frames = exc.stacktrace?.frames ?? [];
    // Sentry returns frames oldest→newest; show the last 8 most-relevant in-app frames.
    const inAppFrames = frames.filter((f) => f.inApp).slice(-8);
    const showFrames = inAppFrames.length > 0 ? inAppFrames : frames.slice(-8);
    if (showFrames.length > 0) {
      lines.push("\n## Stacktrace (most recent in-app frames)");
      for (const f of showFrames) {
        const where = `${f.filename ?? "?"}:${f.lineNo ?? "?"}${f.colNo ? ":" + f.colNo : ""}`;
        lines.push(`  at ${f.function ?? "<anonymous>"} (${where})`);
        if (f.contextLine) lines.push(`     > ${f.contextLine.trim()}`);
      }
    }
  }

  const crumbs = event.breadcrumbs?.values ?? [];
  if (crumbs.length > 0) {
    lines.push("\n## Last 5 breadcrumbs");
    for (const c of crumbs.slice(-5)) {
      lines.push(`  [${c.level ?? "info"}] ${c.category ?? ""} — ${c.message ?? ""}`);
    }
  }

  if (event.request?.url) {
    lines.push(`\n## Request\n${event.request.method ?? "GET"} ${event.request.url}`);
  }

  return lines.join("\n");
}
