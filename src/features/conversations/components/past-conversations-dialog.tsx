"use client";

import { formatDistanceToNow } from "date-fns";
import { MessageSquare, Clock, Sparkles } from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

import { useConversations } from "../hooks/use-conversations";

import { Id } from "../../../../convex/_generated/dataModel";

interface PastConversationsDialogProps {
  projectId: Id<"projects">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (conversationId: Id<"conversations">) => void;
};

export const PastConversationsDialog = ({
  projectId,
  open,
  onOpenChange,
  onSelect,
}: PastConversationsDialogProps) => {
  const conversations = useConversations(projectId);

  const handleSelect = (conversationId: Id<"conversations">) => {
    onSelect(conversationId);
    onOpenChange(false);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Past Conversations"
      description="Search and select a past conversation"
      className="bg-[#0d0d14] border border-white/10 shadow-2xl shadow-violet-500/10"
    >
      <div className="px-4 py-3 border-b border-white/10 bg-gradient-to-r from-violet-500/5 to-cyan-500/5">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500/20 to-cyan-500/20 flex items-center justify-center">
            <Sparkles className="size-4 text-violet-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-200">Conversation History</h2>
            <p className="text-xs text-gray-500">Select a conversation to continue</p>
          </div>
        </div>
      </div>
      <CommandInput 
        placeholder="Search conversations..." 
        className="border-0 bg-transparent text-gray-200 placeholder:text-gray-500"
      />
      <CommandList className="max-h-[400px] p-2">
        <CommandEmpty className="py-8 text-center">
          <div className="flex flex-col items-center gap-2">
            <MessageSquare className="size-8 text-gray-600" />
            <span className="text-gray-500">No conversations found</span>
          </div>
        </CommandEmpty>
        <CommandGroup heading="Conversations" className="[&_[cmdk-group-heading]]:text-gray-500 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:mb-2">
          {conversations?.map((conversation, index) => (
            <CommandItem
              key={conversation._id}
              value={`${conversation.title}-${conversation._id}`}
              onSelect={() => handleSelect(conversation._id)}
              className="rounded-xl px-3 py-3 cursor-pointer data-[selected=true]:bg-gradient-to-r data-[selected=true]:from-violet-500/20 data-[selected=true]:to-cyan-500/20 data-[selected=true]:border data-[selected=true]:border-violet-500/30 hover:bg-white/5 transition-all duration-200 mb-1"
            >
              <div className="flex items-center gap-3 w-full">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500/10 to-cyan-500/10 border border-white/5 flex items-center justify-center shrink-0">
                  <MessageSquare className="size-4 text-violet-400" />
                </div>
                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                  <span className="text-sm font-medium text-gray-200 truncate">{conversation.title}</span>
                  <div className="flex items-center gap-1.5 text-xs text-gray-500">
                    <Clock className="size-3" />
                    <span>
                      {formatDistanceToNow(conversation._creationTime, {
                        addSuffix: true,
                      })}
                    </span>
                  </div>
                </div>
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
};