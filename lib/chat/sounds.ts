// ─── Phone sounds ─────────────────────────────────────────────────────────────
// Client-only. A ringtone for an incoming call and a chime for an incoming
// text, made with the Web Audio API, so the app ships no sound files.
// Browsers only let a page make sound after the person has interacted with
// it; until then these stay silent rather than throwing, and the first click
// anywhere unlocks them (`unlockSounds`, called from the components that play).
// Whether to play at all is the Contact & media "Sounds" switch.

type Ctx = AudioContext;
let ctx: Ctx | null = null;

function context(): Ctx | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx ??= new AC();
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return ctx;
}

/** Call from a user gesture (a click) so later sounds are allowed to play. */
export function unlockSounds(): void { context(); }

/** One soft tone: a sine with a quick attack and an exponential fade. */
function tone(c: Ctx, freq: number, start: number, length: number, gain = 0.18) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(g).connect(c.destination);
  osc.start(start);
  osc.stop(start + length + 0.05);
}

/** A text arrived: three rising notes, about half a second. */
export function playTextChime(): void {
  const c = context();
  if (!c || c.state !== "running") return;
  const t = c.currentTime + 0.02;
  tone(c, 1046.5, t, 0.16);        // C6
  tone(c, 1318.5, t + 0.11, 0.16); // E6
  tone(c, 1568.0, t + 0.22, 0.28); // G6
}

/** One ring: a two-tone trill (a phone's warble), about 1.6 seconds. */
function ringOnce(c: Ctx) {
  const t = c.currentTime + 0.02;
  for (let i = 0; i < 16; i++) {
    tone(c, i % 2 ? 1046.5 : 1318.5, t + i * 0.05, 0.06, 0.12);
    tone(c, i % 2 ? 1046.5 : 1318.5, t + 0.95 + i * 0.04, 0.05, 0.12);
  }
}

let ringTimer: ReturnType<typeof setInterval> | null = null;

/** Ring until stopped: a ring every three seconds. Returns the stop function. */
export function startRingtone(): () => void {
  stopRingtone();
  const c = context();
  if (c && c.state === "running") ringOnce(c);
  ringTimer = setInterval(() => {
    const cc = context();
    if (cc && cc.state === "running") ringOnce(cc);
  }, 3000);
  return stopRingtone;
}

export function stopRingtone(): void {
  if (ringTimer) clearInterval(ringTimer);
  ringTimer = null;
}
