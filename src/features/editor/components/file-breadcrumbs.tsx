import React from "react";
import { FileIcon } from "@react-symbols/icons/utils";
import { ChevronRight } from "lucide-react";

import { useFilePath } from "@/features/projects/hooks/use-files";
import { useEditor } from "@/features/editor/hooks/use-editor"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbPage,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

import { Id } from "../../../../convex/_generated/dataModel";

export const FileBreadcrumbs = ({
  projectId,
}: {
  projectId: Id<"projects">;
}) => {
  const { activeTabId } = useEditor(projectId);
  const filePath = useFilePath(activeTabId);

  if (filePath === undefined || !activeTabId) {
    return (
      <div className="px-4 py-2 bg-[#0d0d14] border-b border-white/5">
        <Breadcrumb>
          <BreadcrumbList className="sm:gap-0.5 gap-0.5">
            <BreadcrumbItem className="text-sm">
              <BreadcrumbPage>&nbsp;</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
    );
  }

  return (
    <div className="px-4 py-2.5 bg-gradient-to-r from-[#0d0d14] to-[#0a0a0f] border-b border-white/5">
      <Breadcrumb>
        <BreadcrumbList className="sm:gap-1 gap-1">
          {filePath.map((item, index) => {
            const isLast = index === filePath.length - 1;

            return (
              <React.Fragment key={item._id}>
                <BreadcrumbItem className="text-sm">
                  {isLast ? (
                    <BreadcrumbPage className="flex items-center gap-1.5 text-gray-200 font-medium">
                      <FileIcon
                        fileName={item.name}
                        autoAssign
                        className="size-4"
                      />
                      {item.name}
                    </BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink href="#" className="text-gray-500 hover:text-gray-300 transition-colors">
                      {item.name}
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
                {!isLast && (
                  <BreadcrumbSeparator>
                    <ChevronRight className="size-3 text-gray-600" />
                  </BreadcrumbSeparator>
                )}
              </React.Fragment>
            )
          })}
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  );
};
