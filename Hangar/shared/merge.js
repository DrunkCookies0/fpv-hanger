// Putting together what two computers saved. One library can be opened on two computers at once
// when it is kept in Google Drive, and each saves the files that hold what the app remembers
// (dashboard.json and the like) whole. So before a computer saves one of them, it looks at what is
// in the file now. If the other computer has saved since this one read it, the two are put
// together here: what this computer changed, and what the other one changed.
//
// It works from three versions of a file: what this computer read (`base`), what it holds now
// (`ours`), and what is in the file now (`theirs`). Nothing here touches the disk.

const isPlain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** True when two values read from JSON are the same. The order of a thing's names doesn't count. */
export function same(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((value, index) => same(value, b[index]));
  if (isPlain(a)) {
    if (!isPlain(b)) return false;
    const names = Object.keys(a);
    return names.length === Object.keys(b).length && names.every((name) => Object.hasOwn(b, name) && same(a[name], b[name]));
  }
  return false;
}

/**
 * What to save. Where only one side changed something, that change is kept; where both changed
 * the same thing differently, this computer's is kept, since it is what the pilot has just done
 * here. A thing's names are gone through one by one, all the way down, so two computers changing
 * different runs, different tracks or different answers each keep theirs. A list counts as one
 * thing. `undefined` stands for not being there: a name one side removed and the other left
 * alone is removed.
 */
export function merge(base, ours, theirs) {
  if (same(ours, theirs) || same(theirs, base)) return ours;
  if (same(ours, base)) return theirs;
  if (!isPlain(ours) || !isPlain(theirs)) return ours;
  const from = isPlain(base) ? base : {};
  const result = {};
  for (const name of new Set([...Object.keys(ours), ...Object.keys(theirs), ...Object.keys(from)])) {
    const value = merge(from[name], ours[name], theirs[name]);
    if (value !== undefined) result[name] = value;
  }
  return result;
}
