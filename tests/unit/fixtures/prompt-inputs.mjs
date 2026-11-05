// Fixed inputs for every prompt builder. prompt-defaults.json holds what each
// builder produced for these BEFORE the prompts became editable templates; the
// prompts test checks the shipped defaults still produce exactly that.
export const extraction = [
  { name: "one-to-one with roster", input: {
    messages: [{ role: "assistant", content: "You're late." }, { role: "user", content: "Checkpoint was locked down." }],
    characterName: "Ronan", characterId: "char-ronan", userLabel: "Kira", userId: "player",
    knownEntities: [{ id: "kaspar", name: "Kaspar Division", type: "faction" }],
    participants: [{ id: "char-ronan", name: "Ronan" }, { id: "player", name: "Kira" }] } },
  { name: "group, no roster", input: {
    messages: [{ role: "assistant", content: "Hold the door.", speaker: "Ronan" }, { role: "assistant", content: "On it.", speaker: "Fenna" }],
    characterName: "Ronan", characterId: "char-ronan", userLabel: "Kira", userId: "player",
    knownEntities: [],
    participants: [{ id: "char-ronan", name: "Ronan" }, { id: "player", name: "Kira" }, { id: "char-fenna", name: "Fenna" }] } },
];
export const rewrite = [
  { name: "with anchor", args: ["Ronan",
    { persona: "A mercenary.", mood: { valence: 0.1, arousal: 0.3, dominance: 0.5 }, narrative_summary: "It began." },
    [{ role: "user", content: "Hi." }, { role: "assistant", content: "Late." }], "Kira", "Former city guard."] },
  { name: "no anchor, default user", args: ["Ronan",
    { persona: "P.", mood: { valence: 0, arousal: 0, dominance: 0 }, narrative_summary: "N." },
    [{ role: "user", content: "Hi." }]] },
];
export const episode = [
  { name: "with entities", args: ["Kira: hi\n\nRonan: late", "Ronan", "Kira", ["char-ronan", "player"]] },
  { name: "no entities", args: ["x", "Ronan", "Kira", []] },
];
export const reflect = [
  { name: "facts and episodes", args: [["distrusts Kaspar"], ["The shuttle night"], "Ronan", "Kira"] },
  { name: "empty", args: [[], [], "Ronan", "Kira"] },
];
export const director = [
  { name: "appearance and focus", input: { messages: [{ role: "assistant", content: "Rain.", speaker: "Ronan" }], focus: "close-up", appearance: "scar on jaw", ollamaBaseUrl: "", modelId: "" } },
  { name: "bare", input: { messages: [{ role: "user", content: "Look." }], ollamaBaseUrl: "", modelId: "" } },
];
