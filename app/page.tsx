"use client";

import { useFableStore } from "@/lib/store";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { ChatArea } from "@/components/chat/ChatArea";
import { InspectorPanel } from "@/components/inspector/InspectorPanel";
import { SettingsView } from "@/components/sections/SettingsView";
import { CharactersView } from "@/components/sections/CharactersView";
import { LorebooksView } from "@/components/sections/LorebooksView";
import { ScenariosView } from "@/components/sections/ScenariosView";
import { GroupsView } from "@/components/sections/GroupsView";
import { CharacterEditorDialog } from "@/components/characters/CharacterEditorDialog";
import { NewChatDialog } from "@/components/chat/NewChatDialog";
import { StateSync } from "@/components/StateSync";
import { DropImport } from "@/components/DropImport";
import { PlaceholderView } from "@/components/sections/PlaceholderView";
import { useHydrated } from "@/lib/hooks/useHydrated";
import {
  Sliders,
  ImageIcon,
  GalleryHorizontal,
  GitBranch,
  Puzzle,
} from "lucide-react";

export default function Home() {
  const { activeSection } = useFableStore();
  // The persisted store rehydrates from localStorage before React's first
  // client render, so any returning user's state differs from the SSR HTML
  // (which only knows the seeds) — a guaranteed hydration mismatch. This is
  // a local-first app; skip SSR content entirely and render post-mount.
  const hydrated = useHydrated();

  const showInspector = activeSection === "chats";

  if (!hydrated) return null;

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar />

      <main className="flex flex-1 min-w-0 overflow-hidden">
        {activeSection === "chats" && <ChatArea />}
        {activeSection === "characters" && <CharactersView />}
        {activeSection === "settings" && <SettingsView />}
        {activeSection === "groups" && <GroupsView />}
        {activeSection === "lorebooks" && <LorebooksView />}
        {activeSection === "scenarios" && <ScenariosView />}
        {activeSection === "presets" && (
          <PlaceholderView
            icon={Sliders}
            title="Presets"
            description="Save and load generation parameter presets."
          />
        )}
        {activeSection === "image-studio" && (
          <PlaceholderView
            icon={ImageIcon}
            title="Image Studio"
            description="Full-screen image generation with ComfyUI workflows."
          />
        )}
        {activeSection === "gallery" && (
          <PlaceholderView
            icon={GalleryHorizontal}
            title="Gallery"
            description="Browse all generated images from your sessions."
          />
        )}
        {activeSection === "workflows" && (
          <PlaceholderView
            icon={GitBranch}
            title="Workflows"
            description="Manage and edit ComfyUI workflow templates."
          />
        )}
        {activeSection === "extensions" && (
          <PlaceholderView
            icon={Puzzle}
            title="Extensions"
            description="Install community extensions and plugins."
          />
        )}

        {showInspector && <InspectorPanel />}
      </main>

      {/* Global — openable from CharactersView and the inspector */}
      <CharacterEditorDialog />

      {/* New-chat builder — opened by the sidebar's New Chat button */}
      <NewChatDialog />

      {/* Hydrates from SQLite on load, then mirrors edits back (debounced) */}
      <StateSync />

      {/* Window-wide drag-and-drop for CharacterBinder PNG / JSON cards */}
      <DropImport />
    </div>
  );
}
