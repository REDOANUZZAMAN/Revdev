import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { verifyAuth } from "./auth";

const validateInternalKey = (key: string) => {
  const internalKey = process.env.POLARIS_CONVEX_INTERNAL_KEY;
  if (!internalKey) throw new Error("POLARIS_CONVEX_INTERNAL_KEY is not configured");
  if (key !== internalKey) throw new Error("Invalid internal key");
};

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
      throw new Error("Unauthorized to access this project's editor stream");
    }

    return await ctx.db
      .query("editorStreams")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .first();
  },
});

// -----------------------------------------------------------------------------
// Agent-side: start a stream — clears any prior stream for the project.
// -----------------------------------------------------------------------------
export const start = mutation({
  args: {
    internalKey: v.string(),
    projectId: v.id("projects"),
    fileId: v.id("files"),
    fileName: v.string(),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);

    const existing = await ctx.db
      .query("editorStreams")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .first();

    const now = Date.now();
    const payload = {
      projectId: args.projectId,
      fileId: args.fileId,
      fileName: args.fileName,
      content: "",
      status: "streaming" as const,
      startedAt: now,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.replace(existing._id, payload);
      return existing._id;
    }
    return await ctx.db.insert("editorStreams", payload);
  },
});

// -----------------------------------------------------------------------------
// Agent-side: append a chunk to the current stream's content.
// -----------------------------------------------------------------------------
export const append = mutation({
  args: {
    internalKey: v.string(),
    projectId: v.id("projects"),
    chunk: v.string(),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);

    const existing = await ctx.db
      .query("editorStreams")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .first();
    if (!existing) return; // No active stream — silently no-op (race-safe).

    await ctx.db.patch(existing._id, {
      content: existing.content + args.chunk,
      updatedAt: Date.now(),
    });
  },
});

// -----------------------------------------------------------------------------
// Agent-side: mark the stream complete. UI flips back to reading saved content.
// -----------------------------------------------------------------------------
export const finish = mutation({
  args: {
    internalKey: v.string(),
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);

    const existing = await ctx.db
      .query("editorStreams")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .first();
    if (!existing) return;

    await ctx.db.patch(existing._id, {
      status: "completed" as const,
      updatedAt: Date.now(),
    });
  },
});
