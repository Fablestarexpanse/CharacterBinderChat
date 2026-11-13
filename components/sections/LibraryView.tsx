"use client";

// ─── Library ──────────────────────────────────────────────────────────────────
// Every card in one place: characters, personas, lorebooks, scenarios and saved
// first messages (which are not cards, so they are not exported). Search,
// sort, filter by tag, select several, export them as one archive (which imports
// back here or into CharacterBinder), or delete them with a clear account of what
// depends on them. Editing still happens in each kind's own editor; the Library is
// where you find things.

import { useMemo, useRef, useState } from "react";
import {
  BookOpen, Check, CheckSquare, Clapperboard, Download, MessageSquare, MessageSquareQuote, Plus, Search, Square, Trash2, Upload,
  UserCircle2, Users, X,
  Sparkles,
} from "lucide-react";
import { useFableStore } from "@/lib/store";
import { useUiStore } from "@/lib/store/ui";
import { Avatar } from "@/components/ui/avatar";
import { BannerFade, bannerStyle, BANNER_TEXT } from "@/components/ui/banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ExportButtons } from "@/components/cards/ExportButtons";
import { PersonaEditorDialog } from "@/components/characters/PersonaEditorDialog";
import { useStartChat } from "@/components/characters/StartChat";
import { importCardFiles } from "@/lib/import/applyCards";
import { exportArchive, exportCharacter, exportLorebook, exportPersona, exportScenario } from "@/lib/cards/export";
import { PLATFORM_LIST, type PlatformId } from "@/lib/cards/platforms";
import { chatsUsingCharacter, charactersUsingLorebook, plural } from "@/lib/chat/references";
import type { Character } from "@/lib/types";
import { addDemoStory } from "@/lib/demo";

type Tab = "characters" | "personas" | "lorebooks" | "scenarios" | "openers";
type Sort = "updated" | "name" | "created";

/** One row in any tab, so search, sort and selection are written once. */
interface Item {
  id: string;
  name: string;
  detail: string;
  tags: string[];
  avatar?: string;
  created: string;
  updated: string;
  /** Lorebooks and scenarios: a banner strip across the top of the card */
  banner?: string;
}

const TABS: Array<{ id: Tab; label: string; icon: typeof Users }> = [
  { id: "characters", label: "Characters", icon: Users },
  { id: "personas",   label: "Personas",   icon: UserCircle2 },
  { id: "lorebooks",  label: "Lorebooks",  icon: BookOpen },
  { id: "scenarios",  label: "Scenarios",  icon: Clapperboard },
  { id: "openers",    label: "First messages", icon: MessageSquareQuote },
];

