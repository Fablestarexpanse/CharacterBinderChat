// ─── Demo story ───────────────────────────────────────────────────────────────
// What a brand-new install opens with, so the first screen is a story already
// under way instead of an empty app: one character (with a linked lorebook), a
// persona for the player, and a chat a few lines in. The same story the README
// screenshots show, so the docs and the app agree.
//
// Seeded once, by the sync engine, only when the server has never been written
// to AND this tab holds nothing (see startSync). Deleting the demo is permanent:
// an emptied library has a revision above zero, so it is not "first run" again.
// The Library's empty state offers it back on purpose.

import { useFableStore } from "@/lib/store";
import { expandMacros } from "@/lib/cards/tavern";
import type { Character, Chat, Lorebook, Persona, Scenario } from "@/lib/types";

export const DEMO_IDS = {
  character: "demo-ronan",
  persona: "demo-kira",
  lorebook: "demo-lower-kaelen",
  scenario: "demo-last-shuttle",
  chat: "demo-neon-rain",
} as const;

const GREETING =
  "The rain hammers the corrugated roof above us. I lean against the wall of the safehouse, arms crossed, watching " +
  "you with that half-lidded expression I've perfected over a decade of bad deals.\n\n" +
  "\"You're late, {{user}},\" I say. Not an accusation — just a statement of fact. \"The shuttle to the upper levels " +
  "leaves in forty minutes. You want to tell me what kept you, or do we move?\"";

/** The opening exchange after the greeting: [role, text]. Short, so the next line is the user's. */
const OPENING: Array<["user" | "assistant", string]> = [
  ["user", "Sorry — the checkpoint at Sector 7 was locked down. Corporate security sweep. I had to go three levels underground to get around it."],
  ["assistant",
    "A low exhale. I push off the wall and move to the window, peering through a crack in the boards at the alley below.\n\n" +
    "\"Sector 7.\" My jaw tightens. \"That's Kaspar's territory. If they were running a sweep, it means someone's been " +
    "talking.\" I turn back, eyes sharp. \"Anyone follow you down here?\""],
];

export interface DemoStory {
  characters: Character[];
  personas: Persona[];
  lorebooks: Lorebook[];
  scenarios: Scenario[];
  chats: Chat[];
}

/**
 * The demo as plain rows. `userName` is who the greeting addresses: the demo
 * persona's name, or the user's own persona if they already have one.
 */
