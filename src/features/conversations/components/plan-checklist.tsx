"use client";

import { useQuery } from "convex/react";
import { Check, Loader2, X, Circle, MinusCircle } from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";

interface PlanChecklistProps {
  messageId: Id<"messages">;
}

type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

const STATUS_ICON: Record<StepStatus, React.ComponentType<{ className?: string }>> = {
  pending: Circle,
  running: Loader2,
  done: Check,
  failed: X,
  skipped: MinusCircle,
};

const STATUS_CLASSES: Record<StepStatus, { row: string; icon: string; title: string }> = {
  pending: {
    row: "",
    icon: "text-gray-500",
    title: "text-gray-400",
  },
  running: {
    row: "",
    icon: "text-cyan-400 animate-spin",
    title: "text-gray-100 font-medium",
  },
  done: {
    row: "",
    icon: "text-emerald-400",
    title: "text-gray-500 line-through",
  },
  failed: {
    row: "",
    icon: "text-red-400",
    title: "text-red-300",
  },
  skipped: {
    row: "opacity-60",
    icon: "text-gray-600",
    title: "text-gray-500 line-through",
  },
};

export function PlanChecklist({ messageId }: PlanChecklistProps) {
  const plan = useQuery(api.plans.getByMessage, { messageId });

  if (!plan) return null;
  const steps = plan.steps;
  if (!steps || steps.length === 0) return null;

  const doneCount = steps.filter((s) => s.status === "done").length;
  const failedCount = steps.filter((s) => s.status === "failed").length;
  const total = steps.length;

  return (
    <div className="mb-3 rounded-xl border border-white/10 bg-[#0b0b14]/80 backdrop-blur p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-xs text-gray-300">
          <span className="font-medium tracking-wide uppercase text-[10px] text-violet-400">
            Plan
          </span>
          <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
            {doneCount} / {total}
            {failedCount > 0 && (
              <span className="ml-1 text-red-400">· {failedCount} failed</span>
            )}
          </span>
        </div>
      </div>

      <ul className="space-y-1.5">
        {steps.map((step) => {
          const status = step.status as StepStatus;
          const Icon = STATUS_ICON[status];
          const classes = STATUS_CLASSES[status];
          return (
            <li
              key={step.id}
              className={cn(
                "flex items-start gap-2.5 rounded-md px-1.5 py-1 text-sm",
                classes.row
              )}
              title={step.error ?? step.description ?? undefined}
            >
              <Icon className={cn("mt-0.5 size-4 shrink-0", classes.icon)} />
              <div className="flex-1 min-w-0">
                <div className={cn("leading-snug break-words", classes.title)}>
                  {step.title}
                </div>
                {step.error && (
                  <div className="mt-0.5 text-[11px] text-red-300/80 break-words">
                    {step.error}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
