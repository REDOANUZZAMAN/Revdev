import { z } from "zod";
import { createTool } from "@inngest/agent-kit";

import { convex } from "@/lib/convex-client";

import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { streamFileWrite } from "./_streaming";

interface CreateFilesToolOptions {
  projectId: Id<"projects">;
  internalKey: string;
}

const paramsSchema = z.object({
  // BUG FIX: agents (especially DeepSeek when given long parameter lists) sometimes
  // omit `parentId` entirely instead of sending an empty string for the root —
  // which crashes Zod with "expected string, received undefined". Default it to ""
  // (= root), which createFiles already understands.
  parentId: z.string().optional().default(""),
  files: z
    .array(
      z.object({
        name: z.string().min(1, "File name cannot be empty"),
        // Same defence: a missing `content` (e.g. an empty placeholder file)
        // should be coerced to "" instead of throwing the entire call.
        content: z.string().optional().default(""),
      })
    )
    .min(1, "Provide at least one file to create"),
});

export const createCreateFilesTool = ({
  projectId,
  internalKey,
}: CreateFilesToolOptions) => {
  return createTool({
    name: "createFiles",
    description:
      "Create multiple files at once in the same folder. Use this to batch create files that share the same parent folder. More efficient than creating files one by one.",
    parameters: z.object({
      parentId: z
        .string()
        .describe(
          "The ID of the parent folder. Use empty string for root level. Must be a valid folder ID from listFiles."
        ),
      files: z
        .array(
          z.object({
            name: z.string().describe("The file name including extension"),
            content: z.string().describe("The file content"),
          })
        )
        .describe("Array of files to create"),
    }),
    handler: async (params, { step: toolStep }) => {
      const parsed = paramsSchema.safeParse(params);
      if (!parsed.success) {
        return `Error: ${parsed.error.issues[0].message}`;
      }

      const { parentId, files } = parsed.data;

      try {
        const stepResult = await toolStep?.run("create-files", async () => {
          let resolvedParentId: Id<"files"> | undefined;

          if (parentId && parentId !== "") {
            try {
              resolvedParentId = parentId as Id<"files">;
              const parentFolder = await convex.query(api.system.getFileById, {
                internalKey,
                fileId: resolvedParentId,
              });
              if (!parentFolder) {
                return {
                  message: `Error: Parent folder with ID "${parentId}" not found. Use listFiles to get valid folder IDs.`,
                  created: [] as { name: string; fileId: string; content: string }[],
                };
              }
              if (parentFolder.type !== "folder") {
                return {
                  message: `Error: The ID "${parentId}" is a file, not a folder. Use a folder ID as parentId.`,
                  created: [],
                };
              }
            } catch {
              return {
                message: `Error: Invalid parentId "${parentId}". Use listFiles to get valid folder IDs, or use empty string for root level.`,
                created: [],
              };
            }
          }

          const results = await convex.mutation(api.system.createFiles, {
            internalKey,
            projectId,
            parentId: resolvedParentId,
            files,
          });

          const created = results
            .filter((r) => !r.error)
            .map((r) => {
              const original = files.find((f) => f.name === r.name);
              return {
                name: r.name,
                fileId: r.fileId,
                content: original?.content ?? "",
              };
            });
          const failed = results.filter((r) => r.error);

          let message = `Created ${created.length} file(s)`;
          if (created.length > 0) {
            message += `: ${created.map((r) => r.name).join(", ")}`;
          }
          if (failed.length > 0) {
            message += `. Failed: ${failed.map((r) => `${r.name} (${r.error})`).join(", ")}`;
          }

          return { message, created };
        });

        // Phase C — visually replay one created file into the editor pane so
        // the user gets a Cline-like "AI is typing this in" animation.
        //
        // BATCH-MODE FIX (user-reported "editor switches among components"):
        // The agent often calls createFiles with 6-10 files at once
        // (Navbar.tsx, Hero.tsx, Services.tsx, Portfolio.tsx, Footer.tsx, …).
        // Previously we serialized a stream for EACH of them, so the editor
        // pane flipped from one file to the next every ~700ms. From the
        // user's POV: the editor is a slideshow of half-typed files instead
        // of a coherent typing animation. The screenshot shows exactly this
        // — Services.tsx is at line 17 because the loop has already moved
        // past it onto the next file.
        //
        // The fix: pick ONE representative file (the LARGEST source file
        // in the batch — that's almost always the meatiest component and
        // the most satisfying to watch get typed) and stream just that
        // one. The others land in the file tree silently via the Convex
        // mutation above, which is exactly how Cursor / Cline behave.
        // Updates to a single file (the much more common case) are
        // unaffected — updateFile.ts still streams normally.
        const created = stepResult?.created ?? [];
        if (created.length > 0) {
          // Pick the longest non-trivial file. We tiebreak on order to keep
          // the choice deterministic across replays.
          let pick: typeof created[number] | undefined;
          let pickLen = 0;
          for (const f of created) {
            const len = f.content?.length ?? 0;
            if (len > pickLen) {
              pick = f;
              pickLen = len;
            }
          }
          if (pick) {
            const chosen = pick;
            (async () => {
              try {
                await streamFileWrite({
                  internalKey,
                  projectId,
                  fileId: chosen.fileId as Id<"files">,
                  fileName: chosen.name,
                  content: chosen.content,
                  // Give this single file more breathing room than the old
                  // per-file budget so it actually looks like typing — the
                  // agent's other parallel work continues in the background
                  // while this one streams.
                  maxDurationMs: 1500,
                });
              } catch (err) {
                console.warn(
                  `[createFiles] editor stream failed for ${chosen.name}:`,
                  err
                );
              }
            })().catch(() => {
              /* swallow — already logged above */
            });
          }
        }

        return stepResult?.message ?? "Created files";
      } catch (error) {
        return `Error creating files: ${error instanceof Error ? error.message : "Unknown error"}`;
      }
    },
  });
};
