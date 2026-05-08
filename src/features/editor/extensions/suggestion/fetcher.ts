import ky from "ky";
import { z } from "zod";

/**
 * CodeMirror inline ghost-text suggestion fetcher.
 *
 * IMPORTANT — failures are intentionally silent. This endpoint is called on
 * every keystroke (debounced) AND on every file mount, so any toast on error
 * would spam the user with "Failed to fetch AI completion" every time the
 * suggestion provider has a hiccup, the user is offline, switches tabs, or
 * the abort fires mid-flight. Inline-completion is a "nice-to-have" and
 * should never get in the user's face.
 */

const suggestionRequestSchema = z.object({
  fileName: z.string(),
  code: z.string(),
  currentLine: z.string(),
  previousLines: z.string(),
  textBeforeCursor: z.string(),
  textAfterCursor: z.string(),
  nextLines: z.string(),
  lineNumber: z.number(),
});

const suggestionResponseSchema = z.object({
  suggestion: z.string(),
});

type SuggestionRequest = z.infer<typeof suggestionRequestSchema>;
type SuggestionResponse = z.infer<typeof suggestionResponseSchema>;

// Once we see a suggestion-API failure, back off for 60 s before trying again.
// This avoids retrying an obviously-broken endpoint on every keystroke and
// further driving up DeepSeek bill / browser noise.
let suggestionDisabledUntil = 0;

export const fetcher = async (
  payload: SuggestionRequest,
  signal: AbortSignal,
): Promise<string | null> => {
  if (Date.now() < suggestionDisabledUntil) return null;

  try {
    const validatedPayload = suggestionRequestSchema.parse(payload);

    const response = await ky
      .post("/api/suggestion", {
        json: validatedPayload,
        signal,
        timeout: 30_000,
        retry: 0,
      })
      .json<SuggestionResponse>();

    const validatedResponse = suggestionResponseSchema.parse(response);

    return validatedResponse.suggestion || null;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return null;
    }
    // Silent failure: log to the console for debugging but never toast.
    // Disable for 60 s so we don't hammer a broken endpoint.
    suggestionDisabledUntil = Date.now() + 60_000;
    if (typeof window !== "undefined") {
      // eslint-disable-next-line no-console
      console.warn("[suggestion] inline-completion disabled for 60s:", error);
    }
    return null;
  }
};
