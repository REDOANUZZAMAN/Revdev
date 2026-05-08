import { z } from "zod";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

import { convex } from "@/lib/convex-client";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

// DeepSeek provider (OpenAI-compatible)
const deepseek = createOpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com/v1/',
});

const requestSchema = z.object({
  conversationId: z.string(),
  message: z.string(),
});

const SYSTEM_PROMPT = `You are REVDEV, an expert AI coding assistant. You help users with:
- Writing and debugging code
- Explaining programming concepts
- Building projects and applications
- Best practices and code reviews

Be helpful, concise, and provide working code examples when appropriate.
Use markdown formatting for code blocks.`;

export async function POST(request: Request) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const internalKey = process.env.POLARIS_CONVEX_INTERNAL_KEY;

  if (!internalKey) {
    return NextResponse.json(
      { error: "Internal key not configured" },
      { status: 500 }
    );
  }

  const body = await request.json();
  const { conversationId, message } = requestSchema.parse(body);

  // Get conversation
  const conversation = await convex.query(api.system.getConversationById, {
    internalKey,
    conversationId: conversationId as Id<"conversations">,
  });

  if (!conversation) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 }
    );
  }

  const projectId = conversation.projectId;

  // Get recent messages for context
  const recentMessages = await convex.query(api.system.getRecentMessages, {
    internalKey,
    conversationId: conversationId as Id<"conversations">,
    limit: 10,
  });

  // Build conversation history
  const messages = recentMessages
    .filter((msg) => msg.content.trim() !== "")
    .map((msg) => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    }));

  // Add current message
  messages.push({ role: "user", content: message });

  // Create user message in DB
  await convex.mutation(api.system.createMessage, {
    internalKey,
    conversationId: conversationId as Id<"conversations">,
    projectId,
    role: "user",
    content: message,
  });

  // Create assistant message placeholder
  const assistantMessageId = await convex.mutation(api.system.createMessage, {
    internalKey,
    conversationId: conversationId as Id<"conversations">,
    projectId,
    role: "assistant",
    content: "",
    status: "processing",
  });

  try {
    // Generate AI response directly using DeepSeek
    const { text } = await generateText({
      model: deepseek("deepseek-chat"),
      system: SYSTEM_PROMPT,
      messages,
    });

    // Update assistant message with response
    await convex.mutation(api.system.updateMessageContent, {
      internalKey,
      messageId: assistantMessageId,
      content: text,
    });

    await convex.mutation(api.system.updateMessageStatus, {
      internalKey,
      messageId: assistantMessageId,
      status: "completed",
    });

    return NextResponse.json({
      success: true,
      messageId: assistantMessageId,
      content: text,
    });
  } catch (error) {
    console.error("AI processing error:", error);

    // Update message with error
    await convex.mutation(api.system.updateMessageContent, {
      internalKey,
      messageId: assistantMessageId,
      content: "Sorry, I encountered an error processing your request.",
    });

    await convex.mutation(api.system.updateMessageStatus, {
      internalKey,
      messageId: assistantMessageId,
      status: "error",
    });

    return NextResponse.json(
      { error: "Failed to process message" },
      { status: 500 }
    );
  }
}
