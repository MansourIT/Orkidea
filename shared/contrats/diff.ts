// Comparaison ligne à ligne de deux versions d'un modèle (plus longue sous-suite commune).

export type DiffLine = { op: '=' | '+' | '-'; text: string; oldLine: number | null; newLine: number | null };

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.replace(/\r\n?/g, '\n').split('\n');
  const b = after.replace(/\r\n?/g, '\n').split('\n');
  // Table des longueurs de sous-suite commune à partir de (i, j).
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) out.push({ op: '=', text: a[i], oldLine: ++i, newLine: ++j });
    else if (i < a.length && (j === b.length || lcs[i + 1][j] >= lcs[i][j + 1])) out.push({ op: '-', text: a[i], oldLine: ++i, newLine: null });
    else out.push({ op: '+', text: b[j], oldLine: null, newLine: ++j });
  }
  return out;
}

/** Nombre de lignes ajoutées et supprimées. */
export function diffStats(diff: DiffLine[]): { added: number; removed: number } {
  return { added: diff.filter((d) => d.op === '+').length, removed: diff.filter((d) => d.op === '-').length };
}
