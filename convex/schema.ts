import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  projects: defineTable({
    name: v.string(),
    ownerId: v.string(),
    updatedAt: v.number(),
    importStatus: v.optional(
      v.union(
        v.literal("importing"),
        v.literal("completed"),
        v.literal("failed"),
      ),
    ),
    exportStatus: v.optional(
      v.union(
        v.literal("exporting"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled"),
      ),
    ),
    exportRepoUrl: v.optional(v.string()),
    settings: v.optional(
      v.object({
        installCommand: v.optional(v.string()),
        devCommand: v.optional(v.string()),
      })
    ),
  }).index("by_owner", ["ownerId"]),

  files: defineTable({
    projectId: v.id("projects"),
    parentId: v.optional(v.id("files")),
    name: v.string(),
    type: v.union(v.literal("file"), v.literal("folder")),
    content: v.optional(v.string()), // Text files only
    storageId: v.optional(v.id("_storage")), // Binary files only
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_parent", ["parentId"])
    .index("by_project_parent", ["projectId", "parentId"]),

  conversations: defineTable({
    projectId: v.id("projects"),
    title: v.string(),
    updatedAt: v.number(),
  }).index("by_project", ["projectId"]),

  messages: defineTable({
    conversationId: v.id("conversations"),
    projectId: v.id("projects"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    status: v.optional(
      v.union(
        v.literal("processing"),
        v.literal("completed"),
        v.literal("cancelled")
      )
    ),
    // Phase H — separate live activity feed.
    // Used to be: every tool-call narration was appended into `content`,
    // which (a) caused the chat to render an ever-growing wall of text and
    // (b) couldn't be visually distinguished from the final assistant reply.
    // Now narration goes here as discrete, capped lines and the UI renders
    // it in a fixed-size activity panel that collapses on completion.
    progressLog: v.optional(v.array(v.string())),
    // Metadata for tracking file operations
    metadata: v.optional(v.object({
      filesRead: v.optional(v.array(v.string())),
      filesModified: v.optional(v.array(v.object({
        path: v.string(),
        linesAdded: v.number(),
        linesRemoved: v.number(),
      }))),
      filesCreated: v.optional(v.array(v.string())),
      filesDeleted: v.optional(v.array(v.string())),
    })),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_project_status", ["projectId", "status"]),

  // Phase C — Live editor mirroring. One row per project; the agent uses these
  // mutations to push partial content while writing a file so the editor pane
  // can auto-switch and show the characters appearing in real time.
  editorStreams: defineTable({
    projectId: v.id("projects"),
    fileId: v.id("files"),
    fileName: v.string(),
    content: v.string(),
    status: v.union(v.literal("streaming"), v.literal("completed")),
    startedAt: v.number(),
    updatedAt: v.number(),
  }).index("by_project", ["projectId"]),

  // Phase F — Compile Gate. After the agent finishes a task, we run an
  // in-process TypeScript check across all generated files and store the
  // result here. The Preview tab is disabled until status === "passed".
  buildChecks: defineTable({
    projectId: v.id("projects"),
    status: v.union(
      v.literal("idle"),       // never run
      v.literal("running"),    // check in flight
      v.literal("passed"),     // 0 errors -> Preview unlocked
      v.literal("failed"),     // >=1 error -> red badge, Preview locked
    ),
    // Capped at 50 entries to bound size; the agent only needs a few to fix.
    errors: v.array(
      v.object({
        file: v.string(),     // "components/Hero.tsx"
        line: v.number(),     // 1-based
        column: v.number(),   // 1-based
        message: v.string(),  // "Cannot find name 'foo'"
        code: v.optional(v.number()),  // TS error code (e.g. 2304)
      })
    ),
    fileCount: v.number(),    // how many .ts/.tsx files were checked
    durationMs: v.number(),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
  }).index("by_project", ["projectId"]),

  // Plan-driven execution: the agent emits a plan up front and ticks each step
  // as it works. UI subscribes to this for a real-time checklist.
  plans: defineTable({
    messageId: v.id("messages"),
    conversationId: v.id("conversations"),
    projectId: v.id("projects"),
    steps: v.array(
      v.object({
        id: v.string(), // client-generated nanoid, used to address steps
        title: v.string(),
        description: v.optional(v.string()),
        status: v.union(
          v.literal("pending"),
          v.literal("running"),
          v.literal("done"),
          v.literal("failed"),
          v.literal("skipped"),
        ),
        error: v.optional(v.string()),
        startedAt: v.optional(v.number()),
        finishedAt: v.optional(v.number()),
      })
    ),
    updatedAt: v.number(),
  })
    .index("by_message", ["messageId"])
    .index("by_conversation", ["conversationId"]),
});
