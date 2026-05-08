import { z } from "zod";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { inngest } from "@/inngest/client";
import { convex } from "@/lib/convex-client";

import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

const requestSchema = z.object({
  conversationId: z.string(),
  message: z.string(),
});

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

  let body: any;
  try {
    body = await request.json();
  } catch (err) {
    console.error("/api/messages: failed to parse JSON body", err);
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { conversationId, message } = requestSchema.parse(body);

  // Call convex mutation, query
  console.log("/api/messages: fetching conversation", { conversationId });
  let conversation;
  try {
    conversation = await convex.query(api.system.getConversationById, {
      internalKey,
      conversationId: conversationId as Id<"conversations">,
    });
  } catch (err) {
    console.error("/api/messages: convex.query getConversationById failed", err);
    return NextResponse.json({ error: "Convex query failed" }, { status: 502 });
  }

  if (!conversation) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 }
    );
  }

  const projectId = conversation.projectId;

  // Find all processing messages in this project
  console.log("/api/messages: fetching processing messages for project", { projectId });
  let processingMessages = [] as any[];
  try {
    processingMessages = await convex.query(api.system.getProcessingMessages, {
      internalKey,
      projectId,
    });
  } catch (err) {
    console.error("/api/messages: convex.query getProcessingMessages failed", err);
    return NextResponse.json({ error: "Convex query failed" }, { status: 502 });
  }

  if (processingMessages.length > 0) {
    // Cancel all processing messages
    // Cancel processing messages: trigger cancel event and update status.
    await Promise.all(
      processingMessages.map(async (msg) => {
        try {
          // fire-and-forget the cancel event to avoid blocking the API
          inngest.send({
            name: "message/cancel",
            data: { messageId: msg._id },
          }).catch((e) => console.error("/api/messages: inngest.send cancel failed", e));

          await convex.mutation(api.system.updateMessageStatus, {
            internalKey,
            messageId: msg._id,
            status: "cancelled",
          });

          // BUG FIX: also flip the orphaned plan's running step to "skipped"
          // so the chat UI's PlanChecklist stops showing the cyan loader on
          // the previous (now-cancelled) message. Without this, the user
          // sends a new prompt and STILL sees the old plan's "running" spinner
          // animating below it indefinitely.
          try {
            await convex.mutation(api.plans.cancelActiveSteps, {
              internalKey,
              messageId: msg._id,
            });
          } catch (planErr) {
            console.error("/api/messages: cancelActiveSteps failed", msg._id, planErr);
          }
        } catch (err) {
          console.error("/api/messages: failed to cancel processing message", msg._id, err);
        }
      })
    );
  }

  // Create user message
  try {
    await convex.mutation(api.system.createMessage, {
      internalKey,
      conversationId: conversationId as Id<"conversations">,
      projectId,
      role: "user",
      content: message,
    });
  } catch (err) {
    console.error("/api/messages: convex.mutation createMessage (user) failed", err);
    return NextResponse.json({ error: "Convex mutation failed" }, { status: 502 });
  }

  // Create assistant message placeholder with processing status
  let assistantMessageId;
  try {
    assistantMessageId = await convex.mutation(api.system.createMessage, {
      internalKey,
      conversationId: conversationId as Id<"conversations">,
      projectId,
      role: "assistant",
      content: "",
      status: "processing",
    });
  } catch (err) {
    console.error("/api/messages: convex.mutation createMessage (assistant) failed", err);
    return NextResponse.json({ error: "Convex mutation failed" }, { status: 502 });
  }

  // Trigger Inngest to process the message asynchronously (don't await)
  try {
    inngest.send({
      name: "message/sent",
      data: { messageId: assistantMessageId, conversationId, projectId, message },
    }).catch((e) => console.error("/api/messages: inngest.send message/sent failed", e));
  } catch (err) {
    console.error("/api/messages: inngest.send threw", err);
  }

  // Return quickly to the client — background processing happens asynchronously.
  return NextResponse.json({ success: true, messageId: assistantMessageId });
};
