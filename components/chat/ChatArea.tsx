"use client";

import { useEffect, useRef } from "react";
import { useFableStore } from "@/lib/store";
import { ChatHeader } from "./ChatHeader";
import { MessageItem } from "./MessageItem";
import { ChatInput } from "./ChatInput";
import { MessageSquare } from "lucide-react";

export function ChatArea() {
  const { activeChatId, chats } = useFableStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const chat = chats.find((c) => c.id === activeChatId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat?.messages.length]);

  if (!activeChatId || !chat) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white">
        <div className="text-center space-y-3">
          <div className="h-16 w-16 rounded-2xl bg-[var(--purple-light)] flex items-center justify-center mx-auto">
            <MessageSquare className="h-8 w-8 text-[var(--purple-fg)]" />
          </div>
          <div className="text-sm font-medium text-[var(--foreground)]">No chat selected</div>
          <div className="text-xs text-[var(--muted-fg)]">
            Choose a character and start a new chat
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-w-0 bg-white">
      <ChatHeader />

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4 space-y-1">
        {chat.messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-2">
              <div className="text-sm text-[var(--muted-fg)]">No messages yet</div>
              <div className="text-xs text-[var(--muted-fg)]">Start the conversation below</div>
            </div>
          </div>
        ) : (
          chat.messages.map((msg) => <MessageItem key={msg.id} message={msg} />)
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <ChatInput />
    </div>
  );
}
