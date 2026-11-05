// ─── Line diff ────────────────────────────────────────────────────────────────
// For "what did I change in this prompt?". Plain LCS over lines: prompts are a
// few hundred lines at most, so the quadratic table is a few hundred kB.

export type DiffLine = { kind: "same" | "add" | "del"; text: string };

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length, m = b.length;
  // lcs[i][j] = longest common subsequence of a[i..] and b[j..]
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ kind: "same", text: a[i] }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ kind: "del", text: a[i++] });
    else out.push({ kind: "add", text: b[j++] });
  }
  while (i < n) out.push({ kind: "del", text: a[i++] });
  while (j < m) out.push({ kind: "add", text: b[j++] });
  return out;
}

/** Changed lines with `context` unchanged lines around each change; gaps become null. */
export function diffHunks(lines: DiffLine[], context = 2): Array<DiffLine | null> {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((l, k) => {
    if (l.kind === "same") return;
    for (let x = Math.max(0, k - context); x <= Math.min(lines.length - 1, k + context); x++) keep[x] = true;
  });
  const out: Array<DiffLine | null> = [];
  lines.forEach((l, k) => {
    if (keep[k]) out.push(l);
    else if (out.length > 0 && out[out.length - 1] !== null) out.push(null);
  });
  if (out[out.length - 1] === null) out.pop();
  return out;
}
