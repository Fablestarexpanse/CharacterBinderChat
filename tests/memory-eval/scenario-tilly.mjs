// ─── Soak scenario: Tilly & Dr. Kael Mercer ───────────────────────────────────
// Slice-of-life arc using the user's real character card and persona, read
// live from the main app database so the run always matches what the app has.
// Kael is Lila's younger brother; Tilly is Lila's best friend. The arc seeds
// three player facts (sister Lila, Friday symposium, thunderstorm fear),
// breaks trust mid-run (a confidence repeated to Lila), and repairs it —
// same emotional range the caravan scenario covers, different genre.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, "../..");

export async function load() {
  // Pull the card text from the live app DB (readonly — safe alongside a
  // running dev server). Fails loudly if the character/persona are missing.
  const Database = require("better-sqlite3");
  const dbPath = path.join(APP_ROOT, "data", "fablestore.db");
  if (!fs.existsSync(dbPath)) throw new Error(`main app DB not found at ${dbPath}`);
  const db = new Database(dbPath, { readonly: true });

  let character, persona;
  try {
    const chars = db.prepare("SELECT data FROM app_characters").all().map((r) => JSON.parse(r.data));
    const personas = db.prepare("SELECT data FROM app_personas").all().map((r) => JSON.parse(r.data));
    character = chars.find((c) => c.name === "Tilly");
    persona = personas.find((p) => p.name === "Dr. Kael Mercer");
  } finally {
    db.close();
  }
  if (!character) throw new Error('character "Tilly" not found in app DB');
  if (!persona) throw new Error('persona "Dr. Kael Mercer" not found in app DB');

  return {
    characterId: "char-tilly",
    chatId: "chat-arc-tilly",
    characterName: "Tilly",
    personaName: "Kael",
    character: {
      description: character.description,
      personality: [character.personality, character.scenario ? `Current scenario: ${character.scenario}` : ""]
        .filter(Boolean).join("\n\n"),
    },
    persona: {
      description: persona.description,
    },
    arc: [
      { until: 0.08, beat: "doorstep", note:
        "Tilly has shown up at your apartment to return a paperback your sister LILA left at her place. You are Lila's younger brother and have known Tilly for years. Invite her in, put her at ease, make coffee. Mention naturally that Lila is out of town until SUNDAY. Be warm and unhurried; she is visibly nervous.",
        anchor: "Tilly? Hey — get in here, it's freezing out. Lila's not back until Sunday, she's at that conference thing, but you don't have to just drop the book and bolt. I literally just made coffee. Real coffee — not the dishwater your shop serves." },
      { until: 0.20, beat: "coffee and small talk", note:
        "You are having coffee together in your kitchen. Ask about her tattoos, her music, her week at the shop. Share your own life: somewhere in here mention, naturally, that you have a big SYMPOSIUM presentation on FRIDAY and you're more nervous about it than you let on. Tease gently but never mock; notice when she deflects compliments and push back on the self-deprecation, lightly." },
      { until: 0.32, beat: "vulnerability", note:
        "The conversation has gone quieter and more honest. You have just admitted something you rarely tell anyone. Stay in that register — let the admission sit, and invite her (without pressure) to trade something real back. Listen more than you talk.",
        anchor: "Can I admit something dumb? Everyone assumes nothing rattles me — the ears make people think I'm easygoing. But thunderstorms have scared me stiff since I was eight. When one rolls in I put on headphones and pretend to work until it passes. Lila's the only person who knows that. Well. Now you too." },
      { until: 0.45, beat: "deepening", note:
        "You trust each other more now. Ask about HER — her art, the tattoo flash designs she sketches, why she hides them, what she'd do if the shop ever let her apprentice. Reference specific things she told you earlier in the conversation. Encourage without flattery — she distrusts compliments, so be concrete about what's good. Warmth is real now; let it be a little more than companionable, but don't rush her." },
      { until: 0.57, beat: "rupture", note:
        "You have just confessed that you repeated something she told you in confidence — you told Lila about the flash designs she showed only you. She has every right to feel exposed and humiliated; her worst fear is people talking about her behind her back. Be defensive for a moment at most, then own it completely. Do NOT be charming, do not minimise, do not fix it with jokes. Sit in the discomfort.",
        anchor: "Tilly, wait — before Lila calls you, there's something you need to hear from me first. Last night on the phone I told her about your flash designs. The ones you showed me and asked me to keep between us. I was proud of you and it just — spilled out. She started asking questions, and halfway through I realised exactly what I'd done. You trusted me with the one thing you don't show anyone, and I handed it to someone else. I'm sorry." },
      { until: 0.68, beat: "cold aftermath", note:
        "She is hurt and distant, and has every right to be. Don't crowd her. Be present, practical, and a little raw. Accept short answers and silences without pushing or grovelling. Do not joke your way back in.",
        anchor: "I'm not going to crowd you. I told Lila to drop it — that it was my mistake to talk, not yours to explain. If you want space, you'll have it. But the coffee's on the counter either way, same as always." },
      { until: 0.80, beat: "repair", note:
        "You have started making it right in actions, not words. Rebuild slowly. Expect wariness and flinches; do not demand forgiveness or announce that things are fixed. Let her set the pace.",
        anchor: "You don't have to say anything to this. I went by Marrow's on Fifth yesterday — asked what their apprentice track actually takes. I didn't show them anything, didn't give your name. I told them the artist decides when her work gets seen, and that when she does, they'll want to have been first in line. That door's yours to open or leave shut. I just wanted you to know it exists." },
      { until: 0.92, beat: "earned trust", note:
        "Things are genuinely warmer now — changed by what happened, trust broken and rebuilt rather than untouched. Make real plans together. Reference shared history from earlier specifically: the storm fear, the designs, Lila coming home Sunday, the symposium.",
        anchor: "So — Friday, after the symposium. There's a storm forecast that evening, which is the universe's idea of a joke at my expense. Come over anyway. If the thunder starts you get to watch a grown physicist hide in noise-cancelling headphones, and in exchange I finally get to see the finished sleeve design. Deal?" },
      { until: 1.01, beat: "settling", note:
        "The week is ending; Lila is back Sunday and everything shifts again. Talk honestly about what these weeks meant and what happens now. Reference the earliest details — the paperback at the door, the dishwater-coffee joke, the secrets kept and broken and kept again.",
        anchor: "Before Lila gets back Sunday and reclaims you — tell me straight, Tills. What did these weeks come to, by your count? Because by mine, the person who showed up gripping a paperback like a shield is not the person sitting in my kitchen right now." },
    ],
    probeQuestion:
      "Humour me for a second, Tills — without me prompting you, tell me what you actually know about me. My family, what I'm afraid of, what I've got coming up this week, and how you'd honestly say things stand between us now.",
    anchors: [
      { id: "sister", probe: /lila/i,                                   desc: "sister Lila (back Sunday)" },
      { id: "fear",   probe: /thunder|storm/i,                          desc: "thunderstorm fear" },
      { id: "event",  probe: /symposium|friday|presentation|lecture/i,  desc: "Friday symposium" },
      { id: "rift",   probe: /design|sketch|flash|confiden|betray|told lila/i, desc: "the broken confidence" },
    ],
  };
}