export function buildDemo(now: Date, userName = "Kira"): DemoStory {
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();
  const iso = at(0);
  const fill = (s: string) => expandMacros(s, { char: "Ronan", user: userName });

  const character: Character = {
    id: DEMO_IDS.character,
    name: "Ronan",
    description:
      "A grizzled mercenary with a sharp wit and a code of honor. Former city guard turned freelance operative in " +
      "the neon-drenched sprawl of Lower Kaelen.",
    personality: "Sarcastic, loyal, world-weary but optimistic underneath the cynicism. Slow to trust, impossible to shake once he does.",
    scenario:
      "A boarded-up safehouse in Lower Kaelen, late at night, forty minutes before the only shuttle to the upper " +
      "levels. Ronan has agreed to get {{user}} onto it.",
    firstMessage: GREETING,
    exampleDialogue:
      "<START>\n{{user}}: Do you ever work for the corps?\n" +
      "{{char}}: *He snorts.* Once. Never again. They pay on time and they lie about everything else.",
    tags: ["demo", "cyberpunk", "mercenary"],
    creatorNotes:
      "The demo character FableChat starts with. Talk to him to see memory form in the inspector; edit or delete him " +
      "whenever you like.",
    lorebookId: DEMO_IDS.lorebook,
    createdAt: iso,
    updatedAt: iso,
  };

  const persona: Persona = {
    id: DEMO_IDS.persona,
    name: "Kira",
    description: "A freelance courier who knows the lower city's back routes. (The demo persona: rename or replace it in Library → Personas.)",
    createdAt: iso,
    updatedAt: iso,
  };

  const lorebook: Lorebook = {
    id: DEMO_IDS.lorebook,
    name: "Lower Kaelen",
    description: "The demo's world: mentioned keywords pull these entries into the prompt.",
    createdAt: iso,
    entries: [
      { id: "demo-lore-kaspar", lorebookId: DEMO_IDS.lorebook, key: "Kaspar, Kaspar Division", enabled: true,
        value: "Kaspar Division is the corporate security force that runs the checkpoints of the lower sectors. Its officers are paid per arrest." },
      { id: "demo-lore-sector7", lorebookId: DEMO_IDS.lorebook, key: "Sector 7, checkpoint, stairwell", enabled: true,
        value: "Sector 7 is a checkpoint district. Its old maintenance stairwells are the only fast way between levels, and everyone who uses them knows someone who got caught there." },
      { id: "demo-lore-shuttle", lorebookId: DEMO_IDS.lorebook, key: "shuttle, upper levels", enabled: true,
        value: "One shuttle a night climbs to the upper levels. Missing it means another day below, and another day for Kaspar to find you." },
    ],
  };

  const scenario: Scenario = {
    id: DEMO_IDS.scenario,
    name: "The last shuttle",
    scenario: "A safehouse in Lower Kaelen, forty minutes before the only shuttle to the upper levels. Someone has leaked the route.",
    firstMessage: "*The power cuts out. In the dark, somewhere below, a stairwell door bangs open.*",
    createdAt: iso,
    updatedAt: iso,
  };

  const lines: Array<["user" | "assistant", string]> = [["assistant", GREETING], ...OPENING];
  const chat: Chat = {
    id: DEMO_IDS.chat,
    name: "Neon Rain (demo)",
    characterId: character.id,
    lorebookIds: [lorebook.id],
    messages: lines.map(([role, content], i) => ({
      id: `${DEMO_IDS.chat}-${i}`,
      chatId: DEMO_IDS.chat,
      role,
      content: fill(content),
      ...(role === "assistant" ? { characterId: character.id } : {}),
      timestamp: at((lines.length - i) * 2),
    })),
    createdAt: at(lines.length * 2 + 1),
    updatedAt: at(0),
    contextUsed: 0,
    contextMax: 8192,
  };

  return { characters: [character], personas: [persona], lorebooks: [lorebook], scenarios: [scenario], chats: [chat] };
}

/**
 * Add the demo to the store, leaving everything already there alone: a row
 * whose id exists is skipped, and an existing active persona stays active
 * (the greeting then addresses that persona). Opens the demo chat.
 * Returns false when the demo is already fully present.
 */
export function addDemoStory(now = new Date()): boolean {
  const s = useFableStore.getState();
  const active = s.personas.find((p) => p.id === s.activePersonaId);
  const demo = buildDemo(now, active?.name ?? "Kira");
  const fresh = <T extends { id: string }>(have: T[], add: T[]) => add.filter((r) => !have.some((h) => h.id === r.id));
  const add = {
    characters: fresh(s.characters, demo.characters),
    personas: active ? [] : fresh(s.personas, demo.personas),
    lorebooks: fresh(s.lorebooks, demo.lorebooks),
    scenarios: fresh(s.scenarios, demo.scenarios),
    chats: fresh(s.chats, demo.chats),
  };
  if (Object.values(add).every((rows) => rows.length === 0)) return false;
  useFableStore.setState({
    characters: [...s.characters, ...add.characters],
    personas: [...s.personas, ...add.personas],
    lorebooks: [...s.lorebooks, ...add.lorebooks],
    scenarios: [...s.scenarios, ...add.scenarios],
    chats: [...add.chats, ...s.chats],
    activePersonaId: s.activePersonaId ?? (add.personas[0]?.id ?? null),
    activeChatId: add.chats[0]?.id ?? DEMO_IDS.chat,
  });
  return true;
}
