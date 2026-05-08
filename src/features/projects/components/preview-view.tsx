"use client";

import ky from "ky";
import { toast } from "sonner";
import { useEffect, useMemo, useRef, useState } from "react";
import { Allotment } from "allotment";
import {
  Loader2Icon,
  TerminalSquareIcon,
  AlertTriangleIcon,
  RefreshCwIcon,
  DownloadIcon,
  WandSparklesIcon,
  XIcon,
  ExternalLinkIcon,
  CopyIcon,
  CheckIcon,
} from "lucide-react";

import { useWebContainer } from "@/features/preview/hooks/use-webcontainer";
import { PreviewSettingsPopover } from "@/features/preview/components/preview-settings-popover";
import { PreviewTerminal } from "@/features/preview/components/preview-terminal";
import { downloadProjectAsZip } from "@/features/preview/utils/download-project";

import { Button } from "@/components/ui/button";

import { useProject } from "../hooks/use-projects";
import { useFiles } from "../hooks/use-files";
import {
  useConversations,
  useCreateConversation,
  useMessages,
} from "@/features/conversations/hooks/use-conversations";
import { DEFAULT_CONVERSATION_TITLE } from "@/features/conversations/constants";

import { Id } from "../../../../convex/_generated/dataModel";

// -----------------------------------------------------------------------------
// Phase H — Auto-fix preview build errors with AI.
// -----------------------------------------------------------------------------
//
// When the WebContainer dev server prints a build error to stdout (e.g.
// "Failed to compile … Module not found"), we'd previously show that error
// inside the iframe and the user would have to copy-paste the message into
// chat themselves. The user explicitly asked for a hands-free flow:
//
//   "i want the error will auto fix by ai when ever the error will come the
//    ai will auto resolve the error and make plan for the and auto solve that"
//
// This module detects fresh build errors from `terminalOutput` and dispatches
// a `[AUTO-FIX]` message to the project's most-recent conversation. The agent
// already has a planning tool, so it'll createPlan() → fix → updatePlanStep()
// and the activity panel will narrate progress to the user.

/** Recognise the most common Next.js / WebContainer build error patterns. */
const ERROR_MARKERS = [
  "Failed to compile",
  "Module not found",
  "SyntaxError:",
  "ReferenceError:",
  "TypeError:",
  "Error: Cannot find module",
];

/**
 * Pull the latest error block out of the terminal output.
 *
 * Returns null when the output looks healthy. We only want to fire on REAL
 * errors, so we check the *tail* of the output (HMR will print "Compiled
 * successfully" after a recovered failure, and we want that to count as
 * recovered).
 */
function parseBuildError(
  output: string
): { fingerprint: string; details: string } | null {
  if (!output) return null;

  // If the LATEST signal is "Compiled successfully" or "ready", the error has
  // already been fixed — bail out.
  const tail = output.slice(-8000);
  const lastSuccessIdx = Math.max(
    tail.lastIndexOf("Compiled successfully"),
    tail.lastIndexOf("compiled successfully"),
    tail.lastIndexOf("✓ Compiled"),
    tail.lastIndexOf("Local:")
  );
  // Find the latest error marker.
  let lastErrorIdx = -1;
  let matchedMarker = "";
  for (const m of ERROR_MARKERS) {
    const idx = tail.lastIndexOf(m);
    if (idx > lastErrorIdx) {
      lastErrorIdx = idx;
      matchedMarker = m;
    }
  }
  if (lastErrorIdx === -1) return null;
  // Error is older than the last success → recovered.
  if (lastSuccessIdx > lastErrorIdx) return null;

  // Grab a slice starting at the marker and capped at 2KB so we don't blast
  // the agent with the whole terminal.
  const block = tail.slice(lastErrorIdx, lastErrorIdx + 2000);

  // Fingerprint = the first non-whitespace 240 chars after the marker. That's
  // enough to distinguish "missing CartContext" from "missing FooBar" while
  // still treating "same error after a flicker" as the SAME error.
  const fingerprint = block
    .slice(0, 240)
    .replace(/\s+/g, " ")
    .trim();

  return { fingerprint: `${matchedMarker}|${fingerprint}`, details: block };
}

const AUTO_FIX_COUNTDOWN_S = 4;

