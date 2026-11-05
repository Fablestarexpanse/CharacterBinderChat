"use client";

import { useEffect, useState } from "react";
import { useUiStore } from "@/lib/store/ui";
import { useFableStore } from "@/lib/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { estimateTokens } from "@/lib/chat/promptBuilder";
import { LORE_TOKEN_BUDGET } from "@/lib/chat/lorebook";
import { charactersUsingLorebook, chatsListingLorebook, plural } from "@/lib/chat/references";
import { BookOpen, Plus, Trash2, Zap, Pin, ChevronDown, ChevronRight } from "lucide-react";
import type { LoreEntry } from "@/lib/types";
import { BannerControl, BannerFade, bannerStyle, BANNER_TEXT, BANNER_SUBTEXT, BANNER_INPUT, BANNER_PILL } from "@/components/ui/banner";
import { ExportButtons } from "@/components/cards/ExportButtons";
import { exportLorebook } from "@/lib/cards/export";

function entryTokens(e: LoreEntry): number {
  return estimateTokens(`${e.key.split(",")[0]?.trim() ?? ""}: ${e.value.trim()}`);
}

export function LorebooksView() {
  const {
    characters, chats,
    lorebooks,
    addLorebook, updateLorebook, deleteLorebook,
    addLoreEntry, updateLoreEntry, deleteLoreEntry,
  } = useFableStore();

  // Track which book is pending delete so the destructive click needs a
  // second, explicit confirmation click.
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Books start collapsed — a handful of worlds with a dozen entries each
  // buries the page otherwise. Open one to edit it.
  // Opened from the Library: start with that book expanded, then scroll to it
  const focusCardId = useUiStore((s) => s.focusCardId);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(focusCardId ? [focusCardId] : []));
  useEffect(() => {
    if (!focusCardId) return;
    document.getElementById(`card-${focusCardId}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
    useUiStore.getState().setFocusCardId(null);
  }, [focusCardId]);
  const toggleBook = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const totalEntries = lorebooks.reduce((n, b) => n + b.entries.length, 0);
  const allOpen = lorebooks.length > 0 && expanded.size === lorebooks.length;

  const handleNewBook = () => {
    // A book you just made is a book you want to fill in — open it
    const id = addLorebook(`Lorebook ${lorebooks.length + 1}`);
    setExpanded((prev) => new Set(prev).add(id));
  };

  const handleNewEntry = (bookId: string) => {
    addLoreEntry(bookId, { key: "", value: "", enabled: true, priority: 5 });
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-[var(--card)]">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-xl font-bold text-[var(--foreground)]">Lorebooks</h1>
            <p className="text-sm text-[var(--muted-fg)] mt-1">
              {lorebooks.length} book{lorebooks.length !== 1 ? "s" : ""} · {totalEntries}{" "}
              entr{totalEntries !== 1 ? "ies" : "y"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {lorebooks.length > 1 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setExpanded(allOpen ? new Set() : new Set(lorebooks.map((b) => b.id)))}
              >
                {allOpen ? "Collapse all" : "Expand all"}
              </Button>
            )}
            <Button variant="purple" size="md" onClick={handleNewBook}>
              <Plus className="h-4 w-4 mr-1.5" />
              New Lorebook
            </Button>
          </div>
        </div>

        <p className="text-xs text-[var(--muted-fg)] mb-6">
          Entries inject into the prompt as <span className="font-medium">[World Lore]</span> whenever
          one of their keywords appears in the recent conversation. Separate multiple keywords with
          commas. Higher priority wins when the {LORE_TOKEN_BUDGET}-token budget runs out.
        </p>

        {/* Books */}
        {lorebooks.length === 0 && (
          <div className="rounded-xl border border-dashed border-[var(--border)] p-10 text-center">
            <BookOpen className="h-6 w-6 text-[var(--muted-fg)] mx-auto mb-2" />
            <div className="text-sm text-[var(--muted-fg)]">
              No lorebooks yet — create one to start building your world.
            </div>
          </div>
        )}

        <div className="space-y-6">
          {lorebooks.map((book) => {
            const enabled = book.entries.filter((e) => e.enabled);
            const tokens = enabled.reduce((sum, e) => sum + entryTokens(e), 0);
            const isOpen = expanded.has(book.id);
            // Collapsed books still need to be identifiable at a glance
            const keyPreview = book.entries
              .map((e) => e.key.split(",")[0]?.trim())
              .filter(Boolean)
              .join(" · ");
            return (
              <Card key={book.id} id={`card-${book.id}`} className={book.banner ? "overflow-hidden" : undefined}>
                <CardHeader
                  className={book.banner ? "relative flex items-center gap-3" : "flex items-center gap-3"}
                  style={book.banner ? bannerStyle(book.banner) : undefined}
                >
                  {/* A fade from the left: the name always sits on dark, whatever the picture */}
                  {book.banner && <BannerFade />}
                  <button
                    onClick={() => toggleBook(book.id)}
                    title={isOpen ? "Collapse lorebook" : "Expand lorebook"}
                    className={`relative flex items-center gap-2 flex-shrink-0 transition-colors cursor-pointer ${book.banner
                      ? "text-white/90 hover:text-white drop-shadow"
                      : "text-[var(--muted-fg)] hover:text-[var(--foreground)]"}`}
                  >
                    {isOpen
                      ? <ChevronDown className="h-4 w-4" />
                      : <ChevronRight className="h-4 w-4" />}
                    <BookOpen className={`h-4 w-4 ${book.banner ? "text-white" : "text-[var(--purple-fg)]"}`} />
                  </button>
                  {isOpen ? (
                    <Input
                      value={book.name}
                      onChange={(e) => updateLorebook(book.id, { name: e.target.value })}
                      className={`relative h-8 text-sm font-medium flex-1 ${book.banner
                        ? BANNER_INPUT
                        : ""}`}
                      placeholder="Lorebook name"
                    />
                  ) : (
                    <button
                      onClick={() => toggleBook(book.id)}
                      className="relative flex-1 min-w-0 text-left cursor-pointer"
                      title="Expand lorebook"
                    >
                      <div className={`text-sm font-medium truncate ${book.banner ? BANNER_TEXT : "text-[var(--foreground)]"}`}>
                        {book.name || <span className={book.banner ? "text-white/80" : "text-[var(--muted-fg)]"}>Untitled lorebook</span>}
                      </div>
                      {keyPreview && (
                        <div className={`text-[11px] truncate ${book.banner ? BANNER_SUBTEXT : "text-[var(--muted-fg)]"}`}>{keyPreview}</div>
                      )}
                    </button>
                  )}
                  {/* On a banner the controls sit on a solid frosted pill, so they read on any picture in either theme */}
                  <div className={`relative flex items-center gap-1.5 flex-shrink-0 ${book.banner
                    ? BANNER_PILL : ""}`}>
                    {/* Hidden on phones so the name keeps its room; the entry count shows when expanded */}
                    <Badge variant="default" className="hidden sm:inline-flex" title="Estimated tokens if every enabled entry fires at once">
                      <Zap className="h-2.5 w-2.5 mr-0.5" />
                      {tokens}t max
                    </Badge>
                    <Badge variant={enabled.length > 0 ? "green" : "default"} className="hidden sm:inline-flex">
                      {enabled.length}/{book.entries.length} on
                    </Badge>
                    <ExportButtons png={false} run={(f) => exportLorebook(book, f)} />
                    {confirmDelete === book.id ? (
                      <>
                      {(() => {
                        const owners = charactersUsingLorebook(characters, book.id);
                        const listed = chatsListingLorebook(chats, book.id);
                        if (owners.length === 0 && listed === 0) return null;
                        const parts = [
                          owners.length > 0 && `the lorebook of ${owners.map((c) => c.name).join(", ")}`,
                          listed > 0 && `listed by ${plural(listed, "chat")}`,
                        ].filter(Boolean);
                        return <span className="text-[11px] text-red-600">It is {parts.join(" and ")}; those links are cleared.</span>;
                      })()}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-red-600 border-red-200"
                        onClick={() => { deleteLorebook(book.id); setConfirmDelete(null); }}
                      >
                        Delete {book.entries.length > 0 ? `${book.entries.length} entries?` : "book?"}
                      </Button>
                      </>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Delete lorebook"
                        onClick={() => setConfirmDelete(book.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </CardHeader>
                {isOpen && (
                <CardBody className="space-y-3">
                  <BannerControl banner={book.banner} onChange={(banner) => updateLorebook(book.id, { banner })} />
                  {book.entries.map((entry) => (
                    <div
                      key={entry.id}
                      className={`rounded-lg border p-3 space-y-2 transition-opacity ${
                        entry.enabled
                          ? "border-[var(--border)]"
                          : "border-[var(--border)] opacity-55"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {/* Enabled toggle */}
                        <button
                          onClick={() => updateLoreEntry(book.id, entry.id, { enabled: !entry.enabled })}
                          title={entry.enabled ? "Disable entry" : "Enable entry"}
                          className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors cursor-pointer ${
                            entry.enabled ? "bg-[var(--purple)]" : "bg-[var(--border)]"
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                              entry.enabled ? "translate-x-4" : ""
                            }`}
                          />
                        </button>
                        <Input
                          value={entry.key}
                          onChange={(e) => updateLoreEntry(book.id, entry.id, { key: e.target.value })}
                          placeholder={entry.constant ? "Label (always injected)" : "Keywords, comma, separated"}
                          className="h-8 text-xs flex-1"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`h-7 w-7 flex-shrink-0 ${entry.constant ? "text-[var(--purple-fg)] bg-[var(--purple-light)]" : ""}`}
                          title={entry.constant ? "Always injected — click to require keywords" : "Inject only when keywords match — click to always inject"}
                          onClick={() => updateLoreEntry(book.id, entry.id, { constant: !entry.constant })}
                        >
                          <Pin className="h-3 w-3" />
                        </Button>
                        <div className="flex items-center gap-1 flex-shrink-0" title="Priority — higher injects first">
                          <span className="text-[10px] text-[var(--muted-fg)]">pri</span>
                          <Input
                            type="number"
                            value={entry.priority ?? 5}
                            onChange={(e) =>
                              updateLoreEntry(book.id, entry.id, { priority: Number(e.target.value) })
                            }
                            className="h-8 w-14 text-xs"
                            min={0}
                            max={100}
                          />
                        </div>
                        <Badge variant="default" className="flex-shrink-0">{entryTokens(entry)}t</Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 flex-shrink-0"
                          title="Delete entry"
                          onClick={() => deleteLoreEntry(book.id, entry.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                      <Textarea
                        value={entry.value}
                        onChange={(e) => updateLoreEntry(book.id, entry.id, { value: e.target.value })}
                        placeholder="What the model should know when these keywords come up…"
                        rows={2}
                        className="text-xs"
                      />
                      <details className="text-[11px] text-[var(--muted-fg)]">
                        <summary className="cursor-pointer select-none hover:text-[var(--foreground)]">
                          More — secondary keys, case, memo
                          {(entry.selective || entry.caseSensitive) && " · set"}
                        </summary>
                        <div className="mt-2 space-y-2">
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox" checked={entry.selective ?? false}
                              onChange={(e) => updateLoreEntry(book.id, entry.id, { selective: e.target.checked })}
                              className="h-3.5 w-3.5 accent-[var(--purple)]"
                            />
                            <span>Also require a secondary keyword</span>
                          </label>
                          {entry.selective && (
                            <Input
                              value={(entry.secondaryKeys ?? []).join(", ")}
                              onChange={(e) => updateLoreEntry(book.id, entry.id, {
                                secondaryKeys: e.target.value.split(",").map((k) => k.trim()).filter(Boolean),
                              })}
                              placeholder="Secondary keywords, comma, separated — one must also appear"
                              className="h-8 text-xs"
                            />
                          )}
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox" checked={entry.caseSensitive ?? false}
                              onChange={(e) => updateLoreEntry(book.id, entry.id, { caseSensitive: e.target.checked })}
                              className="h-3.5 w-3.5 accent-[var(--purple)]"
                            />
                            <span>Case sensitive</span>
                          </label>
                          <Input
                            value={entry.comment ?? ""}
                            onChange={(e) => updateLoreEntry(book.id, entry.id, { comment: e.target.value })}
                            placeholder="Memo — a note for you, never sent to the model"
                            className="h-8 text-xs"
                          />
                        </div>
                      </details>
                    </div>
                  ))}

                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => handleNewEntry(book.id)}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Add entry
                  </Button>
                </CardBody>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
