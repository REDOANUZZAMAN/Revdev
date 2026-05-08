"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Allotment } from "allotment";
import {
  AlertTriangle,
  CheckCircle2,
  Code2,
  Eye,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useQuery } from "convex/react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { EditorView } from "@/features/editor/components/editor-view";

import { FileExplorer } from "./file-explorer";
import { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import { PreviewView } from "./preview-view";
import { ExportPopover } from "./export-popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 800;
const DEFAULT_SIDEBAR_WIDTH = 350;
const DEFAULT_MAIN_SIZE = 1000;

const Tab = ({
  label,
  icon: Icon,
  isActive,
  disabled,
  badge,
  onClick,
}: {
  label: string;
  icon: React.ElementType;
  isActive: boolean;
  disabled?: boolean;
  badge?: React.ReactNode;
  onClick: () => void;
}) => {
  return (
    <div
      onClick={() => {
        if (!disabled) onClick();
      }}
      className={cn(
        "flex items-center gap-2 h-full px-4 text-muted-foreground border-r border-white/5 transition-all duration-200",
        disabled
          ? "cursor-not-allowed opacity-50"
          : "cursor-pointer hover:bg-white/5 hover:text-foreground",
        isActive &&
          "bg-gradient-to-b from-violet-500/10 to-transparent text-foreground border-b-2 border-b-violet-500"
      )}
    >
      <Icon className={cn("size-4", isActive && "text-violet-400")} />
      <span className="text-sm font-medium">{label}</span>
      {badge}
    </div>
  );
};

export const ProjectIdView = ({
  projectId,
}: {
  projectId: Id<"projects">;
}) => {
  const [activeView, setActiveView] = useState<"editor" | "preview">("editor");

  // KEEP-ALIVE for the Preview pane.
  //
  // BUG (user-reported "if leave the preview page to code and return to preview
  // page it start again install all those thing form the first why?"):
  // PreviewView used to be mounted ONLY while `activeView === "preview"`. So
  // every Code↔Preview tab swap unmounted it, which torched the
  // `useWebContainer` hook's local refs (`hasStartedRef`, etc) and on next
  // mount the boot → npm install → npm run dev sequence ran from scratch.
  // 60-90 seconds of re-install just for switching tabs.
  //
  // Fix: the very first time the user opens Preview, flip
  // `previewEverOpened` to true and keep <PreviewView/> mounted from then on.
  // Visibility toggling is done with the same CSS `visible/invisible` trick
  // the editor pane already uses below — the iframe + WebContainer process
  // stays alive in the DOM, just hidden. Subsequent Preview visits show the
  // already-running dev server instantly.
  //
  // We deliberately don't mount it eagerly on page load: WebContainer.boot()
  // is expensive, downloads megabytes of WASM, and a user who only ever wants
  // to read code shouldn't pay for it.
  const [previewEverOpened, setPreviewEverOpened] = useState(false);
  useEffect(() => {
    if (activeView === "preview") setPreviewEverOpened(true);
  }, [activeView]);

  // Phase F — subscribe to the build status. UI uses this to gate the Preview tab.
  const buildCheck = useQuery(api.buildChecks.getByProject, { projectId });

  const buildStatus: "idle" | "running" | "passed" | "failed" =
    buildCheck?.status ?? "idle";

  // If the user is sitting on Preview when a new run starts (status flips back
  // to "running" or "failed"), bounce them to Code so they don't stare at a
  // stale iframe.
  useEffect(() => {
    if (
      activeView === "preview" &&
      (buildStatus === "running" || buildStatus === "failed")
    ) {
      setActiveView("editor");
    }
  }, [activeView, buildStatus]);

  // ---------------------------------------------------------------------
  // Auto-switch to Preview when a build finishes successfully.
  //
  // The user explicitly asked: "after generate the code ai will auto
  // switch to the preview section, the install and build and compile,
  // see the website is running properly or not — if not it will fix all
  // automatically".
  //
  // The auto-fix half is already wired (PreviewView's auto-fix banner
  // dispatches [AUTO-FIX] messages on dev-server errors). What was
  // missing: bringing the user to the Preview tab in the first place.
  //
  // We do that here by watching `buildStatus` for a `running → passed`
  // transition (or `idle → passed` for the very first build of a fresh
  // project) and flipping `activeView` to `"preview"` exactly once per
  // such transition.
  //
  // We deliberately gate on `activeView === "editor"` so we don't yank
  // a user who already manually navigated somewhere else (e.g. they
  // already clicked over to Preview, or even back to Code mid-flight).
  // The `lastBuildStatusRef` tracks the previous status so we only fire
  // on the EDGE of the transition — not every render while the status
  // sits at "passed".
  // ---------------------------------------------------------------------
  const lastBuildStatusRef = useRef<typeof buildStatus | null>(null);
  useEffect(() => {
    const prev = lastBuildStatusRef.current;
    lastBuildStatusRef.current = buildStatus;

    // Only act on the edge into "passed".
    if (buildStatus !== "passed") return;
    if (prev === "passed") return;        // already passed last render
    if (prev === null) return;            // first mount — don't auto-jump on page load
    if (activeView !== "editor") return;  // user already navigated elsewhere

    // Fire the switch. Toast lets the user know what just happened so
    // it doesn't feel like the UI hijacked them.
    setActiveView("preview");
    toast.success("✨ Build passed — switched to Preview", {
      description: "The dev server is starting up automatically.",
      duration: 3500,
    });
  }, [buildStatus, activeView]);

  // Phase H — preview gating MUST allow `idle` through.
  //
  // Was: `previewLocked = buildStatus !== "passed"`. That perma-locked Preview
  // for any project whose buildCheck row didn't exist yet — including every
  // project created before the V4 thinking-mode fix landed (the agent hung at
  // the first tool call so the post-run compile-check step never executed,
  // leaving no row in `buildChecks`). The user reasonably asked: "the preview
  // is still disabled, why?".
  //
  // The gate's purpose is to prevent showing a *known-broken* preview, not to
  // demand proof of correctness before the user can even open the tab. So:
  //   • idle    → unlocked (no opinion — let them try, the WebContainer will
  //                surface its own runtime errors if any)
  //   • running → locked  (don't show a stale iframe mid-rebuild)
  //   • failed  → locked  (we know the project doesn't compile)
  //   • passed  → unlocked
  // This matches how IDEs don't gray out "Run" before the first build.
  const previewLocked =
    buildStatus === "running" || buildStatus === "failed";

  const previewBadge = useMemo(() => {
    if (buildStatus === "running") {
      return (
        <span className="ml-1 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30">
          <Loader2 className="size-3 text-amber-300 animate-spin" />
          <span className="text-[10px] font-semibold text-amber-200">
            Building
          </span>
        </span>
      );
    }
    if (buildStatus === "failed") {
      return (
        <span className="ml-1 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-red-500/15 border border-red-500/30">
          <AlertTriangle className="size-3 text-red-300" />
          <span className="text-[10px] font-semibold text-red-200">
            {buildCheck?.errors.length ?? 0} err
          </span>
        </span>
      );
    }
    if (buildStatus === "passed") {
      return (
        <span className="ml-1 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30">
          <CheckCircle2 className="size-3 text-emerald-300" />
          <span className="text-[10px] font-semibold text-emerald-200">
            Ready
          </span>
        </span>
      );
    }
    return null;
  }, [buildStatus, buildCheck?.errors.length]);

  const previewTooltip = useMemo(() => {
    if (buildStatus === "running") {
      return "Compile check in progress. Preview will unlock when it passes.";
    }
    if (buildStatus === "failed") {
      const head = buildCheck?.errors.slice(0, 4) ?? [];
      const summary =
        head
          .map(
            (e) =>
              `${e.file}:${e.line}:${e.column} ${e.code ? `TS${e.code}` : ""}  ${e.message.slice(0, 100)}`
          )
          .join("\n") || "Compile failed";
      const more =
        (buildCheck?.errors.length ?? 0) > 4
          ? `\n…and ${(buildCheck?.errors.length ?? 0) - 4} more`
          : "";
      return `Preview locked — fix the errors below first:\n\n${summary}${more}`;
    }
    if (buildStatus === "idle") {
      return "Preview is ready to launch. Click to start the dev server.";
    }
    return "Preview ready";
  }, [buildStatus, buildCheck?.errors]);

  return (
    <div className="h-full flex flex-col bg-[#0a0a0f]">
      {/* Premium Navigation Bar */}
      <nav className="h-11 flex items-center bg-[#0d0d14] border-b border-white/5 backdrop-blur-xl">
        <div className="flex items-center h-full">
          <Tab
            label="Code"
            icon={Code2}
            isActive={activeView === "editor"}
            onClick={() => setActiveView("editor")}
          />
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <Tab
                    label="Preview"
                    icon={Eye}
                    isActive={activeView === "preview"}
                    disabled={previewLocked}
                    badge={previewBadge}
                    onClick={() => setActiveView("preview")}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-md whitespace-pre-wrap">
                {previewTooltip}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="flex-1 flex items-center justify-end h-full px-3 gap-3">
          {/* AI Status Indicator */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gradient-to-r from-violet-500/10 to-cyan-500/10 border border-violet-500/20">
            <Sparkles className="size-3.5 text-violet-400" />
            <span className="text-xs font-medium text-violet-300">AI Ready</span>
          </div>
          <ExportPopover projectId={projectId} />
        </div>
      </nav>
      <div className="flex-1 relative">
        <div
          className={cn(
            "absolute inset-0",
            activeView === "editor" ? "visible" : "invisible"
          )}
        >
          <Allotment defaultSizes={[DEFAULT_SIDEBAR_WIDTH, DEFAULT_MAIN_SIZE]}>
            <Allotment.Pane
              snap
              minSize={MIN_SIDEBAR_WIDTH}
              maxSize={MAX_SIDEBAR_WIDTH}
              preferredSize={DEFAULT_SIDEBAR_WIDTH}
            >
              <FileExplorer projectId={projectId} />
            </Allotment.Pane>
            <Allotment.Pane>
              <EditorView projectId={projectId} />
            </Allotment.Pane>
          </Allotment>
        </div>
        <div
          className={cn(
            "absolute inset-0",
            activeView === "preview" ? "visible" : "invisible"
          )}
        >
          {/* Mount the WebContainer the FIRST time the user opens Preview,
              and keep it mounted from then on (visibility is toggled via
              the `invisible` class on the wrapper above). This is what
              makes Code↔Preview tab swaps instant — without it, every
              swap unmounts the hook, kills the WebContainer process,
              and forces a fresh boot + npm install on return.
              We still gate on `!previewLocked` so we don't spin up the
              sandbox for a known-broken build, but once it's up and the
              user navigates away, we let it keep running in the background. */}
          {previewEverOpened && !previewLocked && (
            <PreviewView projectId={projectId} />
          )}
        </div>
      </div>
    </div>
  );
};
