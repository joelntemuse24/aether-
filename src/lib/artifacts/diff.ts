export type DiffLine = {
  type: "same" | "add" | "del";
  text: string;
};

/** Basic line diff (LCS) for text artifact versions. */
export function diffText(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  if (a.length === 1 && a[0] === "" && b.length === 1 && b[0] === "") return [];
  if (a.length === 1 && a[0] === "") {
    return b.filter((line) => line !== "" || b.length === 1).map((text) => ({
      type: "add" as const,
      text,
    }));
  }
  const table = lcsTable(a, b);
  return backtrack(a, b, table);
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function lcsTable(a: string[], b: string[]): number[][] {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const t: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      t[i]![j] =
        a[i - 1] === b[j - 1]
          ? (t[i - 1]![j - 1] ?? 0) + 1
          : Math.max(t[i - 1]![j] ?? 0, t[i]![j - 1] ?? 0);
    }
  }
  return t;
}

function backtrack(a: string[], b: string[], t: number[][]): DiffLine[] {
  const out: DiffLine[] = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      out.push({ type: "same", text: a[i - 1]! });
      i -= 1;
      j -= 1;
    } else if ((t[i - 1]![j] ?? 0) >= (t[i]![j - 1] ?? 0)) {
      out.push({ type: "del", text: a[i - 1]! });
      i -= 1;
    } else {
      out.push({ type: "add", text: b[j - 1]! });
      j -= 1;
    }
  }
  while (i > 0) {
    out.push({ type: "del", text: a[i - 1]! });
    i -= 1;
  }
  while (j > 0) {
    out.push({ type: "add", text: b[j - 1]! });
    j -= 1;
  }
  return out.reverse().filter((line, idx, all) => {
    if (line.text !== "") return true;
    // Drop the trailing empty line that split("\n") adds on a final newline,
    // but keep a lone empty add when the previous text was empty.
    return all.length === 1;
  });
}
