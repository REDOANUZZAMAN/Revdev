"use client";

import { useEffect, useMemo, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import { Sparkles } from "lucide-react";

import { customTheme } from "../extensions/theme";
import { customSetup } from "../extensions/custom-setup";
import { getLanguageExtension } from "../extensions/language-extension";

interface Props {
  fileName: string;
  content: string;
}

/**
 * Phase C — read-only mirror of the agent's in-flight file write.
 *
 * Subscribes externally (via Convex) and re-renders on every chunk. We use a
 * dedicated EditorState (no edit listeners, no quick-edit / suggestion plugins)
 * so the user can't type and the typing animation never fights against
 * intermediate parser passes.
 *
 * Important: we DON'T re-create the EditorView on every content change — we
 * dispatch a `replaceAll` transaction so CodeMirror efficiently diffs and
 * smoothly auto-scrolls to the cursor.
 */
export const StreamingEditor = ({ fileName, content }: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  const languageExtension = useMemo(
    () => getLanguageExtension(fileName),
    [fileName]
  );

  // Initialize the EditorView once per fileName (language change requires a fresh
  // state because language extensions are immutable on a state).
  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: "",
      extensions: [
        oneDark,
        customTheme,
        customSetup,
        languageExtension,
        EditorState.readOnly.of(true),
      ],
    });
    const view = new EditorView({
      state,
      parent: containerRef.current,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [languageExtension]);

  // Push every content update through a transaction; auto-scroll to end.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (view.state.doc.toString() === content) return;

    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: content,
      },
      // Always keep the cursor at the very end while streaming so the editor
      // auto-scrolls and the user can watch the latest characters appearing.
      selection: { anchor: content.length },
      scrollIntoView: true,
    });
  }, [content]);

  return (
    <div className="relative size-full">
      <div ref={containerRef} className="size-full pl-4 bg-background" />
      <div className="absolute top-3 right-3 flex items-center gap-1.5 rounded-md border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-xs font-medium text-violet-300 backdrop-blur-md shadow-lg pointer-events-none">
        <Sparkles className="size-3 animate-pulse" />
        <span>AI is writing {fileName}</span>
      </div>
    </div>
  );
};
