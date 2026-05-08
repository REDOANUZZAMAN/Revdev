"use client";

import { FileIcon, FilePlusIcon, FileMinusIcon, PencilIcon, EyeIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileOperation {
  path: string;
  linesAdded: number;
  linesRemoved: number;
}

interface FileOperationsProps {
  filesRead?: string[];
  filesModified?: FileOperation[];
  filesCreated?: string[];
  filesDeleted?: string[];
  className?: string;
}

export const FileOperations = ({
  filesRead,
  filesModified,
  filesCreated,
  filesDeleted,
  className,
}: FileOperationsProps) => {
  const hasOperations = 
    (filesRead && filesRead.length > 0) ||
    (filesModified && filesModified.length > 0) ||
    (filesCreated && filesCreated.length > 0) ||
    (filesDeleted && filesDeleted.length > 0);

  if (!hasOperations) return null;

  return (
    <div className={cn("flex flex-col gap-1.5 mt-3 pt-3 border-t border-white/10", className)}>
      {/* Files Read */}
      {filesRead && filesRead.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {filesRead.map((file, idx) => (
            <div
              key={`read-${idx}`}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs"
            >
              <EyeIcon className="size-3 text-blue-400" />
              <span className="text-blue-300 font-mono truncate max-w-[150px]">{file.split('/').pop()}</span>
            </div>
          ))}
        </div>
      )}

      {/* Files Modified */}
      {filesModified && filesModified.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {filesModified.map((file, idx) => (
            <div
              key={`mod-${idx}`}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs"
            >
              <PencilIcon className="size-3 text-amber-400" />
              <span className="text-amber-300 font-mono truncate max-w-[150px]">{file.path.split('/').pop()}</span>
              {(file.linesAdded > 0 || file.linesRemoved > 0) && (
                <span className="flex items-center gap-1 text-[10px]">
                  {file.linesAdded > 0 && (
                    <span className="text-green-400">+{file.linesAdded}</span>
                  )}
                  {file.linesRemoved > 0 && (
                    <span className="text-red-400">-{file.linesRemoved}</span>
                  )}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Files Created */}
      {filesCreated && filesCreated.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {filesCreated.map((file, idx) => (
            <div
              key={`create-${idx}`}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-green-500/10 border border-green-500/20 text-xs"
            >
              <FilePlusIcon className="size-3 text-green-400" />
              <span className="text-green-300 font-mono truncate max-w-[150px]">{file.split('/').pop()}</span>
            </div>
          ))}
        </div>
      )}

      {/* Files Deleted */}
      {filesDeleted && filesDeleted.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {filesDeleted.map((file, idx) => (
            <div
              key={`delete-${idx}`}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-xs"
            >
              <FileMinusIcon className="size-3 text-red-400" />
              <span className="text-red-300 font-mono truncate max-w-[150px]">{file.split('/').pop()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
