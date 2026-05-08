import { generateText } from "ai";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createOpenAI } from "@ai-sdk/openai";
// import { anthropic } from "@ai-sdk/anthropic";
// import { google } from "@ai-sdk/google";

// DeepSeek provider (OpenAI-compatible)
const deepseek = createOpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com/v1/',
});

const SUGGESTION_PROMPT = `You are a code suggestion assistant. Return ONLY the code to insert, nothing else. No markdown, no explanation, just raw code or empty string.

<context>
<file_name>{fileName}</file_name>
<previous_lines>
{previousLines}
</previous_lines>
<current_line number="{lineNumber}">{currentLine}</current_line>
<before_cursor>{textBeforeCursor}</before_cursor>
<after_cursor>{textAfterCursor}</after_cursor>
<next_lines>
{nextLines}
</next_lines>
<full_code>
{code}
</full_code>
</context>

<instructions>
Follow these steps IN ORDER:

1. First, look at next_lines. If next_lines contains ANY code, check if it continues from where the cursor is. If it does, return empty string immediately - the code is already written.

2. Check if before_cursor ends with a complete statement (;, }, )). If yes, return empty string.

3. Only if steps 1 and 2 don't apply: suggest what should be typed at the cursor position, using context from full_code.

Your suggestion is inserted immediately after the cursor, so never suggest code that's already in the file.

RESPOND WITH ONLY THE CODE TO INSERT OR AN EMPTY STRING. NO EXPLANATION.
</instructions>`;

export async function POST(request: Request) {
  let body: any = null;

  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 403 },
      );
    }

    // read body defensively so we can log it on errors for debugging
    try {
      body = await request.json();
    } catch (err) {
      console.error("Failed to parse request body for suggestion endpoint", err);
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const {
      fileName,
      code,
      currentLine,
      previousLines,
      textBeforeCursor,
      textAfterCursor,
      nextLines,
      lineNumber,
    } = body;

    if (!code) {
      return NextResponse.json(
        { error: "Code is required" },
        { status: 400 }
      );
    }

    const prompt = SUGGESTION_PROMPT
      .replace("{fileName}", fileName)
      .replace("{code}", code)
      .replace("{currentLine}", currentLine)
      .replace("{previousLines}", previousLines || "")
      .replace("{textBeforeCursor}", textBeforeCursor)
      .replace("{textAfterCursor}", textAfterCursor)
      .replace("{nextLines}", nextLines || "")
      .replace("{lineNumber}", (lineNumber ?? 0).toString());

    let text: string | undefined;

    try {
      const res = await generateText({
        model: deepseek("deepseek-chat"),
        prompt,
        // Renamed in ai-sdk v5 from `maxTokens` -> `maxOutputTokens`
        maxOutputTokens: 150,
      });
      text = res.text;
    } catch (providerError) {
      // Log provider error with minimal prompt info to help debugging in dev
      const errMsg =
        providerError instanceof Error
          ? providerError.message
          : String(providerError);
      if (process.env.NODE_ENV !== "production") {
        console.error("Suggestion provider error:", providerError);
        console.error("Prompt snippet:", prompt.slice(0, 1000));
        console.error("Request body:", body);
      } else {
        console.error("Suggestion provider error (production):", errMsg);
      }
      return NextResponse.json({ error: "AI provider error" }, { status: 502 });
    }

    // Clean up the response - remove any markdown or extra whitespace
    const suggestion = (text || "").trim().replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();

    return NextResponse.json({ suggestion });
  } catch (error: any) {
    // Detailed logging only in non-production to avoid leaking user code in logs
    if (process.env.NODE_ENV !== "production") {
      console.error("Suggestion endpoint error:", error?.stack || error);
      console.error("Last parsed request body:", body);
    } else {
      console.error("Suggestion endpoint error (production):", error?.message || error);
    }

    return NextResponse.json({ error: "Failed to generate suggestion" }, { status: 500 });
  }
}
