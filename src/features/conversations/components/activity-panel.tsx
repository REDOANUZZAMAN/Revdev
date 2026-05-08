/**
 * ActivityPanel — Phase H.
 *
 * Renders the per-message `progressLog` (the live tool-call narration the
 * agent emits while working) in a fixed-size, collapsible card that lives
 * ABOVE the message body inside each assistant chat bubble.
 *
 * Why this exists:
 *   The previous implementation appended every play-by-play line directly
 *   into `message.content`. That caused two ugly problems:
 *     1. The chat bubble grew taller and taller until it pushed the input
 *        off-screen — every plan run looked like a 30-line glob of mixed
 *        narration + final answer.
 *     2. The agent's actual final reply was visually indistinguishable from
 *        the tool-call breadcrumbs above it.
 *   Now narration goes to a separate `progressLog: v.array(v.string())`
 *   field in Convex and gets rendered here in a contained, scrollable
 *   ~10-row terminal-style box. While the run is in progress it auto-tails
 *   to the bottom and shows a spinner; once the message completes it
 *   collapses to a single "Show activity (N steps)" toggle so the user can
 *   focus on the agent's actual reply.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, LoaderIcon } from "lucide-react";

interface ActivityPanelProps {
  lines: string[];
  isProcessing: boolean;
}

export function ActivityPanel({ lines, isProcessing }: ActivityPanelProps) {
  // While processing, default-open. After completion, default-closed —
  // the user usually only cares about the final reply, not the journey.
  const [open, setOpen] = useState<boolean>(isProcessing);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const userScrolledUpRef = useRef(false);

  // When isProcessing flips from true→false, auto-collapse so the chat
  // doesn't stay cluttered with old activity feeds.
  // Conversely if it flips false→true (rare, e.g. retry) re-open.
  useEffect(() => {
    setOpen(isProcessing);
  }, [isProcessing]);

  // Auto-tail to the bottom as new lines arrive — but only if the user
  // hasn't scrolled up to inspect history. Same UX as a terminal.
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (!el) return;
    if (userScrolledUpRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [lines, open]);

  // Track whether the user has manually scrolled away from the bottom.
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
    userScrolledUpRef.current = distFromBottom > 24; // ~1 line of slack
  };

  // No lines yet AND not processing → render nothing. (Don't show an empty
  // panel on every old assistant reply that pre-dates this feature.)
  if (lines.length === 0 && !isProcessing) return null;

  const headerLabel = isProcessing
    ? lines.length > 0
      ? lines[lines.length - 1]
      : "Working…"
    : `Show activity (${lines.length} step${lines.length === 1 ? "" : "s"})`;

  return (
    <div className="mb-3 rounded-lg border border-white/10 bg-[#0b0b12] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-white/5 transition-colors"
      >
        {/* In-flight: animated spinner. Done: chevron toggle. */}
        {isProcessing ? (
          <LoaderIcon className="size-3.5 animate-spin text-violet-400 flex-shrink-0" />
        ) : open ? (
          <ChevronDown className="size-3.5 text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="size-3.5 text-gray-400 flex-shrink-0" />
        )}
        <span
          className={
            isProcessing
              ? "truncate text-violet-300 text-left flex-1"
              : "truncate text-gray-400 text-left flex-1"
          }
          title={headerLabel}
        >
          {headerLabel}
        </span>
        {isProcessing && lines.length > 0 && (
          <span className="text-[10px] text-gray-500 flex-shrink-0 tabular-nums">
            {lines.length}
          </span>
        )}
      </button>

      {open && lines.length > 0 && (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          // Fixed-size scroll box — capped at ~10 lines (160px). The whole
          // point of this redesign: the bubble doesn't grow unboundedly.
          className="max-h-[160px] overflow-y-auto px-3 pb-2 pt-1 text-[11px] leading-snug font-mono text-gray-300 space-y-0.5 border-t border-white/5"
        >
          {lines.map((line, i) => (
            <div
              key={`${i}-${line.slice(0, 16)}`}
              className="whitespace-pre-wrap break-words"
            >
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
