// ─── Episode and reflection prompts ───────────────────────────────────────────
// What the model is asked for when a scene becomes a memory card: an EPISODE
// (a concrete event, written from the character's side) or, every few of those,
// a REFLECTION — a pattern noticed across events.

export function episodePrompt(
  conversation: string,
  characterName: string,
  userLabel: string,
  entityIds: string[]
): string {
  return `You are the narrative memory of ${characterName}, a roleplay character.
Summarise the scene below as ONE memory ${characterName} will keep — a concrete
event, written from ${characterName}'s perspective, past tense.

Return ONLY valid JSON:
{
  "title": "3-6 word scene title",
  "content": "2-4 sentences. What happened, who did what, and how it felt. Concrete details over generalities.",
  "importance": 0.5,
  "entities": ["ids of entities involved, chosen from the list below"]
}

importance: 0.8-1.0 for confessions, betrayals, rescues, turning points.
0.4-0.7 for meaningful conversations and shared work. 0.1-0.3 for routine travel
and small talk.

KNOWN ENTITY IDS: ${entityIds.slice(0, 40).join(", ") || "(none yet)"}

THE SCENE (${userLabel} is the person ${characterName} is talking to):
${conversation}`;
}

export function reflectPrompt(
  facts: string[],
  episodes: string[],
  characterName: string,
  userLabel: string
): string {
  return `You are ${characterName}, a roleplay character, thinking privately about
${userLabel} and everything that has happened. Below are things you know and
scenes you remember.

Synthesise 1-2 INSIGHTS — patterns or conclusions that are not stated in any
single item but emerge across them. An insight sounds like understanding a
person, not listing facts about them: "She jokes hardest when she's most
afraid", not "she is afraid of water".

Return ONLY valid JSON:
{
  "insights": [
    { "title": "3-5 words", "content": "one or two sentences, first person, as ${characterName}", "importance": 0.7 }
  ]
}
Return {"insights": []} if nothing genuinely emerges. Do not restate facts.

WHAT YOU KNOW:
${facts.map((f) => `- ${f}`).join("\n") || "(nothing)"}

SCENES YOU REMEMBER:
${episodes.map((e) => `- ${e}`).join("\n") || "(none)"}`;
}
