import JSZip from "jszip";
import { saveAs } from "file-saver";

import { Doc, Id } from "../../../../convex/_generated/dataModel";

type FileDoc = Doc<"files">;

/**
 * Get full path for a file by traversing parent chain
 */
const getFilePath = (
  file: FileDoc,
  filesMap: Map<Id<"files">, FileDoc>
): string => {
  const parts: string[] = [file.name];
  let parentId = file.parentId;

  while (parentId) {
    const parent = filesMap.get(parentId);
    if (!parent) break;
    parts.unshift(parent.name);
    parentId = parent.parentId;
  }

  return parts.join("/");
};

/**
 * Download project files as a ZIP archive
 */
export const downloadProjectAsZip = async (
  files: FileDoc[],
  projectName: string = "project"
): Promise<void> => {
  const zip = new JSZip();
  const filesMap = new Map(files.map((f) => [f._id, f]));

  for (const file of files) {
    // Skip folders - they're created implicitly by JSZip
    if (file.type === "folder") continue;
    
    // Skip files without content (binary files with storageId)
    if (file.storageId || file.content === undefined) continue;

    const filePath = getFilePath(file, filesMap);
    zip.file(filePath, file.content);
  }

  const blob = await zip.generateAsync({ type: "blob" });
  
  // Sanitize project name for filename
  const sanitizedName = projectName
    .replace(/[^a-z0-9]/gi, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
  
  saveAs(blob, `${sanitizedName}.zip`);
};
