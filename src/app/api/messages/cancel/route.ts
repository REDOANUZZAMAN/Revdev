import { z } from "zod";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { inngest } from "@/inngest/client";
import { convex } from "@/lib/convex-client";

import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

const requestSchema = z.object({
  projectId: z.string(),
});

export async function POST(request: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    
    const body = await request.json();
    const { projectId } = requestSchema.parse(body);

    const internalKey = process.env.POLARIS_CONVEX_INTERNAL_KEY;

    if (!internalKey) {
      return NextResponse.json(
        { error: "Internal key not configured" },
        { status: 500 }
      );
    }

    // Find all processing messages in this project
    const processingMessages = await convex.query(
      api.system.getProcessingMessages,
      {
        internalKey,
        projectId: projectId as Id<"projects">,
      }
    );

    if (processingMessages.length === 0) {
      return NextResponse.json({ success: true, cancelled: false });
    }

    // Cancel all processing messages
    const cancelledIds = await Promise.all(
      processingMessages.map(async (msg) => {
        // Send cancel event to Inngest (fire and forget - don't fail if this errors)
        try {
          await inngest.send({
            name: "message/cancel",
            data: {
              messageId: msg._id,
            },
          });
        } catch (error) {
          console.error("Failed to send cancel event to Inngest:", error);
        }

        // Update message status in database
        await convex.mutation(api.system.updateMessageStatus, {
          internalKey,
          messageId: msg._id,
          status: "cancelled",
        });

        // BUG FIX: also flip the plan's still-running step to "skipped" so the
        // UI's PlanChecklist stops showing the cyan loader forever. Without this
        // the message is marked cancelled but the plan keeps spinning.
        try {
          await convex.mutation(api.plans.cancelActiveSteps, {
            internalKey,
            messageId: msg._id,
          });
        } catch (e) {
          console.error("/api/messages/cancel: cancelActiveSteps failed", e);
          // Non-fatal: cancellation of the message itself already succeeded.
        }

        return msg._id;
      })
    );

    return NextResponse.json({
      success: true,
      cancelled: true,
      messageIds: cancelledIds,
    });
  } catch (error) {
    console.error("Cancel request failed:", error);
    return NextResponse.json(
      { error: "Failed to cancel request" },
      { status: 500 }
    );
  }
};
