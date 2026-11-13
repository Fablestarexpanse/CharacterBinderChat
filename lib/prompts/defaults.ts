// ─── The prompts FableChat sends, as editable templates ───────────────────────
// One entry per prompt: what it is for, its shipped text, and the variables the
// code fills in. Settings → Prompts lets a user override any of them; the
// override lives on the server (lib/server/prompts.ts) and is used everywhere
// the prompt is built.
//
// The default templates were taken mechanically from the builders they replace,
// and tests/unit/prompts.test.mjs checks they still render byte for byte what
// those builders produced (fixtures/prompt-defaults.json). Change a default only
// together with that fixture, and run `npm run eval:gate` for the memory ones.
//
// The chat prompt itself is not here: it is assembled from the character card,
// presets and global instructions, which are already edited in the Library and
// under Presets.

export type PromptId =
  | "memory.extraction"
  | "memory.core-rewrite"
  | "memory.episode"
  | "memory.reflection"
  | "image.scene-director"
  | "image.scene-request"
  | "chat.text-message"
  | "chat.photo-offer"
  | "chat.outreach"
  | "chat.phone-call"
  | "chat.call-outreach"
  | "image.photo"
  | "image.describe"
  | "image.look-from-text"
  | "image.portrait"
  | "image.comic-script"
  | "video.clip"
  | "video.reference-clip";

export interface PromptVariable {
  name: string;
  description: string;
  /** Leaving it out is refused: the prompt has nothing to work on without it */
  required?: boolean;
  /** What the Settings preview fills in when no chat is open */
  sample: string;
}

export interface PromptDef {
  id: PromptId;
  title: string;
  group: "Chat" | "Memory" | "Images";
  /** One line: when the app sends it */
  usedFor: string;
  /** Shown above the editor when set: what a bad edit breaks */
  warning?: string;
  template: string;
  variables: PromptVariable[];
}

const MEMORY_WARNING =
  "This prompt writes the memory. It must still ask for the same JSON shape, or replies fail to parse and nothing is " +
  "remembered for that turn (the failure is reported, never hidden). Check a few turns in Memory after editing.";

const conversationVar = (sample: string): PromptVariable => ({
  name: "conversation", required: true, sample,
  description: "The recent messages, one per paragraph, each starting with the speaker's name.",
});
const characterNameVar: PromptVariable = { name: "character_name", description: "The character's name.", sample: "Ronan" };
const userLabelVar: PromptVariable = { name: "user_label", description: "Your persona's name (\"User\" without one).", sample: "Kira" };

