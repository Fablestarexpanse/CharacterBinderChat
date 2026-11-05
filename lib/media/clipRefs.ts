// ─── Who is in a clip, for H3's reference mode ────────────────────────────────
// A clip made with a reference workflow (MiniMax H3 Ref2VA) is given pictures:
// <Picture 1> is the photo it starts from, and each person in the scene (the
// character who sent it, your persona, anyone else present in a group) gets the
// next picture and a <Subject N> label, so their faces hold through the clip.
// The labels follow MiniMax's full-reference prompt format (subject_definitions,
// retention_analysis, ...). Pure, so the test can check the numbering.

/** Pictures a reference workflow takes: the photo plus up to three people. */
export const CLIP_PICTURES = 4;

export interface ClipPerson { name: string; picture: string }

/** The people to pass, in order: the sender first, each once, only those with a picture. */
export function clipPeople(people: Array<{ name?: string; picture?: string } | undefined>, max = CLIP_PICTURES - 1): ClipPerson[] {
  const out: ClipPerson[] = [];
  for (const p of people) {
    if (!p?.name || !p.picture || out.some((o) => o.picture === p.picture || o.name === p.name)) continue;
    out.push({ name: p.name, picture: p.picture });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The reference lines for the prompt. Picture 1 is the photo; person k is
 * <Subject k> from <Picture k+1>.
 */
export function referenceLines(people: ClipPerson[]): { subjects: string; retention: string; names: string } {
  const subjects = [
    "<Picture 1> is the first frame of [Shot 1]: the photo this clip starts from.",
    ...people.map((p, i) => `<Subject ${i + 1}> is ${p.name}, whose face, hair, build and clothing come from <Picture ${i + 2}>.`),
  ].join("\n");
  const retention = [
    "<Picture 1> ([Shot 1] first frame): fully_preserved - the clip opens exactly on this photo.",
    ...people.map((_p, i) => `<Subject ${i + 1}> (wherever they appear): fully_preserved - identity, face and build stay as in <Picture ${i + 2}>; appears only where the action brings them in.`),
  ].join("\n");
  const names = people.map((p, i) => `${p.name} (<Subject ${i + 1}>)`).join(", ");
  return { subjects, retention, names: names || "the people in the photo" };
}

/** A workflow that takes tagged references rather than only a first frame. */
export const isReferenceWorkflow = (classTypes: string[]) => classTypes.some((c) => /ReferenceToVideo$/.test(c));
