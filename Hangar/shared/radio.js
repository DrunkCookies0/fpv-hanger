// A radio's own SD card, as it shows on a computer when the radio is plugged in with USB Storage
// (SD) chosen on it, and the backups the app keeps of it. EdgeTX keeps all of a radio's models and
// settings on that card, in RADIO and MODELS, beside its themes, widgets, scripts and sounds.
// Nothing here touches the disk, so it can be tested by itself.

/** What a radio's settings, RADIO/radio.yml, say of it: its board as EdgeTX names it ("tx15"), and
 *  the version of EdgeTX that last wrote them. Either is "" when they don't say. */
export function radioFacts(text) {
  const value = (key) => new RegExp(`^${key}:[ \\t]*["']?([^"'\\r\\n]*?)["']?[ \\t]*$`, "m").exec(String(text ?? ""))?.[1] ?? "";
  const board = value("board"), version = value("semver");
  return { board: /^[a-z0-9]{1,20}$/i.test(board) ? board.toLowerCase() : "", version: /^\d+(\.\d+){1,3}$/.test(version) ? version : "" };
}

/** What a radio is called in the app and in its backups' names: its board in capitals, "TX15". */
export const radioName = (board) => (board ? board.toUpperCase() : "Radio");

const two = (number) => String(number).padStart(2, "0");

/** A backup's folder name, in the computer's own time: "TX15 SD card 2026-10-25 22.40.03". */
export function backupName(board, at) {
  return `${radioName(board)} SD card ${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}.${two(at.getMinutes())}.${two(at.getSeconds())}`;
}

/** Names on a card that are the computer's, not the radio's: what a Mac or Windows puts there. */
export const notTheRadios = (name) => name.startsWith(".") || ["system volume information", "$recycle.bin"].includes(name.toLowerCase());

/** The order a folder's names are copied in. At the top of the card, the radio's settings and
 *  models come first, so that they are kept even if the radio is pulled out part way. */
export function copyOrder(names, top) {
  const first = top ? ["RADIO", "MODELS"] : [];
  const rank = (name) => {
    const at = first.indexOf(name.toUpperCase());
    return at < 0 ? first.length : at;
  };
  return names.filter((name) => !notTheRadios(name)).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

/** Whether a file on the card is the same as its copy in the last backup: as long, and changed at
 *  the same time. A card keeps times to two seconds. */
export const unchanged = (file, copy) => Boolean(file && copy) && file.size === copy.size && Math.abs(file.mtimeMs - copy.mtimeMs) < 2000;

/** Whether a backup found anything to keep: a file copied, or a file there before that isn't now. */
export const somethingChanged = (copied, files, before) => copied > 0 || before === null || files !== before;