export const PreviewView = ({ projectId }: { projectId: Id<"projects"> }) => {
  const project = useProject(projectId);
  const files = useFiles(projectId);
  const [showTerminal, setShowTerminal] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);

  const {
    status, previewUrl, error, restart, terminalOutput
  } = useWebContainer({
    projectId,
    enabled: true,
    settings: project?.settings,
  });

  const isLoading = status === "booting" || status === "installing";

  // ---------- Auto-fix wiring ----------
  const conversations = useConversations(projectId);
  const activeConversationId = conversations?.[0]?._id ?? null;
  // Pull the chat's status — we don't dispatch auto-fix while the agent is
  // already busy with another request, otherwise we'd cancel its in-flight
  // work and lose context.
  const messages = useMessages(activeConversationId);
  const isAgentBusy = messages?.some((m) => m.status === "processing") ?? false;
  const createConversation = useCreateConversation();

  const buildError = useMemo(
    () => parseBuildError(terminalOutput),
    [terminalOutput]
  );

  // Fingerprints we've already dispatched. Prevents re-firing on the same
  // error (which would otherwise spam the agent every keystroke until the
  // file is fixed). Resetting a fingerprint requires a fresh, *different*
  // error to come through.
  const dispatchedRef = useRef<Set<string>>(new Set());
  const [countdown, setCountdown] = useState<number | null>(null);
  const [autoFixedThisError, setAutoFixedThisError] = useState(false);

  // Reset "auto-fixed banner" state whenever the error fingerprint changes.
  useEffect(() => {
    setAutoFixedThisError(false);
  }, [buildError?.fingerprint]);

  // Countdown loop — only runs when there's a fresh, undispatched error and
  // the agent is idle.
  useEffect(() => {
    if (!buildError) {
      setCountdown(null);
      return;
    }
    if (dispatchedRef.current.has(buildError.fingerprint)) {
      setCountdown(null);
      return;
    }
    if (isAgentBusy) {
      setCountdown(null);
      return;
    }

    setCountdown(AUTO_FIX_COUNTDOWN_S);
    const interval = setInterval(() => {
      setCountdown((c) => {
        if (c === null) return null;
        if (c <= 1) {
          clearInterval(interval);
          // Fire after the tick that brings us to 0.
          void dispatchAutoFix(buildError);
          return null;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildError?.fingerprint, isAgentBusy]);

  const dispatchAutoFix = async (e: {
    fingerprint: string;
    details: string;
  }) => {
    if (dispatchedRef.current.has(e.fingerprint)) return;
    dispatchedRef.current.add(e.fingerprint);
    setAutoFixedThisError(true);
    setCountdown(null);

    // Need a conversation to post into. Reuse the most-recent one or create
    // a fresh one if the user has never opened the chat.
    let conversationId = activeConversationId;
    if (!conversationId) {
      try {
        conversationId = await createConversation({
          projectId,
          title: DEFAULT_CONVERSATION_TITLE,
        });
      } catch {
        toast.error("Auto-fix: couldn't open a conversation to send the fix request");
        return;
      }
    }

    // The prompt explicitly tells the agent this came from auto-detection so
    // it can frame its plan/response accordingly. Cap the error blob at 2KB.
    const prompt =
      `[AUTO-FIX] The dev server is reporting a build error in the preview. ` +
      `Please diagnose the root cause, draft a plan, and fix it.\n\n` +
      `Build error output:\n\`\`\`\n${e.details.slice(0, 2000)}\n\`\`\``;

    try {
      await ky.post("/api/messages", {
        json: { conversationId, message: prompt },
      });
      toast.success("🤖 Auto-fix dispatched — watch the chat panel for progress");
    } catch (err) {
      console.error("auto-fix dispatch failed", err);
      toast.error("Auto-fix failed to dispatch — try the chat manually");
    }
  };

  const cancelAutoFix = () => {
    if (buildError) {
      // Marking as "dispatched" without actually firing prevents the loop
      // from re-arming itself for the same error.
      dispatchedRef.current.add(buildError.fingerprint);
    }
    setCountdown(null);
  };

  const fixNow = () => {
    if (buildError) void dispatchAutoFix(buildError);
  };

  // -----------------------------------------------------------------
  // URL bar actions — copy + open-in-new-tab.
  //
  // The user reported two issues with opening previews in new tabs:
  //
  //  1. "if try to open this web container link new tab its not working"
  //     → the URL strip was a plain <span>, so dragging out the text
  //       landed in Chrome as a path on the current origin (localhost:3000/
  //       webcontainer/connect/<id>) and 404'd. Fix: make the strip a
  //       real button + add explicit "Open in new tab" toolbar button.
  //
  //  2. "I am getting this page after open the link" — even with the
  //     proper https://...webcontainer-api.io URL, opening it directly
  //     in a fresh tab shows WebContainer's "You're almost there!
  //     Connect to Project" handshake page. That's because credentialless
  //     URLs require the consumer page to itself have COEP/COOP headers
  //     so the credentialless storage context is shared.
  //     Fix: route through OUR same-origin wrapper at /preview?url=...
  //     which iframes the WebContainer URL inside our (already
  //     COEP-credentialless) app context. No handshake needed —
  //     the wrapper page is on `${origin}` so it inherits our
  //     headers from next.config.ts. The wrapper validates the
  //     URL against an allowlist (only webcontainer-api.io subdomains)
  //     so it can't be abused as an open redirect.
  //
  //  Using `window.open` with `noopener,noreferrer` so the new tab
  //  can't reach back to window.opener.
  // -----------------------------------------------------------------
  const [copiedUrl, setCopiedUrl] = useState(false);
  const openPreviewInNewTab = () => {
    if (!previewUrl) return;
    // Wrap the WebContainer URL through our /preview page so the new
    // tab inherits the COEP/COOP context and skips the connect handshake.
    const wrapped = `/preview?url=${encodeURIComponent(previewUrl)}`;
    window.open(wrapped, "_blank", "noopener,noreferrer");
  };
  const copyPreviewUrl = async () => {
    if (!previewUrl) return;
    try {
      await navigator.clipboard.writeText(previewUrl);
      setCopiedUrl(true);
      toast.success("Preview URL copied to clipboard");
      setTimeout(() => setCopiedUrl(false), 1800);
    } catch {
      toast.error("Couldn't copy — your browser blocked clipboard access");
    }
  };

  const handleDownload = async () => {
    if (!files || files.length === 0) return;

    setIsDownloading(true);
    try {
      await downloadProjectAsZip(files, project?.name || "project");
    } catch (error) {
      console.error("Failed to download project:", error);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="h-8.75 flex items-center border-b bg-sidebar shrink-0">
        <Button
          size="sm"
          variant="ghost"
          className="h-full rounded-none"
          disabled={isLoading}
          onClick={restart}
          title="Restart container"
        >
          <RefreshCwIcon className="size-3" />
        </Button>

        {/* URL strip. When `previewUrl` is set, the whole strip becomes a
            clickable area that opens the preview in a new tab. We render
            it as a <button> for proper accessibility (keyboard, screen
            readers) and visual hover affordance. The strip ALSO has a
            standalone external-link icon on the right so the action is
            obvious. */}
        <div className="flex-1 h-full flex items-stretch bg-background border-x">
          {isLoading && (
            <div className="flex items-center gap-1.5 px-3 text-xs text-muted-foreground">
              <Loader2Icon className="size-3 animate-spin" />
              {status === "booting" ? "Starting..." : "Installing..."}
            </div>
          )}
          {previewUrl && (
            <button
              type="button"
              onClick={openPreviewInNewTab}
              title="Open preview in a new tab"
              className="flex-1 min-w-0 h-full flex items-center gap-2 px-3 text-xs text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors text-left font-mono cursor-pointer"
            >
              <span className="truncate flex-1">{previewUrl}</span>
              <ExternalLinkIcon className="size-3 shrink-0 opacity-70" />
            </button>
          )}
          {!isLoading && !previewUrl && !error && (
            <span className="flex items-center px-3 text-xs text-muted-foreground">
              Ready to preview
            </span>
          )}
        </div>

        {/* Copy URL button — only visible when we have a URL. Mirrors the
            "Open in new tab" action but copies to clipboard so the user
            can share the link or paste it elsewhere. */}
        {previewUrl && (
          <Button
            size="sm"
            variant="ghost"
            className="h-full rounded-none"
            title="Copy preview URL"
            onClick={copyPreviewUrl}
          >
            {copiedUrl ? (
              <CheckIcon className="size-3 text-emerald-400" />
            ) : (
              <CopyIcon className="size-3" />
            )}
          </Button>
        )}
        {/* Open-in-new-tab button — duplicate of the URL-strip click but
            visually obvious as a separate action. */}
        {previewUrl && (
          <Button
            size="sm"
            variant="ghost"
            className="h-full rounded-none"
            title="Open preview in new tab"
            onClick={openPreviewInNewTab}
          >
            <ExternalLinkIcon className="size-3" />
          </Button>
        )}

        <Button
          size="sm"
          variant="ghost"
          className="h-full rounded-none"
          title="Toggle terminal"
          onClick={() => setShowTerminal((value) => !value)}
        >
          <TerminalSquareIcon className="size-3" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-full rounded-none"
          title="Download project as ZIP"
          onClick={handleDownload}
          disabled={!files || files.length === 0 || isDownloading}
        >
          {isDownloading ? (
            <Loader2Icon className="size-3 animate-spin" />
          ) : (
            <DownloadIcon className="size-3" />
          )}
        </Button>
        <PreviewSettingsPopover
          projectId={projectId}
          initialValues={project?.settings}
          onSave={restart}
        />
      </div>

      {/* Auto-fix banner — surfaces the moment a build error appears in the
          terminal stream. Three states:
            • countdown active → "Auto-fixing in 4s [Fix now] [Cancel]"
            • dispatched       → "AI is fixing — check chat"
            • agent busy       → "Build error detected. Fix it manually
                                  in chat — agent is busy."
          When there's no detected error, the banner is hidden entirely. */}
      {buildError && (
        <div
          className={
            "shrink-0 px-3 py-2 text-xs flex items-center gap-2 border-b " +
            (autoFixedThisError
              ? "bg-violet-500/10 border-violet-500/30 text-violet-200"
              : "bg-amber-500/10 border-amber-500/30 text-amber-200")
          }
        >
          <WandSparklesIcon className="size-3.5 shrink-0" />
          {autoFixedThisError ? (
            <span className="flex-1">
              AI is auto-fixing this build error — open the chat panel to follow along.
            </span>
          ) : isAgentBusy ? (
            <span className="flex-1">
              Build error detected. The agent is busy with another request — it&apos;ll
              be available once that finishes.
            </span>
          ) : countdown !== null ? (
            <>
              <span className="flex-1">
                Build error detected. Auto-fixing with AI in <b>{countdown}s</b>…
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px] border-amber-500/40"
                onClick={fixNow}
              >
                Fix now
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px]"
                onClick={cancelAutoFix}
              >
                <XIcon className="size-3" />
              </Button>
            </>
          ) : (
            <>
              <span className="flex-1">
                Build error detected. Auto-fix already attempted — keep iterating in chat
                if it didn&apos;t land.
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px] border-amber-500/40"
                onClick={fixNow}
              >
                Try again
              </Button>
            </>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0">
        <Allotment vertical>
          <Allotment.Pane>
            {error && (
              <div className="size-full flex items-center justify-center text-muted-foreground">
                <div className="flex flex-col items-center gap-2 max-w-md mx-auto text-center">
                  <AlertTriangleIcon className="size-6" />
                  <p className="text-sm font-medium">{error}</p>
                  <Button size="sm" variant="outline" onClick={restart}>
                    <RefreshCwIcon className="size-4" />
                    Restart
                  </Button>
                </div>
              </div>
            )}

            {isLoading && !error && (
              <div className="size-full flex items-center justify-center text-muted-foreground">
                <div className="flex flex-col items-center gap-2 max-w-md mx-auto text-center">
                  <Loader2Icon className="size-6 animate-spin" />
                  {/* Show what's ACTUALLY happening — was hardcoded to
                      "Installing..." regardless of phase, which made every
                      stuck boot look identical to a stuck install. */}
                  <p className="text-sm font-medium">
                    {status === "booting"
                      ? "Booting WebContainer…"
                      : "Installing dependencies…"}
                  </p>
                  <p className="text-xs text-muted-foreground/70 max-w-xs">
                    {status === "booting"
                      ? "Loading the in-browser Node runtime. This is a one-time download per session."
                      : "Pulling packages from registry.npmmirror.com. The terminal panel below shows live progress — open it if you want detail."}
                  </p>
                </div>
              </div>
            )}

            {previewUrl && (
              <iframe
                src={previewUrl}
                className="size-full border-0"
                title="Preview"
              />
            )}
          </Allotment.Pane>

          {showTerminal && (
            <Allotment.Pane minSize={100} maxSize={500} preferredSize={200}>
              <div className="h-full flex flex-col bg-background border-t">
                <div className="h-7 flex items-center px-3 text-xs gap-1.5 text-muted-foreground border-b border-border/50 shrink-0">
                  <TerminalSquareIcon className="size-3" />
                  Terminal
                </div>
                <PreviewTerminal output={terminalOutput} />
              </div>
            </Allotment.Pane>
          )}
        </Allotment>
      </div>
    </div>
  );
};
