"use client";

import { useFableStore } from "@/lib/store";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { ChatArea } from "@/components/chat/ChatArea";
import { ChatsView } from "@/components/sections/ChatsView";
import { InspectorPanel } from "@/components/inspector/InspectorPanel";
import { SettingsView } from "@/components/sections/SettingsView";
import { CharactersView } from "@/components/sections/CharactersView";
import { LorebooksView } from "@/components/sections/LorebooksView";
import { ScenariosView } from "@/components/sections/ScenariosView";
import { ImageStudioView } from "@/components/sections/ImageStudioView";
import { GalleryView } from "@/components/sections/GalleryView";
import { WorkflowsView } from "@/components/sections/WorkflowsView";
import { PresetsView } from "@/components/sections/PresetsView";
import { GroupsView } from "@/components/sections/GroupsView";
import { CharacterEditorDialog } from "@/components/characters/CharacterEditorDialog";
import { NewChatDialog } from "@/components/chat/NewChatDialog";
import { StateSync } from "@/components/StateSync";
import { DropImport } from "@/components/DropImport";
import { useHydrated } from "@/lib/hooks/useHydrated";
import { useUiStore } from "@/lib/store/ui";

export default function Home() {
  const { activeChatId, syncReady } = useFableStore();
  const { activeSection } = useUiStore();
  // The persisted store rehydrates from localStorage before React's first
  // client render, so any returning user's state differs from the SSR HTML
  // (which only knows the seeds) — a guaranteed hydration mismatch. This is
  // a local-first app; skip SSR content entirely and render post-mount.
  const hydrated = useHydrated();

  // No open chat means we're browsing the list, which has nothing to inspect
  const showInspector = activeSection === "chats" && !!activeChatId;

  // StateSync stays mounted at ONE position across the gate: it is what sets
  // syncReady, and returning it as a bare early return meant the root element
  // type changed the moment the flag flipped, remounting it and re-running the
  // whole hydrate-or-seed effect — a second GET /api/state and, on an empty
  // server, a second seed PUT.
  const ready = hydrated && syncReady;

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Hydrates from SQLite on load, then mirrors edits back (debounced) */}
      <StateSync />
      {!ready ? null : <>
      <Sidebar />

      <main className="flex flex-1 min-w-0 overflow-hidden">
        {activeSection === "chats" && (activeChatId ? <ChatArea /> : <ChatsView />)}
        {activeSection === "characters" && <CharactersView />}
        {activeSection === "settings" && <SettingsView />}
        {activeSection === "groups" && <GroupsView />}
        {activeSection === "lorebooks" && <LorebooksView />}
        {activeSection === "scenarios" && <ScenariosView />}
        {activeSection === "presets" && <PresetsView />}
        {activeSection === "image-studio" && <ImageStudioView />}
        {activeSection === "gallery" && <GalleryView />}
        {activeSection === "workflows" && <WorkflowsView />}

        {showInspector && <InspectorPanel />}
      </main>

      {/* Global — openable from CharactersView and the inspector */}
      <CharacterEditorDialog />

      {/* New-chat builder — opened by the sidebar's New Chat button */}
      <NewChatDialog />

      {/* Window-wide drag-and-drop for CharacterBinder PNG / JSON cards */}
      <DropImport />
      </>}
    </div>
  );
}
