import { z } from "zod";
import { createTool } from "@inngest/agent-kit";

import { convex } from "@/lib/convex-client";

import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { streamFileWrite } from "./_streaming";

interface UpdateFileToolOptions {
  internalKey: string;
  /** Optional — when provided, file writes will be visually streamed to the editor pane. */
  projectId?: Id<"projects">;
}

const paramsSchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  content: z.string(),
});

export const createUpdateFileTool = ({
  internalKey,
  projectId,
}: UpdateFileToolOptions) => {
  return createTool({
    name: "updateFile",
    description: "Update the content of an existing file",
    parameters: z.object({
      fileId: z.string().describe("The ID of the file to update"),
      content: z.string().describe("The new content for the file"),
    }),
    handler: async (params, { step: toolStep }) => {
      const parsed = paramsSchema.safeParse(params);
      if (!parsed.success) {
        return `Error: ${parsed.error.issues[0].message}`;
      }

      const { fileId, content } = parsed.data;

      // Validate file exists before running the step
      const file = await convex.query(api.system.getFileById, {
        internalKey,
        fileId: fileId as Id<"files">,
      });


      if (!file) {
        return `Error: File with ID "${fileId}" not found. Use listFiles to get valid file IDs.`;
      }

      if (file.type === "folder") {
        return `Error: "${fileId}" is a folder, not a file. You can only update file contents.`;
      }

      // ---------------------------------------------------------------
      // No-op guard.
      //
      // Was: the agent would sometimes call updateFile with content
      // byte-identical to what's already saved (it had been observed
      // re-writing the SAME globals.css 7-8 times in a row, each time
      // the streaming editor replayed the whole file from scratch).
      // That was wasted DB writes, wasted streaming bandwidth, AND the
      // model thought it was making progress when it wasn't — which is
      // how it hit maxIter without finishing the plan.
      //
      // We now short-circuit: if the new content is identical to the
      // current file content, we skip the write and return an explicit
      // "already up to date" string so the LLM can see it tried to no-
      // op and move on to the next plan step instead of looping.
      // ---------------------------------------------------------------
      if (typeof file.content === "string" && file.content === content) {
        return `Note: File "${file.name}" is already up to date with the provided content. Move on to the next plan step — do not retry this write.`;
      }

      try {
        const result = await toolStep?.run("update-file", async () => {
          await convex.mutation(api.system.updateFile, {
            internalKey,
            fileId: fileId as Id<"files">,
            content,
          });

          return `File "${file.name}" updated successfully`;
        });

        // Phase C — replay the saved content into the editor pane character-by-
        // character. Fire-and-forget; never let a streaming hiccup block the
        // tool result. Skipped automatically for tiny files inside the helper.
        if (projectId) {
          streamFileWrite({
            internalKey,
            projectId,
            fileId: fileId as Id<"files">,
            fileName: file.name,
            content,
          }).catch((err) => {
            console.warn("[updateFile] editor stream failed:", err);
          });
        }

        return result ?? `File "${file.name}" updated successfully`;
      } catch (error) {
        return `Error update file: ${error instanceof Error ? error.message : "Unknown error"}`;
      }
    }
  });
};
