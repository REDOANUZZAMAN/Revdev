import ky from "ky";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { 
  CopyIcon, 
  HistoryIcon, 
  LoaderIcon, 
  PlusIcon,
  Sparkles,
  MessageSquare,
  SendIcon,
  SquareIcon
} from "lucide-react";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
  MessageActions,
  MessageAction,
} from "@/components/ai-elements/message";
import {
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import { useStickToBottomContext } from "use-stick-to-bottom";

function AutoScroller({ messages, isProcessing }: { messages?: any[]; isProcessing?: boolean }) {
  const { scrollToBottom } = useStickToBottomContext();

  const snapshot = (messages || []).map((m) => `${m._id}:${m.content?.length ?? 0}:${m.status}`).join("|");

  useEffect(() => {
    // Whenever message contents or status change, scroll to bottom so progress is visible
    if (snapshot) {
      scrollToBottom();
    }
  }, [snapshot, isProcessing, scrollToBottom]);

  return null;
}

import {
  useConversation,
  useConversations,
  useCreateConversation,
  useMessages,
} from "../hooks/use-conversations";

import { Id } from "../../../../convex/_generated/dataModel";
import { DEFAULT_CONVERSATION_TITLE } from "../constants";
import { PastConversationsDialog } from "./past-conversations-dialog";
import { FileOperations } from "./file-operations";
import { PlanChecklist } from "./plan-checklist";
import { ActivityPanel } from "./activity-panel";

interface ConversationSidebarProps {
  projectId: Id<"projects">;
};

export const ConversationSidebar = ({
  projectId,
}: ConversationSidebarProps) => {
  const [input, setInput] = useState("");
  const [
    selectedConversationId,
    setSelectedConversationId,
  ] = useState<Id<"conversations"> | null>(null);
  const [
    pastConversationsOpen,
    setPastConversationsOpen
  ] = useState(false);

  const createConversation = useCreateConversation();
  const conversations = useConversations(projectId);

  const activeConversationId =
    selectedConversationId ?? conversations?.[0]?._id ?? null;

  const activeConversation = useConversation(activeConversationId);
  const conversationMessages = useMessages(activeConversationId);

  // Check if any message is currently processing
  const isProcessing = conversationMessages?.some(
    (msg) => msg.status === "processing"
  );

  const handleCancel = async () => {
    try {
      const response = await ky.post("/api/messages/cancel", {
        json: { projectId },
      }).json<{ success: boolean; cancelled: boolean }>();
      
      if (!response.cancelled) {
        // No processing messages to cancel - this is fine, just silently succeed
        return;
      }
    } catch (error) {
      console.error("Failed to cancel request:", error);
      toast.error("Unable to cancel request");
    }
  };

  const handleCreateConversation = async () => {
    try {
      const newConversationId = await createConversation({
        projectId,
        title: DEFAULT_CONVERSATION_TITLE,
      });
      setSelectedConversationId(newConversationId);
      return newConversationId;
    } catch {
      toast.error("Unable to create new conversation");
      return null;
    }
  };

  const handleSubmit = async (message: PromptInputMessage) => {
    // If processing and no new message, this is just a stop function
    if (isProcessing && !message.text) {
      handleCancel(); // Don't await - fire and forget
      setInput("");
      return;
    }

    // Clear input immediately for snappy UX
    const messageText = message.text;
    setInput("");

    let conversationId = activeConversationId;

    if (!conversationId) {
      conversationId = await handleCreateConversation();
      if (!conversationId) {
        return;
      }
    }

    // Trigger Inngest function via API - don't await for faster UX
    // Fire-and-forget but surface server errors to the user
    (async () => {
      try {
        const res = await ky.post("/api/messages", {
          json: {
            conversationId,
            message: messageText,
          },
        });

        // If server returned non-2xx, try to show its error message
        if (!res.ok) {
          let body: any = null;
          try {
            body = await res.json();
          } catch {}
          toast.error(body?.error || "Message failed to send");
        }
      } catch (err: any) {
        // ky throws for network or non-2xx errors; try to extract server message
        try {
          const response = err?.response;
          if (response) {
            const body = await response.json();
            toast.error(body?.error || err.message || "Message failed to send");
            return;
          }
        } catch {}

        toast.error(err?.message || "Message failed to send");
      }
    })();
  }

  return (
    <>
      <PastConversationsDialog
        projectId={projectId}
        open={pastConversationsOpen}
        onOpenChange={setPastConversationsOpen}
        onSelect={setSelectedConversationId}
      />
      <div className="flex flex-col h-full bg-[#0a0a0f]">
        {/* Premium Header */}
        <div className="h-12 flex items-center justify-between border-b border-white/5 bg-gradient-to-r from-[#0d0d14] to-[#0a0a0f] px-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-500/20 to-cyan-500/20 flex items-center justify-center flex-shrink-0">
              <MessageSquare className="size-3.5 text-violet-400" />
            </div>
            <span className="text-sm font-medium text-gray-200 truncate">
              {activeConversation?.title ?? DEFAULT_CONVERSATION_TITLE}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={() => setPastConversationsOpen(true)}
              className="hover:bg-white/10 text-gray-400 hover:text-gray-200"
            >
              <HistoryIcon className="size-3.5" />
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={handleCreateConversation}
              className="hover:bg-violet-500/20 text-gray-400 hover:text-violet-400"
            >
              <PlusIcon className="size-3.5" />
            </Button>
          </div>
        </div>
        <Conversation className="flex-1 bg-[#0d0d14]">
          <ConversationContent>
            {conversationMessages && conversationMessages.length > 0 && (
              <AutoScroller messages={conversationMessages} isProcessing={isProcessing} />
            )}
            {(!conversationMessages || conversationMessages.length === 0) ? (
              <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                <div className="relative mb-6">
                  <div className="absolute inset-0 bg-gradient-to-br from-violet-500/30 to-cyan-500/30 rounded-full blur-2xl scale-150" />
                  <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500/10 to-cyan-500/10 border border-white/10 flex items-center justify-center">
                    <Sparkles className="size-8 text-violet-400" />
                  </div>
                </div>
                <h3 className="text-lg font-semibold text-gray-200 mb-2">Start a Conversation</h3>
                <p className="text-sm text-gray-500 max-w-[200px]">Ask REVDEV anything about your code or project</p>
              </div>
            ) : conversationMessages?.map((message, messageIndex) => (
              <Message
                key={message._id}
                from={message.role}
              >
                <MessageContent>
                  {message.role === "assistant" && (
                    <PlanChecklist messageId={message._id} />
                  )}
                  {/* Phase H — Activity panel.
                      Was: every tool-call narration was concat'd into
                      `message.content`, so the chat bubble grew into a giant
                      mixed-up wall of text. Now narration lives in the
                      separate `progressLog` array and renders in this fixed
                      collapsible panel above the message body. */}
                  {message.role === "assistant" && (
                    <ActivityPanel
                      lines={message.progressLog ?? []}
                      isProcessing={message.status === "processing"}
                    />
                  )}
                  {message.status === "processing" ? (
                    /* While processing, the bubble's main body is empty —
                       all play-by-play is in the Activity panel above. */
                    null
                  ) : message.status === "cancelled" ? (
                    <span className="text-gray-500 italic">
                      Request cancelled
                    </span>
                  ) : (
                    <>
                      <MessageResponse>{message.content}</MessageResponse>
                      {message.role === "assistant" && message.metadata && (
                        <FileOperations
                          filesRead={message.metadata.filesRead}
                          filesModified={message.metadata.filesModified}
                          filesCreated={message.metadata.filesCreated}
                          filesDeleted={message.metadata.filesDeleted}
                        />
                      )}
                    </>
                  )}
                </MessageContent>
                {message.role === "assistant" &&
                  message.status === "completed" &&
                  messageIndex === (conversationMessages?.length ?? 0) - 1 && (
                    <MessageActions>
                      <MessageAction
                        onClick={() => {
                          navigator.clipboard.writeText(message.content)
                          toast.success("Copied to clipboard")
                        }}
                        label="Copy"
                      >
                        <CopyIcon className="size-3" />
                      </MessageAction>
                    </MessageActions>
                  )
                }
              </Message>
            ))}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
        
        {/* Premium Chat Input */}
        <div className="p-4 border-t border-white/10 bg-[#0a0a0f]">
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              if (isProcessing) {
                handleCancel();
              } else if (input.trim()) {
                handleSubmit({ text: input, files: [] });
              }
            }}
            className="flex items-end gap-3 px-4 py-4 rounded-2xl border border-white/20 bg-[#1a1a24] focus-within:border-violet-500/50 transition-all"
          >
            <textarea
              placeholder="Ask REVDEV anything..."
              onChange={(e) => setInput(e.target.value)}
              value={input}
              disabled={isProcessing}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (input.trim() && !isProcessing) {
                    handleSubmit({ text: input, files: [] });
                  }
                }
              }}
              style={{ border: 'none', outline: 'none', boxShadow: 'none' }}
              className="flex-1 bg-transparent text-gray-200 placeholder:text-gray-400 min-h-[48px] max-h-[150px] resize-none text-sm leading-relaxed focus:ring-0 focus:border-0"
              rows={2}
            />
            <button
              type="submit"
              disabled={isProcessing ? false : !input.trim()}
              className="shrink-0 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-600 hover:from-violet-500 hover:to-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed border-0 shadow-lg shadow-violet-500/25 transition-all duration-300 h-10 w-10 flex items-center justify-center text-white"
            >
              {isProcessing ? (
                <SquareIcon className="size-4" />
              ) : (
                <SendIcon className="size-4" />
              )}
            </button>
          </form>
        </div>
      </div>
    </>
  );
};

