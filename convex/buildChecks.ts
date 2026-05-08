import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { verifyAuth } from "./auth";

const validateInternalKey = (key: string) => {
  const internalKey = process.env.POLARIS_CONVEX_INTERNAL_KEY;
  if (!internalKey) throw new Error("POLARIS_CONVEX_INTERNAL_KEY is not configured");
  if (key !== internalKey) throw new Error("Invalid internal key");
};

const ERROR_CAP = 50;

// -----------------------------------------------------------------------------
// Public query — UI subscribes here. Owner-checked via parent project.
// -----------------------------------------------------------------------------
export const getByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project) return null;
    if (project.ownerId !== identity.subject) {
      throw new Error("Unauthorized to access this project's build status");
    }

    return await ctx.db
      .query("buildChecks")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .first();
  },
});

// -----------------------------------------------------------------------------
// Agent-side: mark check as running. Resets prior errors.
// -----------------------------------------------------------------------------
export const start = mutation({
  args: {
    internalKey: v.string(),
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);

    const existing = await ctx.db
      .query("buildChecks")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .first();

    const now = Date.now();
    const payload = {
      projectId: args.projectId,
      status: "running" as const,
      errors: [],
      fileCount: 0,
      durationMs: 0,
      startedAt: now,
      finishedAt: undefined,
    };

    if (existing) {
      await ctx.db.replace(existing._id, payload);
      return existing._id;
    }
    return await ctx.db.insert("buildChecks", payload);
  },
});

// -----------------------------------------------------------------------------
// Agent-side: write the final result.
// -----------------------------------------------------------------------------
export const finish = mutation({
  args: {
    internalKey: v.string(),
    projectId: v.id("projects"),
    errors: v.array(
      v.object({
        file: v.string(),
        line: v.number(),
        column: v.number(),
        message: v.string(),
        code: v.optional(v.number()),
      })
    ),
    fileCount: v.number(),
    durationMs: v.number(),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);

    const existing = await ctx.db
      .query("buildChecks")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .first();

    // Cap the error list to keep the row small. The agent only needs the
    // first handful to start fixing things.
    const cappedErrors = args.errors.slice(0, ERROR_CAP);
    const status = args.errors.length === 0 ? ("passed" as const) : ("failed" as const);
    const now = Date.now();

    const payload = {
      projectId: args.projectId,
      status,
      errors: cappedErrors,
      fileCount: args.fileCount,
      durationMs: args.durationMs,
      startedAt: existing?.startedAt ?? now,
      finishedAt: now,
    };

    if (existing) {
      await ctx.db.replace(existing._id, payload);
      return existing._id;
    }
    return await ctx.db.insert("buildChecks", payload);
  },
});
