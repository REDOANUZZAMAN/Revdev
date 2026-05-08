/**
 * Phase F — In-process TypeScript compile-check.
 *
 * Why not run `tsc`?
 *  - We'd have to write the agent's files to a temp dir, npm-install in there,
 *    and shell out. Slow + error-prone on Windows.
 *
 * What this does:
 *  - Loads project files from Convex (in-memory representation).
 *  - Walks them into a Map<path, content> virtual filesystem.
 *  - Builds a TS Program with a custom CompilerHost that reads from the map
 *    AND falls back to the local `node_modules` (for React types etc.) on disk.
 *  - Returns syntactic + semantic diagnostics.
 *
 * Caveats:
 *  - Diagnostics about missing modules from packages the agent invented will
 *    show up — that's a feature: it tells the agent "you used `lodash-es`
 *    but didn't add it to package.json".
 *  - Type-check is "loose" (skipLibCheck=true, noEmit=true) so it stays under
 *    a few seconds for typical projects.
 */

import * as ts from "typescript";
import * as path from "path";

import { convex } from "@/lib/convex-client";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";

const NEXTLINE = ts.sys.newLine;

export interface CompileError {
  file: string;
  line: number;
  column: number;
  message: string;
  code?: number;
}

export interface CompileResult {
  errors: CompileError[];
  fileCount: number;
  durationMs: number;
}

/**
 * Walk the flat file list returned by Convex into absolute virtual paths
 * keyed by "/<a>/<b>/<c>.tsx" so the TS host can resolve relative imports.
 */
async function loadVirtualFiles(
  projectId: Id<"projects">,
  internalKey: string
): Promise<Map<string, string>> {
  const files = await convex.query(api.system.getProjectFiles, {
    internalKey,
    projectId,
  });

  // Build id -> file map and id -> path resolver.
  const byId = new Map<string, (typeof files)[number]>();
  for (const f of files) byId.set(f._id, f);

  const pathOf = (file: (typeof files)[number]): string => {
    const segments: string[] = [file.name];
    let cur = file;
    while (cur.parentId) {
      const parent = byId.get(cur.parentId);
      if (!parent) break;
      segments.unshift(parent.name);
      cur = parent;
    }
    return "/" + segments.join("/");
  };

  const out = new Map<string, string>();
  for (const f of files) {
    if (f.type !== "file") continue;
    if (f.storageId) continue; // binary -> skip
    if (typeof f.content !== "string") continue;
    out.set(pathOf(f), f.content);
  }
  return out;
}

const TS_EXTS = [".ts", ".tsx"];

function pickEntryFiles(virtualFs: Map<string, string>): string[] {
  // Type-check ALL .ts/.tsx files. The TS Program will then pull in their
  // imports automatically.
  return [...virtualFs.keys()].filter((p) =>
    TS_EXTS.some((ext) => p.toLowerCase().endsWith(ext))
  );
}

/**
 * Build a CompilerHost that:
 *   1. Reads .ts/.tsx from the virtual map.
 *   2. Falls back to the LOCAL node_modules directory for type defs and
 *      packages, so `import React from "react"` resolves to the host's
 *      installed @types/react.
 */
function makeHost(
  virtualFs: Map<string, string>,
  options: ts.CompilerOptions
): ts.CompilerHost {
  const realHost = ts.createCompilerHost(options, true);
  const cwd = process.cwd();

  return {
    ...realHost,
    getSourceFile: (
      fileName: string,
      languageVersion: ts.ScriptTarget,
      onError?: (m: string) => void
    ) => {
      // Try virtual fs first.
      if (virtualFs.has(fileName)) {
        const text = virtualFs.get(fileName)!;
        return ts.createSourceFile(fileName, text, languageVersion, true);
      }
      // Fall back to real fs (node_modules, lib.d.ts).
      return realHost.getSourceFile(fileName, languageVersion, onError);
    },
    fileExists: (fileName: string) => {
      if (virtualFs.has(fileName)) return true;
      return realHost.fileExists(fileName);
    },
    readFile: (fileName: string) => {
      if (virtualFs.has(fileName)) return virtualFs.get(fileName);
      return realHost.readFile(fileName);
    },
    getCurrentDirectory: () => "/",
    getDefaultLibLocation: () => path.join(cwd, "node_modules", "typescript", "lib"),
    getDefaultLibFileName: (opts) =>
      path.join(cwd, "node_modules", "typescript", "lib", ts.getDefaultLibFileName(opts)),
    writeFile: () => {}, // no emit
    useCaseSensitiveFileNames: () => false,
    getNewLine: () => NEXTLINE,
    getCanonicalFileName: (n) => n.toLowerCase(),
  };
}

