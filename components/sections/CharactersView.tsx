"use client";

import { useFableStore } from "@/lib/store";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Plus, MessageSquare } from "lucide-react";

export function CharactersView() {
  const { characters, createChat, setActiveChatId } = useFableStore();

  const handleStartChat = (characterId: string) => {
    const chatId = createChat(characterId);
    setActiveChatId(chatId);
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-white">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-[var(--foreground)]">Characters</h1>
            <p className="text-sm text-[var(--muted-fg)] mt-1">
              {characters.length} characters available
            </p>
          </div>
          <Button variant="purple" size="md">
            <Plus className="h-4 w-4 mr-1.5" />
            New Character
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {characters.map((char) => (
            <Card key={char.id} className="p-4 hover:border-[var(--purple)] transition-colors">
              <div className="flex items-start gap-3">
                <Avatar name={char.name} src={char.avatar} size="md" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-[var(--foreground)]">{char.name}</div>
                  <div className="flex flex-wrap gap-1 mt-1 mb-2">
                    {char.tags.slice(0, 3).map((tag) => (
                      <Badge key={tag} variant="purple">{tag}</Badge>
                    ))}
                  </div>
                  <p className="text-xs text-[var(--muted-fg)] line-clamp-2">{char.description}</p>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="purple"
                  size="sm"
                  className="flex-1"
                  onClick={() => handleStartChat(char.id)}
                >
                  <MessageSquare className="h-3 w-3 mr-1.5" />
                  Chat
                </Button>
                <Button variant="outline" size="sm">Edit</Button>
              </div>
            </Card>
          ))}

          {/* Empty card to add new */}
          <Card className="p-4 border-dashed flex items-center justify-center cursor-pointer hover:border-[var(--purple)] hover:bg-[var(--purple-light)] transition-colors min-h-[120px]">
            <div className="text-center">
              <Plus className="h-6 w-6 text-[var(--muted-fg)] mx-auto mb-1" />
              <div className="text-sm text-[var(--muted-fg)]">Import character</div>
              <div className="text-xs text-[var(--muted-fg)]">or create from scratch</div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
