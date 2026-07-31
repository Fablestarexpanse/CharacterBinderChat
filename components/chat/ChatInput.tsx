"use client";

import { useRef, useEffect, type KeyboardEvent } from "react";
import { useFableStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { startImageJob } from "@/lib/providers/comfyui";
import { generateAssistantReply, stopGeneration } from "@/lib/chat/generation";
import {
  Paperclip,
  ImageIcon,
  BookOpen,
  Wrench,
  Send,
  Square,
  Wand2,
} from "lucide-react";

export function ChatInput() {
  const {
    activeChatId,
    inputValue, setInputValue,
    addMessage,
    addImageJob, updateImageJob, imageSettings,
    providerSettings,
    isGenerating,
    setActiveSection,
  } = useFableStore();

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Lazy stat decay ────────────────────────────────────────────────────────
  // On the first render of this component (i.e. first session), apply
  // Ebbinghaus decay once. The server computes decay per-row from each stat's
  // own last_updated timestamp; this just decides whether a new session began.
  useEffect(() => {
    const LAST_SESSION_KEY = "fablechat:lastSessionAt";
    const now = Date.now();
    const lastStr = localStorage.getItem(LAST_SESSION_KEY);
    localStorage.setItem(LAST_SESSION_KEY, String(now));

    if (!lastStr) return; // first ever session — nothing to decay yet
    if (now - Number(lastStr) < 15 * 60 * 1000) return; // same sitting, skip

    fetch("/api/drawer/stats/decay", { method: "POST" })
      .catch((e) => console.warn("[decay]", e));
  }, []);

  // ── Send handler ──────────────────────────────────────────────────────────

  const handleSend = async () => {
    if (!inputValue.trim() || !activeChatId || isGenerating) return;

    const userContent = inputValue.trim();
    setInputValue("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    // /image command
    if (userContent.startsWith("/image ")) {
      await handleImageGeneration(userContent.slice(7).trim());
      return;
    }

    addMessage(activeChatId, { chatId: activeChatId, role: "user", content: userContent });
    generateAssistantReply(activeChatId);
  };

  // ── Image generation ──────────────────────────────────────────────────────

  const handleImageGeneration = async (prompt: string) => {
    if (!activeChatId) return;
    const settings = { ...imageSettings, prompt };
    // Queues to ComfyUI and streams status back into the job via the store —
    // the ImageCard in the message list re-renders as the job progresses.
    const job = startImageJob(
      providerSettings.comfyui.baseUrl,
      settings,
      activeChatId,
      updateImageJob
    );
    addImageJob(job);
    addMessage(activeChatId, {
      chatId:      activeChatId,
      role:        "assistant",
      content:     prompt,
      imageJobId:  job.id,
    });
  };

  // ── Keyboard / resize ─────────────────────────────────────────────────────

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  const isImageCommand = inputValue.startsWith("/image ");

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="px-4 pb-4 pt-2 flex-shrink-0">
      {isImageCommand && (
        <div className="flex items-center gap-2 mb-2 px-1">
          <Wand2 className="h-3.5 w-3.5 text-[var(--purple-fg)]" />
          <span className="text-xs text-[var(--purple-fg)]">
            Image generation — press Enter to generate
          </span>
        </div>
      )}

      <div
        className={`flex flex-col gap-2 rounded-2xl border bg-white p-2 transition-colors ${
          isImageCommand ? "border-[var(--purple)]" : "border-[var(--border)]"
        } focus-within:border-[var(--purple)] focus-within:ring-1 focus-within:ring-[var(--purple)]`}
      >
        <textarea
          ref={textareaRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder={
            isGenerating
              ? "Generating response…"
              : "Message… (try /image a cyberpunk alley at night)"
          }
          disabled={isGenerating}
          rows={1}
          className="w-full resize-none bg-transparent px-2 py-1 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-fg)] focus:outline-none disabled:opacity-50"
          style={{ minHeight: "36px", maxHeight: "160px" }}
        />

        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Attach file">
              <Paperclip className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title="Generate image (/image)"
              onClick={() => setInputValue("/image ")}
            >
              <ImageIcon className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title="Edit lorebooks"
              onClick={() => setActiveSection("lorebooks")}
            >
              <BookOpen className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Tools">
              <Wrench className="h-3.5 w-3.5" />
            </Button>
          </div>

          <Button
            variant="purple"
            size="icon"
            className="h-8 w-8 rounded-xl"
            onClick={isGenerating ? stopGeneration : handleSend}
            disabled={!isGenerating && !inputValue.trim()}
            title={isGenerating ? "Stop generating" : "Send (Enter)"}
          >
            {isGenerating
              ? <Square className="h-3.5 w-3.5" />
              : <Send   className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      <div className="text-center mt-1.5">
        <span className="text-[10px] text-[var(--muted-fg)]">
          Shift+Enter for new line · /image to generate · FableChat v0.1
        </span>
      </div>
    </div>
  );
}