function flattenMessage(msg: string | ts.DiagnosticMessageChain): string {
  return ts.flattenDiagnosticMessageText(msg, NEXTLINE);
}

/**
 * Run the compile check. Returns errors (empty array == passed).
 *
 * @param projectId the Convex project to check
 * @param internalKey  POLARIS_CONVEX_INTERNAL_KEY
 * @param maxErrors   stop collecting after this many (we cap at 50 in the table anyway)
 */
export async function compileCheck(
  projectId: Id<"projects">,
  internalKey: string,
  maxErrors: number = 100
): Promise<CompileResult> {
  const startedAt = Date.now();
  const virtualFs = await loadVirtualFiles(projectId, internalKey);
  const entryFiles = pickEntryFiles(virtualFs);

  if (entryFiles.length === 0) {
    return { errors: [], fileCount: 0, durationMs: Date.now() - startedAt };
  }

  // Look for a tsconfig.json in the project; fall back to sensible Next-like defaults.
  let parsedConfig: ts.CompilerOptions;
  const tsconfigPath = "/tsconfig.json";
  if (virtualFs.has(tsconfigPath)) {
    try {
      const result = ts.parseConfigFileTextToJson(tsconfigPath, virtualFs.get(tsconfigPath)!);
      const compilerOpts = (result.config?.compilerOptions ?? {}) as Record<string, unknown>;
      const conv = ts.convertCompilerOptionsFromJson(compilerOpts, "/");
      parsedConfig = conv.options;
    } catch {
      parsedConfig = {};
    }
  } else {
    parsedConfig = {};
  }

  // Force-overrides — we don't want to emit anything and we want fast checks.
  const options: ts.CompilerOptions = {
    ...parsedConfig,
    noEmit: true,
    skipLibCheck: true,
    skipDefaultLibCheck: true,
    incremental: false,
    isolatedModules: true,
    esModuleInterop: true,
    allowJs: true,
    resolveJsonModule: true,
    jsx: parsedConfig.jsx ?? ts.JsxEmit.Preserve,
    target: parsedConfig.target ?? ts.ScriptTarget.ES2020,
    module: parsedConfig.module ?? ts.ModuleKind.ESNext,
    moduleResolution: parsedConfig.moduleResolution ?? ts.ModuleResolutionKind.Bundler,
    types: parsedConfig.types ?? [],
    lib: parsedConfig.lib ?? ["ES2020", "DOM", "DOM.Iterable"],
    // Don't blow up on missing peer deps / unresolved imports — those become
    // diagnostics, but don't crash the program build.
    noResolve: false,
  };

  const host = makeHost(virtualFs, options);
  const program = ts.createProgram(entryFiles, options, host);

  const diagnostics = [
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
  ];

  const errors: CompileError[] = [];
  for (const d of diagnostics) {
    if (d.category !== ts.DiagnosticCategory.Error) continue;
    if (errors.length >= maxErrors) break;

    let line = 0;
    let column = 0;
    let file = "(unknown)";
    if (d.file && typeof d.start === "number") {
      const pos = d.file.getLineAndCharacterOfPosition(d.start);
      line = pos.line + 1;
      column = pos.character + 1;
      file = d.file.fileName.replace(/^\/+/, ""); // drop leading "/"
    }
    errors.push({
      file,
      line,
      column,
      message: flattenMessage(d.messageText),
      code: d.code,
    });
  }

  return {
    errors,
    fileCount: entryFiles.length,
    durationMs: Date.now() - startedAt,
  };
}
