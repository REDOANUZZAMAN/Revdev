import { useEffect, useState } from "react";

import { ChevronRightIcon } from "lucide-react";
import { FileIcon, FolderIcon } from "@react-symbols/icons/utils";

import { cn } from "@/lib/utils";

import {
  useCreateFile,
  useCreateFolder,
  useFolderContents,
  useRenameFile,
  useDeleteFile,
} from "@/features/projects/hooks/use-files";
import { useEditor } from "@/features/editor/hooks/use-editor";

import { getItemPadding } from "./constants";
import { LoadingRow } from "./loading-row";
import { CreateInput } from "./create-input";
import { RenameInput } from "./rename-input";
import { TreeItemWrapper } from "./tree-item-wrapper";
import { Doc, Id } from "../../../../../convex/_generated/dataModel";

export const Tree = ({
  item,
  level = 0,
  projectId,
  expandedFolderIds,
}: {
  item: Doc<"files">;
  level?: number;
  projectId: Id<"projects">;
  /**
   * Set of folder IDs that should be force-expanded so the active file is
   * visible. Computed once at the top of FileExplorer from useFilePath
   * (the active file's ancestor chain) — see big comment in index.tsx.
   * Passed unchanged through every recursive Tree call.
   */
  expandedFolderIds?: Set<Id<"files">>;
}) => {
  const shouldAutoExpand =
    item.type === "folder" && !!expandedFolderIds?.has(item._id);

  const [isOpen, setIsOpen] = useState(shouldAutoExpand);
  const [isRenaming, setIsRenaming] = useState(false);
  const [creating, setCreating] = useState<"file" | "folder" | null>(null);

  // Auto-expand whenever the active-file ancestry changes and now includes
  // this folder. Critical for the "agent just streamed a new file deep in
  // app/components/" case — without this effect, the folder would only
  // open on the next render that mounted Tree fresh (which never happens
  // until you reload). We never auto-collapse: if the user manually closed
  // a folder, respect their decision.
  useEffect(() => {
    if (shouldAutoExpand && !isOpen) setIsOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldAutoExpand]);

  const renameFile = useRenameFile({
    projectId,
    parentId: item.parentId,
  });
  const deleteFile = useDeleteFile({
    projectId,
    parentId: item.parentId,
  });
  const createFile = useCreateFile();
  const createFolder = useCreateFolder();

  const { openFile, closeTab, activeTabId } = useEditor(projectId);

  const folderContents = useFolderContents({
    projectId,
    parentId: item._id,
    enabled: item.type === "folder" && isOpen,
  });

  const handleRename = (newName: string) => {
    setIsRenaming(false);

    if (newName === item.name) {
      return;
    }

    renameFile({ id: item._id, newName });
  };

  const handleCreate = (name: string) => {
    setCreating(null);

    if (creating === "file") {
      createFile({
        projectId,
        name,
        content: "",
        parentId: item._id,
      });
    } else {
      createFolder({
        projectId,
        name,
        parentId: item._id,
      });
    }
  };

  const startCreating =(type: "file" | "folder") => {
    setIsOpen(true);
    setCreating(type);
  };

  if (item.type === "file") {
    const fileName = item.name;
    const isActive = activeTabId === item._id;

    if (isRenaming) {
      return (
        <RenameInput
          type="file"
          defaultValue={fileName}
          level={level}
          onSubmit={handleRename}
          onCancel={() => setIsRenaming(false)}
        />
      );
    }

    return (
      <TreeItemWrapper
        item={item}
        level={level}
        isActive={isActive}
        onClick={() => openFile(item._id, { pinned: false })}
        onDoubleClick={() => openFile(item._id, { pinned: true })}
        onRename={() => setIsRenaming(true)}
        onDelete={() => {
          closeTab(item._id);
          deleteFile({ id: item._id })
        }}
      >
        <FileIcon fileName={fileName} autoAssign className="size-4" />
        <span className="truncate text-sm">{fileName}</span>
      </TreeItemWrapper>
    )
  }

  const folderName = item.name;

  const folderRender = (
    <>
      <div className="flex items-center gap-1">
        <ChevronRightIcon
          className={cn(
            "size-4 shrink-0 text-gray-500 transition-transform duration-200",
            isOpen && "rotate-90 text-violet-400"
          )}
        />
        <FolderIcon folderName={folderName} className="size-4" />
      </div>
      <span className="truncate text-sm">{folderName}</span>
    </>
  )

  if (creating) {
    return (
      <>
        <button
          onClick={() => setIsOpen((value) => !value)}
          className="group flex items-center gap-1.5 h-7 hover:bg-white/5 w-full text-gray-400 hover:text-gray-200 transition-all duration-150 rounded-sm mx-1"
          style={{ paddingLeft: getItemPadding(level, false) }}
        >
          {folderRender}
        </button>
        {isOpen && (
          <>
            {folderContents === undefined && <LoadingRow level={level + 1} />}
            <CreateInput
              type={creating}
              level={level + 1}
              onSubmit={handleCreate}
              onCancel={() => setCreating(null)}
            />
            {folderContents?.map((subItem) => (
              <Tree
                key={subItem._id}
                item={subItem}
                level={level + 1}
                projectId={projectId}
                expandedFolderIds={expandedFolderIds}
              />
            ))}
          </>
        )}
      </>
    )
  }

  if (isRenaming) {
    return (
      <>
        <RenameInput
          type="folder"
          defaultValue={folderName}
          isOpen={isOpen}
          level={level}
          onSubmit={handleRename}
          onCancel={() => setIsRenaming(false)}
        />
        {isOpen && (
          <>
            {folderContents === undefined && <LoadingRow level={level + 1} />}
            {folderContents?.map((subItem) => (
              <Tree
                key={subItem._id}
                item={subItem}
                level={level + 1}
                projectId={projectId}
                expandedFolderIds={expandedFolderIds}
              />
            ))}
          </>
        )}
      </>
    )
  }

  return (
    <>
      <TreeItemWrapper
        item={item}
        level={level}
        onClick={() => setIsOpen((value) => !value)}
        onRename={() => setIsRenaming(true)}
        onDelete={() => {
          deleteFile({ id: item._id })
        }}
        onCreateFile={() => startCreating("file")}
        onCreateFolder={() => startCreating("folder")}
      >
        {folderRender}
      </TreeItemWrapper>
      {isOpen && (
        <>
          {folderContents === undefined && <LoadingRow level={level + 1} />}
          {folderContents?.map((subItem) => (
            <Tree
              key={subItem._id}
              item={subItem}
              level={level + 1}
              projectId={projectId}
              expandedFolderIds={expandedFolderIds}
            />
          ))}
        </>
      )}
    </>
  );
};