const oneLine = (s: string | undefined, n = 140) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export function LibraryView() {
  const store = useFableStore();
  const { characters, personas, lorebooks, scenarios, openers, chats, activePersonaId, setActivePersona } = store;
  const { openCharacterEditor, setActiveSection, setFocusCardId } = useUiStore();

  const [tab, setTab] = useState<Tab>("characters");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("updated");
  const [tag, setTag] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [platform, setPlatform] = useState<PlatformId>("sillytavern");
  const [notice, setNotice] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [personaEditor, setPersonaEditor] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  const fileRef = useRef<HTMLInputElement>(null);
  const { startChat, dialog: startChatDialog } = useStartChat((m) => setNotice({ kind: "error", text: m }));

  // ── Rows for the current tab ──────────────────────────────────────────────
  const items: Item[] = useMemo(() => {
    switch (tab) {
      case "characters": return characters.map((c) => ({ id: c.id, name: c.name, detail: oneLine(c.description), tags: c.tags ?? [], avatar: c.avatar, created: c.createdAt, updated: c.updatedAt }));
      case "personas":   return personas.map((p) => ({ id: p.id, name: p.name, detail: oneLine(p.description), tags: [], avatar: p.avatar, created: p.createdAt, updated: p.updatedAt }));
      case "lorebooks":  return lorebooks.map((b) => ({ id: b.id, name: b.name, detail: `${plural(b.entries.length, "entry", "entries")}${b.description ? ` · ${oneLine(b.description, 80)}` : ""}`, tags: [], banner: b.banner, created: b.createdAt, updated: b.createdAt }));
      case "scenarios":  return scenarios.map((s) => ({ id: s.id, name: s.name, detail: oneLine(s.scenario), tags: [], banner: s.banner, created: s.createdAt, updated: s.updatedAt }));
      case "openers":    return openers.map((o) => ({ id: o.id, name: o.name, detail: oneLine(o.text), tags: [], created: o.createdAt, updated: o.updatedAt }));
    }
  }, [tab, characters, personas, lorebooks, scenarios, openers]);

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of characters) for (const t of c.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12).map(([t]) => t);
  }, [characters]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = (i: Item) => !q || i.name.toLowerCase().includes(q) || i.detail.toLowerCase().includes(q) || i.tags.some((t) => t.toLowerCase().includes(q));
    const rows = items.filter((i) => hit(i) && (!tag || tab !== "characters" || i.tags.includes(tag)));
    const by: Record<Sort, (a: Item, b: Item) => number> = {
      updated: (a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""),
      created: (a, b) => (b.created ?? "").localeCompare(a.created ?? ""),
      name:    (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    };
    return [...rows].sort(by[sort]);
  }, [items, query, tag, tab, sort]);

  // Selection is per tab; switching tabs clears it rather than carrying hidden picks
  const switchTab = (t: Tab) => { setTab(t); setSelected(new Set()); setConfirmDelete(false); setTag(null); };
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const picked = visible.filter((i) => selected.has(i.id));

  // ── Export ────────────────────────────────────────────────────────────────
  const exportSelection = async (ids: Set<string> | "all") => {
    setNotice(null);
    const inSel = <T extends { id: string }>(rows: T[], kind: Tab) =>
      ids === "all" ? rows : kind === tab ? rows.filter((r) => ids.has(r.id)) : [];
    try {
      const r = await exportArchive({
        characters: inSel(characters, "characters"), personas: inSel(personas, "personas"),
        lorebooks: inSel(lorebooks, "lorebooks"), scenarios: inSel(scenarios, "scenarios"),
      }, lorebooks);
      setNotice({ kind: r.skipped.length ? "error" : "info", text: `Exported ${plural(r.count, "card")} as an archive.${r.skipped.length ? ` Skipped: ${r.skipped.join("; ")}.` : ""}` });
    } catch (e) {
      setNotice({ kind: "error", text: `Export failed — ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  const exportOneCharacter = async (c: Character, format: "png" | "json") => {
    setNotice(null);
    try {
      const book = lorebooks.find((b) => b.id === c.lorebookId);
      const { usedAvatar, lossy } = await exportCharacter(c, { format, book, platform });
      const notes: string[] = [];
      if (format === "png" && !usedAvatar) notes.push(`${c.name} has no picture, so the PNG carries a blank image.`);
      if (lossy.length) notes.push(`${PLATFORM_LIST.find((p) => p.id === platform)?.name ?? platform} drops or only partly keeps: ${lossy.join(", ")}.`);
      if (notes.length) setNotice({ kind: "info", text: `Exported ${c.name}. ${notes.join(" ")}` });
    } catch (e) {
      setNotice({ kind: "error", text: `Export failed — ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  /** What deleting the current selection would affect, said before it happens. */
  const deleteConsequences = (): string[] => {
    const out: string[] = [];
    if (tab === "characters") {
      const n = picked.reduce((sum, i) => sum + chatsUsingCharacter(chats, i.id), 0);
      if (n) out.push(`${plural(n, "chat")} use${n === 1 ? "s" : ""} them and will not be able to continue (their memory is kept).`);
    }
    if (tab === "lorebooks") {
      const owners = picked.flatMap((i) => charactersUsingLorebook(characters, i.id).map((c) => c.name));
      if (owners.length) out.push(`Their links on ${owners.join(", ")} are cleared.`);
    }
    if (tab === "personas" && picked.some((i) => i.id === activePersonaId)) out.push("The active persona is among them.");
    return out;
  };

  const deleteSelected = () => {
    const s = useFableStore.getState();
    for (const i of picked) {
      if (tab === "characters") s.deleteCharacter(i.id);
      else if (tab === "personas") s.deletePersona(i.id);
      else if (tab === "lorebooks") s.deleteLorebook(i.id);
      else if (tab === "scenarios") s.deleteScenario(i.id);
      else s.deleteOpener(i.id);
    }
    setNotice({ kind: "info", text: `Deleted ${plural(picked.length, tabLabel.slice(0, -1).toLowerCase())}.` });
    setSelected(new Set()); setConfirmDelete(false); setSelecting(false);
  };

  // ── Import / new ──────────────────────────────────────────────────────────
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    if (files.length === 0) return;
    setNotice(null);
    const results = await importCardFiles(files);
    const failed = results.filter((r) => !r.ok);
    const said = results.filter((r) => r.ok && r.archive).map((r) => `${r.file}: ${r.message}`);
    if (failed.length) setNotice({ kind: "error", text: failed.map((r) => `${r.file}: ${r.message}`).join(" ") });
    else if (said.length) setNotice({ kind: "info", text: said.join(" ") });
  };

  const create = () => {
    if (tab === "characters") openCharacterEditor();
    else if (tab === "personas") setPersonaEditor({ open: true, id: null });
    else { setActiveSection(tab); }
  };

  const openItem = (id: string) => {
    if (tab === "characters") openCharacterEditor(id);
    else if (tab === "personas") setPersonaEditor({ open: true, id });
    else { setFocusCardId(id); setActiveSection(tab); }
  };

  const counts: Record<Tab, number> = { characters: characters.length, personas: personas.length, lorebooks: lorebooks.length, scenarios: scenarios.length, openers: openers.length };
  const total = counts.characters + counts.personas + counts.lorebooks + counts.scenarios;
  const tabLabel = TABS.find((t) => t.id === tab)!.label;

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-[var(--card)]">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h1 className="text-xl font-bold text-[var(--foreground)]">Library</h1>
            <p className="text-sm text-[var(--muted-fg)] mt-1">{plural(total, "card")} — characters, personas, lorebooks and scenarios</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} title="Import PNG/JSON cards or a CharacterBinder/FableChat archive (.zip)">
              <Upload className="h-3.5 w-3.5 mr-1" />Import
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportSelection("all")} disabled={total === 0} title="Every card as one .zip archive">
              <Download className="h-3.5 w-3.5 mr-1" />Export library
            </Button>
            <Button variant="purple" size="sm" onClick={create}>
              <Plus className="h-3.5 w-3.5 mr-1" />New {tabLabel.slice(0, -1).toLowerCase()}
            </Button>
          </div>
          <input ref={fileRef} type="file" multiple accept=".json,.png,.zip,application/json,image/png,application/zip" className="hidden" onChange={handleImport} />
        </div>

        {/* Tabs */}
        <div role="tablist" className="flex gap-1 border-b border-[var(--border)] mb-4 overflow-x-auto">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id} role="tab" aria-selected={tab === id} onClick={() => switchTab(id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px cursor-pointer whitespace-nowrap transition-colors ${
                tab === id ? "border-[var(--purple)] text-[var(--purple-fg)] font-medium" : "border-transparent text-[var(--muted-fg)] hover:text-[var(--foreground)]"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />{label}
              <span className="text-[10px] rounded-full bg-[var(--muted)] px-1.5">{counts[id]}</span>
            </button>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="relative flex-1 min-w-[12rem]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-fg)]" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${tabLabel.toLowerCase()}…`} className="h-8 pl-8 text-xs" aria-label="Search" />
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort"
            className="h-8 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 text-xs text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--purple)]">
            <option value="updated">Recently changed</option>
            <option value="created">Recently added</option>
            <option value="name">Name</option>
          </select>
          {tab === "characters" && (
            <select value={platform} onChange={(e) => setPlatform(e.target.value as PlatformId)} aria-label="Export cards for" title="Which site single-card exports are written for"
              className="h-8 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 text-xs text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--purple)]">
              {PLATFORM_LIST.map((p) => <option key={p.id} value={p.id}>Export for {p.name}</option>)}
            </select>
          )}
          <Button variant={selecting ? "subtle" : "outline"} size="sm" className="h-8" onClick={() => { setSelecting((v) => !v); setSelected(new Set()); setConfirmDelete(false); }}>
            {selecting ? <><X className="h-3.5 w-3.5 mr-1" />Done</> : <><CheckSquare className="h-3.5 w-3.5 mr-1" />Select</>}
          </Button>
        </div>

        {tab === "characters" && allTags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3" aria-label="Filter by tag">
            {allTags.map((t) => (
              <button key={t} onClick={() => setTag(tag === t ? null : t)} aria-pressed={tag === t}
                className={`rounded-full px-2 py-0.5 text-[11px] cursor-pointer border transition-colors ${
                  tag === t ? "bg-[var(--purple)] text-white border-[var(--purple)]" : "border-[var(--border)] text-[var(--muted-fg)] hover:text-[var(--foreground)]"
                }`}>{t}</button>
            ))}
          </div>
        )}

        {/* Selection bar */}
        {selecting && (
          <div className="flex flex-wrap items-center gap-2 mb-3 rounded-lg bg-[var(--muted)] px-3 py-2 text-xs">
            <button className="underline cursor-pointer text-[var(--foreground)]" onClick={() => setSelected(new Set(visible.map((i) => i.id)))}>Select all {visible.length}</button>
            <span className="text-[var(--muted-fg)]">{picked.length} selected</span>
            <div className="flex-1" />
            {tab !== "openers" && (
              <Button variant="outline" size="sm" disabled={picked.length === 0} onClick={() => exportSelection(new Set(picked.map((i) => i.id)))}>
                <Download className="h-3 w-3 mr-1" />Export {picked.length || ""} as .zip
              </Button>
            )}
            <Button variant="outline" size="sm" className="text-red-600 border-red-200" disabled={picked.length === 0} onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-3 w-3 mr-1" />Delete…
            </Button>
          </div>
        )}
        {confirmDelete && picked.length > 0 && (
          <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 space-y-2">
            <div><strong>Delete {plural(picked.length, tabLabel.slice(0, -1).toLowerCase())}</strong> ({picked.slice(0, 5).map((i) => i.name).join(", ")}{picked.length > 5 ? "…" : ""})?</div>
            {deleteConsequences().map((c) => <div key={c}>{c}</div>)}
            <div className="text-red-600/80">This cannot be undone from here. Take a backup first if you might want them back.</div>
            <div className="flex gap-2">
              <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white" onClick={deleteSelected}>Delete</Button>
              <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {notice && (
          <div role="status" className={`mb-3 rounded-lg border px-3 py-2 text-xs flex items-start gap-2 ${
            notice.kind === "error" ? "border-red-200 bg-red-50 text-red-600" : "border-amber-200 bg-amber-50 text-amber-800"
          }`}>
            <span className="flex-1">{notice.text}</span>
            <button onClick={() => setNotice(null)} aria-label="Dismiss" className="cursor-pointer"><X className="h-3.5 w-3.5" /></button>
          </div>
        )}

        {/* Rows */}
        {items.length === 0 ? (
          <Card className="p-8 border-dashed text-center">
            <div className="text-sm text-[var(--muted-fg)]">No {tabLabel.toLowerCase()} yet.</div>
            <div className="text-xs text-[var(--muted-fg)] mt-1">
              Create one, or import PNG/JSON cards or a CharacterBinder archive — or drop files anywhere in the window.
            </div>
            {tab === "characters" && (
              <Button variant="outline" size="sm" className="mt-3" onClick={() => { addDemoStory(); setActiveSection("chats"); }}
                title="June and Elias in Port Ellery, two personas, a lorebook and a chat a few lines in">
                <Sparkles className="h-3.5 w-3.5 mr-1" />Add the demo story
              </Button>
            )}
          </Card>
        ) : visible.length === 0 ? (
          <div className="text-sm text-[var(--muted-fg)] py-6 text-center">Nothing matches{query ? ` “${query}”` : ""}{tag ? ` with the tag “${tag}”` : ""}.</div>
        ) : (
          <div role="list" aria-label={tabLabel} className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {visible.map((i) => {
              const isSel = selected.has(i.id);
              const character = tab === "characters" ? characters.find((c) => c.id === i.id) : undefined;
              const persona = tab === "personas" ? personas.find((p) => p.id === i.id) : undefined;
              return (
                <Card key={i.id} role="listitem" aria-label={i.name} className={`p-3 transition-colors ${i.banner ? "overflow-hidden" : ""} ${isSel ? "border-[var(--purple)] bg-[var(--purple-light)]" : "hover:border-[var(--purple)]"}`}>
                  {/* The same banner as on its own screen, as a strip across the top with the name on the fade */}
                  {i.banner && (
                    <button className="relative -mx-3 -mt-3 mb-2.5 flex items-center px-3 text-left cursor-pointer" style={{ ...bannerStyle(i.banner, "3rem"), width: "calc(100% + 1.5rem)" }}
                      onClick={() => (selecting ? toggle(i.id) : openItem(i.id))} aria-label={`Open ${i.name}`}>
                      <BannerFade />
                      <span className={`relative truncate font-semibold text-sm ${BANNER_TEXT}`}>{i.name}</span>
                    </button>
                  )}
                  <div className="flex items-start gap-3">
                    {selecting && (
                      <button onClick={() => toggle(i.id)} aria-pressed={isSel} aria-label={`Select ${i.name}`} className="mt-1 cursor-pointer text-[var(--purple-fg)]">
                        {isSel ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4 text-[var(--muted-fg)]" />}
                      </button>
                    )}
                    {(tab === "characters" || tab === "personas") && <Avatar name={i.name} src={i.avatar} size="md" />}
                    <button className="flex-1 min-w-0 text-left cursor-pointer" onClick={() => (selecting ? toggle(i.id) : openItem(i.id))}>
                      <div className={`flex items-center gap-1.5 ${i.banner ? "sr-only" : ""}`}>
                        <span className="font-semibold text-sm text-[var(--foreground)] truncate">{i.name}</span>
                        {persona && persona.id === activePersonaId && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-[var(--purple-fg)] border border-[var(--purple)] rounded-full px-1.5"><Check className="h-2.5 w-2.5" />Active</span>
                        )}
                      </div>
                      {i.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">{i.tags.slice(0, 3).map((t) => <Badge key={t} variant="purple">{t}</Badge>)}</div>
                      )}
                      <p className="text-xs text-[var(--muted-fg)] line-clamp-2 mt-1">{i.detail || <em>No description</em>}</p>
                    </button>
                  </div>
                  {!selecting && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {character && (
                        <>
                          <Button variant="purple" size="sm" onClick={() => startChat(character.id)}><MessageSquare className="h-3 w-3 mr-1" />Chat</Button>
                          <Button variant="outline" size="sm" onClick={() => openCharacterEditor(character.id)}>Edit</Button>
                          <ExportButtons run={(f) => exportOneCharacter(character, f)} />
                        </>
                      )}
                      {persona && (
                        <>
                          <Button variant="outline" size="sm" onClick={() => setActivePersona(persona.id === activePersonaId ? null : persona.id)}>
                            {persona.id === activePersonaId ? "Deactivate" : "Use as me"}
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setPersonaEditor({ open: true, id: persona.id })}>Edit</Button>
                          <ExportButtons run={(f) => exportPersona(persona, f)} />
                        </>
                      )}
                      {tab === "lorebooks" && (
                        <>
                          <Button variant="outline" size="sm" onClick={() => openItem(i.id)}>Edit</Button>
                          <ExportButtons png={false} run={(f) => exportLorebook(lorebooks.find((b) => b.id === i.id)!, f)} />
                        </>
                      )}
                      {tab === "openers" && (
                        <Button variant="outline" size="sm" onClick={() => openItem(i.id)}>Edit</Button>
                      )}
                      {tab === "scenarios" && (
                        <>
                          <Button variant="outline" size="sm" onClick={() => openItem(i.id)}>Edit</Button>
                          <ExportButtons png={false} run={(f) => exportScenario(scenarios.find((s) => s.id === i.id)!, f)} />
                        </>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}

        <PersonaEditorDialog open={personaEditor.open} personaId={personaEditor.id} onClose={() => setPersonaEditor({ open: false, id: null })} />
        {startChatDialog}
      </div>
    </div>
  );
}
