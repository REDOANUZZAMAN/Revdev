import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { verifyAuth } from "./auth";

// Validate the internal shared secret used by the agent worker.
const validateInternalKey = (key: string) => {
  const internalKey = process.env.POLARIS_CONVEX_INTERNAL_KEY;
  if (!internalKey) throw new Error("POLARIS_CONVEX_INTERNAL_KEY is not configured");
  if (key !== internalKey) throw new Error("Invalid internal key");
};

const stepStatus = v.union(
  v.literal("pending"),
  v.literal("running"),
  v.literal("done"),
  v.literal("failed"),
  v.literal("skipped"),
);

// -----------------------------------------------------------------------------
// Public query (used by the chat UI) — owner-checked via parent project.
// -----------------------------------------------------------------------------
export const getByMessage = query({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);

    const message = await ctx.db.get(args.messageId);
    if (!message) return null;

    const project = await ctx.db.get(message.projectId);
    if (!project) return null;
    if (project.ownerId !== identity.subject) {
      throw new Error("Unauthorized to access this plan");
    }

    const plan = await ctx.db
      .query("plans")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .first();

    return plan ?? null;
  },
});

// -----------------------------------------------------------------------------
// Agent-side query — same as getByMessage but auth'd via internalKey because
// the inngest tools run outside Clerk. Used by `updatePlanStep` to re-render
// PLAN.md from the latest plan state.
// -----------------------------------------------------------------------------
export const getByMessageInternal = query({
  args: {
    internalKey: v.string(),
    messageId: v.id("messages"),
  },
  handler: async (ctx, args) => {
    const expected = process.env.POLARIS_CONVEX_INTERNAL_KEY;
    if (!expected || args.internalKey !== expected) {
      throw new Error("Invalid internal key");
    }
    const plan = await ctx.db
      .query("plans")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .first();
    return plan ?? null;
  },
});

// -----------------------------------------------------------------------------
// Agent-side mutations (use internalKey since the agent runs outside Clerk auth).
// -----------------------------------------------------------------------------
export const createPlan = mutation({
  args: {
    internalKey: v.string(),
    messageId: v.id("messages"),
    steps: v.array(
      v.object({
        id: v.string(),
        title: v.string(),
        description: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);

    const message = await ctx.db.get(args.messageId);
    if (!message) throw new Error("Message not found");

    // Idempotent: if a plan already exists for this message, replace its steps.
    const existing = await ctx.db
      .query("plans")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .first();

    const now = Date.now();
    const initialSteps = args.steps.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      status: "pending" as const,
    }));

    if (existing) {
      await ctx.db.patch(existing._id, {
        steps: initialSteps,
        updatedAt: now,
      });
      return existing._id;
    }

    const planId = await ctx.db.insert("plans", {
      messageId: args.messageId,
      conversationId: message.conversationId,
      projectId: message.projectId,
      steps: initialSteps,
      updatedAt: now,
    });

    return planId;
  },
});

/**
 * Mark all still-active (`pending` / `running`) steps as `skipped` for a
 * given message. Used when the user cancels mid-run by sending a new prompt
 * — without this, the chat keeps showing a spinning "running" loader on
 * the orphaned plan forever (the agent that owned it has been killed).
 *
 * Idempotent: terminal-state steps (done / failed / skipped) are left
 * untouched. If no plan exists for the message, it's a no-op.
 */
export const cancelActiveSteps = mutation({
  args: {
    internalKey: v.string(),
    messageId: v.id("messages"),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);

    const plan = await ctx.db
      .query("plans")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .first();
    if (!plan) return; // no plan to cancel — that's fine

    const now = Date.now();
    let changed = false;
    const steps = plan.steps.map((step) => {
      if (step.status === "pending" || step.status === "running") {
        changed = true;
        return {
          ...step,
          status: "skipped" as const,
          finishedAt: step.finishedAt ?? now,
        };
      }
      return step;
    });

    if (changed) {
      await ctx.db.patch(plan._id, { steps, updatedAt: now });
    }
  },
});

export const updateStep = mutation({
  args: {
    internalKey: v.string(),
    messageId: v.id("messages"),
    stepId: v.string(),
    status: stepStatus,
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);

    const plan = await ctx.db
      .query("plans")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .first();
    if (!plan) throw new Error("Plan not found for this message");

    const now = Date.now();
    const steps = plan.steps.map((step) => {
      if (step.id !== args.stepId) return step;

      const next = { ...step, status: args.status };
      if (args.error !== undefined) next.error = args.error;

      // Record timing transitions
      if (args.status === "running" && !step.startedAt) {
        next.startedAt = now;
      }
      if (
        (args.status === "done" || args.status === "failed" || args.status === "skipped") &&
        !step.finishedAt
      ) {
        next.finishedAt = now;
      }
      return next;
    });

    await ctx.db.patch(plan._id, { steps, updatedAt: now });
  },
});
