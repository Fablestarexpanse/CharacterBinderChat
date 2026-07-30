"use client";

import { useFableStore } from "@/lib/store";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { ChatArea } from "@/components/chat/ChatArea";
import { InspectorPanel } from "@/components/inspector/InspectorPanel";
import { SettingsView } from "@/components/sections/SettingsView";
import { CharactersView } from "@/components/sections/CharactersView";
import { LorebooksView } from "@/components/sections/LorebooksView";
import { CharacterEditorDialog } from "@/components/characters/CharacterEditorDialog";
import { StateSync } from "@/components/StateSync";
import { PlaceholderView } from "@/components/sections/PlaceholderView";
import {
  Group,
  Sliders,
  ImageIcon,
  GalleryHorizontal,
  GitBranch,
  Puzzle,
} from "lucide-react";

export default function Home() {
  const { activeSection } = useFableStore();

  const showInspector = activeSection === "chats";

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar />

      <main className="flex flex-1 min-w-0 overflow-hidden">
        {activeSection === "chats" && <ChatArea />}
        {activeSection === "characters" && <CharactersView />}
        {activeSection === "settings" && <SettingsView />}
        {activeSection === "groups" && (
          <PlaceholderView
            icon={Group}
            title="Groups"
            description="Multi-character chats with shared context and turn-taking."
          />
        )}
        {activeSection === "lorebooks" && <LorebooksView />}
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

      {/* Hydrates from SQLite on load, then mirrors edits back (debounced) */}
      <StateSync />
    </div>
  );
}