export const PROMPTS: readonly PromptDef[] = [
  {
    id: "chat.text-message",
    title: "Replying by text message",
    group: "Chat",
    usedFor: "Added to the chat prompt when you send a message as a text: tells the character to answer the way they would text.",
    template: `[Texting]
{{character_name}} and {{user_label}} are not together right now: this exchange is by phone text message. Reply as {{character_name}} would text: short and in their own voice, a few lines at most. No narration of actions or surroundings and no *asterisks*, only what they would type. Never repeat or quote {{user_label}}'s message, and never start with a label like (by text).`,
    variables: [characterNameVar, userLabelVar],
  },
  {
    id: "chat.outreach",
    title: "Reaching out",
    group: "Chat",
    usedFor: "When a character you allowed to contact you sends a message on their own (Settings → Contact & media).",
    template: `({{user_label}} has not written for {{silence}}{{user_note}}. {{character_name}} decides to text them now, on their own, because {{reason}}. Write only that text: short, in their own voice, no narration.)`,
    variables: [
      characterNameVar, userLabelVar,
      { name: "silence", description: "How long since you last wrote, in words.", sample: "3 hours" },
      { name: "reason", required: true, description: "Why they are reaching out, from the story or the time of day.", sample: "of the promise they made you: get you onto the shuttle" },
      { name: "user_note", description: "Your status note, with its lead-in (\" (they said: at work until six)\"), or empty.", sample: " (they said: at work until six)" },
    ],
  },
  {
    id: "chat.phone-call",
    title: "Talking on the phone",
    group: "Chat",
    usedFor: "Added to the chat prompt during a phone call (the call screen): tells the character to answer as they would speak on the phone.",
    template: `[Phone call]
{{character_name}} and {{user_label}} are talking on the phone right now. Reply only with what {{character_name}} says out loud: natural spoken words, fairly short, the way people talk on a call. No narration, no actions and no *asterisks*; a laugh or a sigh can be written as a word ("ha", "mm").`,
    variables: [characterNameVar, userLabelVar],
  },
  {
    id: "chat.call-outreach",
    title: "Calling you",
    group: "Chat",
    usedFor: "When a character you allowed to call you rings on their own and you answer: the first thing they say.",
    template: `({{user_label}} has not written for {{silence}}{{user_note}}. {{character_name}} phoned them, on their own, because {{reason}}, and {{user_label}} has just picked up. Write only what {{character_name}} says first: spoken words, short, in their own voice, no narration.)`,
    variables: [
      characterNameVar, userLabelVar,
      { name: "silence", description: "How long since you last wrote, in words.", sample: "3 hours" },
      { name: "reason", required: true, description: "Why they are calling, from the story.", sample: "trust broke between you and they want to say something" },
      { name: "user_note", description: "Your status note, with its lead-in, or empty.", sample: " (they said: at work until six)" },
    ],
  },
  {
    id: "chat.photo-offer",
    title: "Offering to send a photo",
    group: "Chat",
    usedFor: "Added to the chat prompt only for a character you allowed to send photos (and only while Contact & media is on).",
    template: `[Photos]
{{character_name}} can send {{user_label}} a photo of themselves when it genuinely fits the moment: write it on its own line as [photo: what the photo shows]. At most one per reply, and only when {{character_name}} would actually send one.`,
    variables: [characterNameVar, userLabelVar],
  },
  {
    id: "image.photo",
    title: "Photo message picture",
    group: "Images",
    usedFor: "Turns what a photo message shows into the image prompt. The character's image tags are added in front of it.",
    template: `{{what}}, candid phone photo, natural light, realistic`,
    variables: [
      { name: "what", required: true, description: "What the photo shows: the character's [photo: …] words, or what you asked for.", sample: "standing by the boarded window, rain outside" },
    ],
  },
  {
    id: "image.describe",
    title: "Describing a picture",
    group: "Images",
    usedFor: "When you send a picture in a chat: the picture reader (Settings → Chat models) describes it once, and the character reads that description.",
    template: `{{user_label}} just sent {{character_name}} this picture. Describe what it shows in one or two plain sentences: who or what is in it, what they are doing, the setting and anything notable (text, mood, time of day). Do not guess anyone's name and do not address anyone. Answer with the description only.`,
    variables: [characterNameVar, userLabelVar],
  },
  {
    id: "image.look-from-text",
    title: "Image tags from a description",
    group: "Images",
    usedFor: "The Fill from description button in a character's or persona's look: turns what they wrote into image tags. Runs on the memory model.",
    warning: "The reply must still be JSON with \"tags\" and \"undressed\", or the button reports that it could not read the answer.",
    template: `/no_think
Read this description of {{name}} and write image-generation tags for how {{name}} looks.

DESCRIPTION:
{{text}}

Answer with JSON only, no other text:
{"tags": "...", "undressed": "..."}

"tags": 8 to 20 short, comma-separated tags for an image model: apparent age (an adult), gender, build, height if given,
skin, face, eyes, hair (colour, length, style), distinguishing marks, and their usual clothing and accessories.
"undressed": the same tags with every clothing and accessory word left out (body, face and hair stay), for pictures where
they are undressed: no clothes, no jewellery, no glasses, no accessories. Only the person: never a place, a room,
a view, the weather or objects around them. Use only what the description says or clearly implies; never add a name,
a personality trait or anything that is not visible on the person.`,
    variables: [
      { name: "name", required: true, description: "The character's or persona's name.", sample: "June Okafor" },
      { name: "text", required: true, description: "What they wrote: description, personality and anything else in the editor.", sample: "June Okafor, 31, hosts The Night Shift. Tall, close-cropped natural hair, round tortoiseshell glasses, a vintage cardigan over band T-shirts." },
    ],
  },
  {
    id: "image.portrait",
    title: "Portrait picture",
    group: "Images",
    usedFor: "The Generate button next to a portrait: the picture prompt. Their image tags are added in front of it.",
    template: `head and shoulders portrait, looking at the camera, soft natural light, plain softly blurred background, realistic photo, sharp focus`,
    variables: [],
  },
  {
    id: "image.comic-script",
    title: "Comic page script",
    group: "Images",
    usedFor: "Comic-it: turns the chat since the last comic page into panels, speech balloons and narration. Runs on the memory model; FableChat lays the panels out and MOSS-Image draws the page.",
    warning: "The reply must still be JSON with a \"panels\" array of { shot, characters, balloons: [{ speaker, text }], caption }, or the page cannot be made.",
    template: `/no_think
You are a comic-book writer. Turn this stretch of a roleplay into ONE comic page of 3 to {{max_panels}} panels that tells
what happened, in order. {{recap}}

PEOPLE (use these names exactly):
{{people}}

STORY SO FAR ON THIS PAGE:
{{excerpt}}

Answer with JSON only:
{"title": "a short page title", "setting": "where and when, in a few words",
 "panels": [{"shot": "what the camera sees: framing, who is where, action, expression",
             "characters": ["names in the panel"],
             "balloons": [{"speaker": "name", "text": "what they say"}],
             "caption": "optional narration, or empty"}]}

Rules: pick the moments that matter; a panel shows one moment. Balloons are words a person says out loud, inside
quotation marks in the story, at most 2 per panel and at most 12 words each, taken from or close to what was really
said. Narration and description ("The ON AIR light hums red") are never a balloon: put them in the caption, or leave
them to the picture. Never put actions, *asterisks* or (directions) in a balloon. People only talking on the phone are
in different places: show each where they are. Use a caption only to bridge time or place. Describe people by what they do, not how they look (their looks
are added for you).`,
    variables: [
      { name: "max_panels", required: true, description: "The most panels a page may have.", sample: "6" },
      { name: "recap", description: "What the previous comic page covered, so this one continues it; empty for the first page.", sample: "The previous page ended with June putting Nora's call on air." },
      { name: "people", required: true, description: "Who can appear, one per line.", sample: "June Okafor (character)\nNora Vale (you)" },
      { name: "excerpt", required: true, description: "The messages since the last page, each starting with the speaker.", sample: "June: It's twenty past two and you're on the air.\n\nNora: Hi. It's Nora." },
    ],
  },
  {
    id: "video.clip",
    title: "Clip from a photo",
    group: "Images",
    usedFor: "Turns a photo into a short clip with sound (MiniMax H3 or another image-to-video workflow). The photo is the first frame, so this says what happens, not what it looks like.",
    template: `{{motion}}

One continuous handheld shot with no cuts; the camera stays close and steady. Sound: the natural ambience of the place and the small sounds of their movement. No music, no text on screen.`,
    variables: [
      { name: "motion", required: true, description: "What happens in the clip: how they move, what they do, how it ends. You can change it before the clip is made.", sample: "She glances up from the phone, breathes out a laugh and pushes her wet hair back" },
    ],
  },
  {
    id: "video.reference-clip",
    title: "Clip with everyone's look",
    group: "Images",
    usedFor: "A clip made with a reference workflow (MiniMax H3 Ref2VA): the photo is <Picture 1> and each person in the scene (the character, your persona, others present) is a <Subject> from their own picture, so faces hold. Follows MiniMax's full-reference prompt format.",
    template: `subject_definitions:
{{subjects}}

summary:
[keyframe completion + reference generation] A short handheld clip that opens on <Picture 1> and keeps the look of {{people}}: {{motion}}

retention_analysis:
{{retention}}

detailed_description:
Realistic, natural-light handheld phone footage, about five seconds, one continuous shot with no cuts.
[Shot 1] The clip opens exactly on <Picture 1>. {{motion}}. The camera stays close and steady, with small natural handheld movement. Faces and clothing stay consistent with their pictures throughout.

overall_soundscape:
The natural ambience of the place and the small sounds of their movement.

non_diegetic_music:
None.`,
    variables: [
      { name: "motion", required: true, description: "What happens in the clip: how they move, what they do, how it ends. You can change it before the clip is made.", sample: "He looks up from the phone, breathes out a tired half-smile and pushes off the wall" },
      { name: "subjects", required: true, description: "Filled in by the app: one line per picture, <Picture 1> the photo and <Subject N> each person from <Picture N+1>.", sample: "<Picture 1> is the first frame of [Shot 1]: the photo this clip starts from.\n<Subject 1> is Ronan, whose face, hair, build and clothing come from <Picture 2>." },
      { name: "retention", description: "Filled in by the app: how each picture is kept.", sample: "<Subject 1> (wherever they appear): fully_preserved - identity stays as in <Picture 2>." },
      { name: "people", description: "Filled in by the app: the people and their labels.", sample: "Ronan (<Subject 1>)" },
    ],
  },
  {
    id: "memory.extraction",
    title: "Memory extraction",
    group: "Memory",
    usedFor: "After each reply: pulls entities, facts, feelings, promises and running jokes out of the last messages.",
    warning: MEMORY_WARNING,
    template: `You are a memory extraction assistant for a roleplay story. Extract structured information from the conversation below.

Return ONLY valid JSON. No markdown, no explanation, just the JSON object.

{
  "entities": [
    { "id": "snake_case_id", "type": "character|place|object|faction|concept", "name": "Display Name", "description": "Brief description" }
  ],
  "facts": [
    { "subject": "entity_id", "predicate": "lives_at", "object": "entity_id or literal string", "confidence": 0.9, "importance": 0.8 }
  ],
  "stat_changes": [
    { "observer": "entity_id", "target": "entity_id", "stat": "affection|trust|desire|connection", "delta": 5 }
  ],
  "commitments": [
    { "promisor": "entity_id", "promisee": "entity_id", "description": "what was promised, concretely, with any deadline" }
  ],
  "resolved_commitments": [
    { "match": "distinctive words from the earlier promise", "status": "fulfilled|broken" }
  ],
  "shared_language": [
    { "kind": "nickname|joke|ritual|phrase", "text": "the running bit, in a few words" }
  ],
  "story_time": "current in-fiction time as a short phrase, or null"
}

IMPORTANCE (0.0-1.0) — how much this fact matters to the story and relationship,
independent of how certain it is:
- 0.8-1.0: identity, kinship, fears, promises, betrayals, deaths, debts
- 0.4-0.7: occupations, homes, standing relationships, significant possessions
- 0.1-0.3: scenery, passing objects, small talk detail
Do NOT create entities for incidental props, weather, or abstractions
(cobblestones, darkness, a coin pouch). An entity must be something the story
could return to.

COMMITMENTS — capture promises, oaths, debts and deadlines as commitments, not
just facts. When a conversation shows an earlier promise being kept or broken,
emit a resolved_commitments entry instead of a new commitment.
Commitments are for stakes the story could hold someone to. Playful banter,
running jokes, teasing "deals" and pet rituals are NOT commitments — put those
in shared_language instead.

SHARED_LANGUAGE — nicknames, running jokes, little rituals, and pet phrases
these two have between them (a standing coffee order, a recurring bit, a name
only one of them uses). Emit each once, briefly; re-emit only if it appears
again in this excerpt.

STORY_TIME — the story's current in-fiction time, as a short phrase, whenever
the conversation states or clearly implies it ("Thursday evening", "the
morning after the storm", "an hour before the symposium"). null if unclear.

PREDICATE VOCABULARY — for these relationship kinds you MUST use the exact predicate
shown, never a synonym:
- where someone lives or resides   -> "lives_at"
- where something is located       -> "located_at"
- where someone works              -> "works_at"
- an entity's current place/base   -> "current_location"
- an entity's status or state      -> "status"
- identity ("X is Y")              -> "is"
For any OTHER relationship (knows, distrusts, owns, fears, promised, etc.) use a short
free-form snake_case predicate. Do NOT invent synonyms for the six above — write
"lives_at", never "resides at" / "is staying at" / "calls home" / "based out of".

FEW-SHOT EXAMPLES (assuming the character's id is "{{character_id}}"):
Turn 1 — "I live in the lower city safehouse."
  -> { "subject": "{{character_id}}", "predicate": "lives_at", "object": "lower city safehouse" }
Turn 2 — "I moved to Kaelen yesterday."
  -> { "subject": "{{character_id}}", "predicate": "lives_at", "object": "kaelen" }
(Same predicate "lives_at" both times, and the SAME subject id as the roster
gives — the new fact supersedes the old one.)

Rules:
- Only include entities actually mentioned or clearly implied
- Facts should be concrete statements: X knows Y, X lives_at Y, X distrusts Y
- Use a predicate only for what it means: works_at only for a job or a workplace
  (walking or spending time somewhere is frequents), lives_at only for a person or
  an animal (a show, a business or a group is located_at)
- stat_changes are for MEANINGFUL emotional shifts only. Most exchanges warrant
  NO stat change — ordinary pleasant conversation, small talk, and routine
  cooperation are all "stat_changes": []. Reserve deltas for moments that would
  genuinely move how someone feels: a confession, a sacrifice, a betrayal, a
  rescue, a gift, a wound. Magnitude: ±3-8 for notable moments, ±10-20 for major
  ones, beyond that only for story-defining events.
- Stats track what happened BETWEEN these two people, never the scene's
  atmosphere. A storm, an eerie street, danger from third parties, or a dark
  mood in the prose is NOT a relationship change — if neither person did
  anything to the other, emit no delta, however ominous the scene feels.
- stat_changes track how {{character_name}} feels, so use observer
  "{{character_id}}" and target "{{user_id}}". Only use the
  reverse direction for a stat that is explicitly about the other person's feelings.{{group_stat_rule}}
- For an entity NOT already listed above, mint a new snake_case id from its name
  (e.g. "kaspar_division", "sector_7"). Never mint one for an entity that is
  already listed — reuse its id verbatim.
- If nothing meaningful to extract, return {"entities":[],"facts":[],"stat_changes":[]}

{{participant_ids}}{{known_entities}}Conversation to analyze:
{{conversation}}`,
    variables: [
      characterNameVar,
      { name: "character_id", description: "The character's id in the memory, e.g. char-ronan.", sample: "char-ronan" },
      { name: "user_id", description: "Your id in the memory (usually player).", sample: "player" },
      { name: "group_stat_rule", description: "In a group scene, the extra line allowing feelings between any two people present; empty otherwise.", sample: "" },
      { name: "participant_ids", description: "The block listing everyone's fixed ids, so the model reuses them instead of inventing new ones.", sample: "PARTICIPANT IDS — these entities already exist. …\n- char-ronan = Ronan (the character speaking)\n- player = Kira (the person they are talking to)\n\n" },
      { name: "known_entities", description: "The block listing entities already in the memory (up to 40), or empty.", sample: "EXISTING ENTITIES — reuse these exact ids …\n- kaspar (faction) \"Kaspar Division\"\n\n" },
      conversationVar("Ronan: You're late.\n\nKira: The checkpoint was locked down."),
    ],
  },
  {
    id: "memory.core-rewrite",
    title: "Core memory rewrite",
    group: "Memory",
    usedFor: "After replies: rewrites the character's mood, self-image, unspoken thoughts and the story so far.",
    warning: MEMORY_WARNING,
    template: `You are helping maintain a character's "Core Memory Block" — their conscious internal state for a roleplay story.

Character: {{character_name}}
{{character_anchor}}

CURRENT STATE:
Persona: {{persona}}
Mood: valence={{mood_valence}}, arousal={{mood_arousal}}, dominance={{mood_dominance}}
Narrative: {{narrative_summary}}

RECENT CONVERSATION:
{{conversation}}

Based on the conversation above, update the Core Memory Block. Return ONLY valid JSON with these exact keys:

{
  "persona": "Updated one-paragraph first-person self-description reflecting any growth/change",
  "mood": {
    "valence": <number -1 to 1>,
    "arousal": <number 0 to 1>,
    "dominance": <number 0 to 1>
  },
  "internal_thoughts": ["thought 1", "thought 2", "thought 3"],
  "narrative_summary": "2-3 sentence summary of what has happened in the story so far",
  "persona_changed": <true|false>
}

Rules:
- Only change persona if something significant happened that would alter the character's sense of self
- Mood should reflect the emotional arc of the recent conversation. Values near
  the extremes (±1.0 valence, 1.0 arousal) represent once-in-a-story peaks —
  ordinary good or bad scenes belong in the middle of the range.
- Internal thoughts are unspoken — feelings, suspicions, desires the character wouldn't say aloud
- Narrative summary accumulates; include prior events AND what just happened
- Return ONLY the JSON. No explanation.`,
    variables: [
      characterNameVar,
      { name: "character_anchor", description: "The character's authored definition, so the self-image grows without drifting; empty if the card has none.", sample: "\nWHO THIS CHARACTER FUNDAMENTALLY IS (fixed — persona may grow from this, never contradict it):\nA grizzled mercenary.\n" },
      { name: "persona", description: "Their current self-description.", sample: "A mercenary who trusts slowly." },
      { name: "mood_valence", description: "Current mood, negative to positive (-1 to 1).", sample: "0.1" },
      { name: "mood_arousal", description: "Current mood, calm to excited (0 to 1).", sample: "0.3" },
      { name: "mood_dominance", description: "Current mood, yielding to in control (0 to 1).", sample: "0.5" },
      { name: "narrative_summary", description: "The story so far, as currently remembered.", sample: "The story is just beginning." },
      conversationVar("Kira: Sorry I'm late.\n\nRonan: Anyone follow you?"),
    ],
  },
  {
    id: "memory.episode",
    title: "Scene memory",
    group: "Memory",
    usedFor: "When a scene ends: writes it up as one memory the character keeps.",
    warning: MEMORY_WARNING,
    template: `You are the narrative memory of {{character_name}}, a roleplay character.
Summarise the scene below as ONE memory {{character_name}} will keep — a concrete
event, written from {{character_name}}'s perspective, past tense.

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

KNOWN ENTITY IDS: {{known_entity_ids}}

THE SCENE ({{user_label}} is the person {{character_name}} is talking to):
{{conversation}}`,
    variables: [
      characterNameVar,
      userLabelVar,
      { name: "known_entity_ids", description: "Ids of entities in the memory, comma-separated, or (none yet).", sample: "char-ronan, player, kaspar" },
      conversationVar("Kira: They had my route.\n\nRonan: Then we don't take the stairwell."),
    ],
  },
  {
    id: "memory.reflection",
    title: "Reflection",
    group: "Memory",
    usedFor: "Every few scenes: asks the character what patterns they have noticed about you.",
    warning: MEMORY_WARNING,
    template: `You are {{character_name}}, a roleplay character, thinking privately about
{{user_label}} and everything that has happened. Below are things you know and
scenes you remember.

Synthesise 1-2 INSIGHTS — patterns or conclusions that are not stated in any
single item but emerge across them. An insight sounds like understanding a
person, not listing facts about them: "She jokes hardest when she's most
afraid", not "she is afraid of water".

Return ONLY valid JSON:
{
  "insights": [
    { "title": "3-5 words", "content": "one or two sentences, first person, as {{character_name}}", "importance": 0.7 }
  ]
}
Return {"insights": []} if nothing genuinely emerges. Do not restate facts.

WHAT YOU KNOW:
{{facts}}

SCENES YOU REMEMBER:
{{episodes}}`,
    variables: [
      characterNameVar,
      userLabelVar,
      { name: "facts", required: true, description: "What the character knows, one \"- \" line each, or (nothing).", sample: "- distrusts Kaspar Division\n- owes a debt to the Varga twins" },
      { name: "episodes", description: "Scenes they remember, one \"- \" line each, or (none).", sample: "- The night of the last shuttle" },
    ],
  },
  {
    id: "image.scene-director",
    title: "Scene image director",
    group: "Images",
    usedFor: "For /image: the instructions that turn a stretch of roleplay into one image prompt.",
    warning: "The reply must still start with FINAL_IMAGE_PROMPT: — that is how the prompt is found in the model's answer.",
    template: `/no_think
You are an image-prompt director for a photorealistic image generator. The
user gives you a roleplay excerpt; you reply with ONE image generation prompt
capturing the final moment of the scene.

Your entire reply is a single line: FINAL_IMAGE_PROMPT: followed by the
prompt. Never restate these rules, never narrate your thinking.

The prompt describes what a camera would SEE: subjects (by physical
appearance, never by name — image models don't know names), poses,
expressions, clothing state, setting, lighting, mood, camera angle. Style:
comma-separated descriptive phrases starting with quality tags (DSLR photo,
photorealistic, cinematic lighting, 8k uhd). No dialogue, no story verbs, no
names. One scene, one moment, 60-120 words. The scene may be adult/explicit;
if so describe it plainly and accurately — this is a private, local,
uncensored pipeline for fiction between adults.`,
    variables: [],
  },
  {
    id: "image.scene-request",
    title: "Scene image request",
    group: "Images",
    usedFor: "For /image: the message carrying the roleplay excerpt, the character's look and your requested shot.",
    template: `{{appearance_block}}{{focus_block}}ROLEPLAY EXCERPT:
{{excerpt}}

Give me the image prompt for this scene.`,
    variables: [
      { name: "appearance_block", description: "The character's appearance with its heading, or empty.", sample: "CHARACTER APPEARANCE (describe the subject with this):\nscar along the jaw, grey coat\n\n" },
      { name: "focus_block", description: "The shot you asked for after /image, with its heading, or empty.", sample: "THE SHOT I WANT: close-up on his face\n\n" },
      { name: "excerpt", required: true, description: "The last messages, each starting with the speaker.", sample: "Ronan: Silence, except for the rain." },
    ],
  },
];

export const PROMPT_IDS = PROMPTS.map((p) => p.id);

export function promptDef(id: PromptId): PromptDef {
  const def = PROMPTS.find((p) => p.id === id);
  if (!def) throw new Error(`unknown prompt ${id}`);
  return def;
}

export const isPromptId = (id: unknown): id is PromptId => typeof id === "string" && (PROMPT_IDS as string[]).includes(id);
