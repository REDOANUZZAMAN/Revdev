import { cn } from "@/lib/utils";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuContent,
  ContextMenuTrigger,
  ContextMenuShortcut,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";

import { getItemPadding } from "./constants";
import { Doc } from "../../../../../convex/_generated/dataModel";

export const TreeItemWrapper = ({
  item,
  children,
  level,
  isActive,
  onClick,
  onDoubleClick,
  onRename,
  onDelete,
  onCreateFile,
  onCreateFolder,
}: {
  item: Doc<"files">;
  children: React.ReactNode;
  level: number;
  isActive?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  onCreateFile?: () => void;
  onCreateFolder?: () => void;
}) => {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onRename?.();
            }
          }}
          className={cn(
            "group flex items-center gap-1.5 w-full h-7 text-gray-400 hover:text-gray-200 hover:bg-white/5 outline-none focus:ring-1 focus:ring-inset focus:ring-violet-500/50 transition-all duration-150 rounded-sm mx-1",
            isActive && "bg-gradient-to-r from-violet-500/15 to-transparent text-white border-l-2 border-l-violet-500",
          )}
          style={{ paddingLeft: getItemPadding(level, item.type === "file") }}
        >
          {children}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent
        onCloseAutoFocus={(e) => e.preventDefault()}
        className="w-64 bg-[#0d0d14] border-white/10"
      >
        {item.type === "folder" && (
          <>
            <ContextMenuItem 
              onClick={onCreateFile}
              className="text-sm hover:bg-violet-500/20 focus:bg-violet-500/20"
            >
              New File...
            </ContextMenuItem>
            <ContextMenuItem 
              onClick={onCreateFolder}
              className="text-sm hover:bg-cyan-500/20 focus:bg-cyan-500/20"
            >
              New Folder...
            </ContextMenuItem>
            <ContextMenuSeparator className="bg-white/10" />
          </>
        )}
         <ContextMenuItem 
          onClick={onRename}
          className="text-sm hover:bg-white/10 focus:bg-white/10"
        >
          Rename...
          <ContextMenuShortcut>
            Enter
          </ContextMenuShortcut>
        </ContextMenuItem>
         <ContextMenuItem 
          onClick={onDelete}
          className="text-sm text-red-400 hover:bg-red-500/20 focus:bg-red-500/20"
        >
          Delete Permanently
          <ContextMenuShortcut>
            ⌘Backspace
          </ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};
