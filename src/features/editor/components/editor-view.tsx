import Image from "next/image";
import { useEffect, useRef } from "react";
import { Code2, Sparkles } from "lucide-react";
import { useQuery } from "convex/react";

import { useFile, useUpdateFile } from "@/features/projects/hooks/use-files";

import { CodeEditor } from "./code-editor";
import { StreamingEditor } from "./streaming-editor";
import { useEditor } from "../hooks/use-editor";
import { TopNavigation } from "./top-navigation";
import { FileBreadcrumbs } from "./file-breadcrumbs";
import { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import { AlertTriangleIcon } from "lucide-react";

const DEBOUNCE_MS = 1500;

export const EditorView = ({ projectId }: { projectId: Id<"projects"> }) => {
  const { activeTabId, openFile } = useEditor(projectId);
  const activeFile = useFile(activeTabId);
  const updateFile = useUpdateFile();
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Phase C — subscribe to the agent's in-flight file stream (one per project).
  const editorStream = useQuery(api.editorStreams.getByProject, { projectId });
  const isStreaming = editorStream?.status === "streaming";
  const streamingFileId = editorStream?.fileId ?? null;

  // Auto-switch the active tab to whichever file the agent is currently writing.
  useEffect(() => {
    if (isStreaming && streamingFileId && streamingFileId !== activeTabId) {
      openFile(streamingFileId, { pinned: false });
    }
  }, [isStreaming, streamingFileId, activeTabId, openFile]);

  const showStreamingEditor =
    isStreaming &&
    streamingFileId !== null &&
    streamingFileId === activeTabId &&
    !!editorStream;

  const isActiveFileBinary = activeFile && activeFile.storageId;
  const isActiveFileText = activeFile && !activeFile.storageId;

  // Cleanup pending debounced updates on unmount or file change
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [activeTabId]);

  return (
    <div className="h-full flex flex-col bg-[#0a0a0f]">
      <div className="flex items-center border-b border-white/5">
        <TopNavigation projectId={projectId} />
      </div>
      {activeTabId && <FileBreadcrumbs projectId={projectId} />}
      <div className="flex-1 min-h-0 bg-[#0d0d14]">
        {!activeFile && (
          <div className="size-full flex flex-col items-center justify-center gap-6">
            {/* Premium Empty State */}
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-violet-500/20 to-cyan-500/20 rounded-full blur-3xl" />
              <div className="relative w-24 h-24 rounded-2xl bg-gradient-to-br from-violet-500/10 to-cyan-500/10 border border-white/10 flex items-center justify-center backdrop-blur-xl">
                <Code2 className="w-10 h-10 text-violet-400/50" />
              </div>
            </div>
            <div className="text-center space-y-2">
              <p className="text-gray-400 text-sm">Select a file to start editing</p>
              <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
                <Sparkles className="w-3 h-3 text-violet-400" />
                <span>AI-powered code assistance available</span>
              </div>
            </div>
          </div>
        )}
        {isActiveFileText && showStreamingEditor && editorStream && (
          <StreamingEditor
            key={`stream-${editorStream._id}`}
            fileName={editorStream.fileName}
            content={editorStream.content}
          />
        )}
        {isActiveFileText && !showStreamingEditor && (
          <CodeEditor
            key={activeFile._id}
            fileName={activeFile.name}
            initialValue={activeFile.content}
            onChange={(content: string) => {
              if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
              }

              timeoutRef.current = setTimeout(() => {
                updateFile({ id: activeFile._id, content });
              }, DEBOUNCE_MS);
            }}
          />
        )}
        {isActiveFileBinary && (
          <div className="size-full flex items-center justify-center">
            <div className="flex flex-col items-center gap-4 max-w-md text-center p-6 rounded-2xl bg-white/[0.02] border border-white/5">
              <div className="w-12 h-12 rounded-xl bg-yellow-500/10 flex items-center justify-center">
                <AlertTriangleIcon className="size-6 text-yellow-500" />
              </div>
              <p className="text-sm text-gray-400">
                The file is not displayed in the text editor because it is either binary or uses an unsupported text encoding.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
