import { useMemo, useState } from "react"
import { ChevronRightIcon, CopyMinusIcon, FilePlusCornerIcon, FolderPlusIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"

import { useProject } from "../../hooks/use-projects"
import { useEditor } from "@/features/editor/hooks/use-editor"
import { Id } from "../../../../../convex/_generated/dataModel"
import {
  useCreateFile,
  useCreateFolder,
  useFolderContents,
  useFilePath,
} from "../../hooks/use-files"
import { CreateInput } from "./create-input"
import { LoadingRow } from "./loading-row"
import { Tree } from "./tree"

export const FileExplorer = ({ 
  projectId
}: { 
  projectId: Id<"projects">
}) => {
  const [isOpen, setIsOpen] = useState(true);
  const [collapseKey, setCollapseKey] = useState(0);
  const [creating, setCreating] = useState<"file" | "folder" | null>(
    null
  );

  const project = useProject(projectId);
  const rootFiles = useFolderContents({
    projectId,
    enabled: isOpen,
  });

  // BUG FIX (file-tree auto-expand): when the user clicks a file in the
  // explorer OR the agent opens a freshly-streamed file (see EditorView's
  // useEffect that calls openFile on streamingFileId), the active tab can be
  // deeply nested inside un-expanded folders. The old behaviour kept those
  // folders collapsed, so the user had to manually click every parent to
  // see what file was actually open.
  //
  // Fix: ask Convex for the active file's ancestor chain, build a Set of
  // those folder IDs, and pass it down so each <Tree> can auto-open if its
  // own _id is in the set. Cheap (1 query, indexed walk).
  const { activeTabId } = useEditor(projectId);
  const activeFilePath = useFilePath(activeTabId);
  const expandedFolderIds = useMemo(() => {
    const set = new Set<Id<"files">>();
    if (!activeFilePath) return set;
    // The path returned from getFilePath includes the file itself as the last
    // entry. We only want its FOLDER ancestors expanded — the file row doesn't
    // need expanding (and including it would re-open after a manual collapse).
    for (let i = 0; i < activeFilePath.length - 1; i++) {
      set.add(activeFilePath[i]._id as Id<"files">);
    }
    return set;
  }, [activeFilePath]);

  const createFile = useCreateFile();
  const createFolder = useCreateFolder();
  const handleCreate = (name: string) => {
    setCreating(null);

    if (creating === "file") {
      createFile({
        projectId,
        name,
        content: "",
        parentId: undefined,
      });
    } else {
      createFolder({
        projectId,
        name,
        parentId: undefined,
      });
    }
  };

  return (
    <div className="h-full bg-[#0a0a0f] border-r border-white/5">
      <ScrollArea className="h-full">
        <div
          role="button"
          onClick={() => setIsOpen((value) => !value)}
          className="group/project cursor-pointer w-full text-left flex items-center gap-1.5 h-8 px-3 bg-gradient-to-r from-violet-500/5 to-transparent font-semibold border-b border-white/5 hover:from-violet-500/10 transition-all duration-200"
        >
          <ChevronRightIcon
            className={cn(
              "size-4 shrink-0 text-gray-500 transition-transform duration-200",
              isOpen && "rotate-90 text-violet-400"
            )}
          />
          <p className="text-xs uppercase tracking-wider text-gray-300 line-clamp-1">
            {project?.name ?? "Loading..."}
          </p>
          <div className="opacity-0 group-hover/project:opacity-100 transition-opacity duration-200 flex items-center gap-1 ml-auto">
            <Button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setIsOpen(true);
                setCreating("file");
              }}
              variant="ghost"
              size="icon-xs"
              className="hover:bg-violet-500/20 hover:text-violet-400"
            >
              <FilePlusCornerIcon className="size-3.5" />
            </Button>
            <Button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setIsOpen(true);
                setCreating("folder");
              }}
              variant="ghost"
              size="icon-xs"
              className="hover:bg-cyan-500/20 hover:text-cyan-400"
            >
              <FolderPlusIcon className="size-3.5" />
            </Button>
            <Button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setCollapseKey((prev) => prev + 1);
              }}
              variant="ghost"
              size="icon-xs"
              className="hover:bg-white/10"
            >
              <CopyMinusIcon className="size-3.5" />
            </Button>
          </div>
        </div>
        {isOpen && (
          <div className="py-1">
            {rootFiles === undefined && <LoadingRow level={0} />}
            {creating && (
              <CreateInput
                type={creating}
                level={0}
                onSubmit={handleCreate}
                onCancel={() => setCreating(null)}
              />
            )}
            {rootFiles?.map((item) => (
              <Tree
                key={`${item._id}-${collapseKey}`}
                item={item}
                level={0}
                projectId={projectId}
                expandedFolderIds={expandedFolderIds}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}