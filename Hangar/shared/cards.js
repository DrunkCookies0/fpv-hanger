// Recordings on a card from the goggles or a camera, and which of them a pilot most likely wants.
// Nothing here touches the disk, so it can be tested by itself.

const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** Folders on a card that hold nothing a pilot recorded. */
export const notRecordings = new Set(["system volume information", "$recycle.bin", "lost.dir", "android", "found.000"]);

/** Whether a disk on a Mac is a card, from what `diskutil info -plist` says of it: something that
 *  comes out of its reader. A disk on a cable isn't, nor is a disk image, nor a folder on a network. */
export function isCardOnMac(told) {
  const says = (key, value) => new RegExp(`<key>${key}</key>\\s*${value}`).test(told);
  return says("RemovableMedia", "<true/>") && !says("BusProtocol", "<string>Disk Image</string>");
}

/** The disks Windows calls removable, from lines of a letter, a bar and the disk's name: "E:|GOGGLES".
 *  Each is `{ name, folder }`. */
export function removableOnWindows(lines) {
  const found = [];
  for (const line of String(lines).split(/\r?\n/)) {
    const [, letter, label] = /^\s*([A-Za-z]):\|(.*?)\s*$/.exec(line) ?? [];
    if (letter) found.push({ name: label ? `${label} (${letter.toUpperCase()}:)` : `${letter.toUpperCase()}:`, folder: `${letter.toUpperCase()}:\\` });
  }
  return found.sort((a, b) => a.folder.localeCompare(b.folder));
}

/** The newest first. Goggles don't always know the time, so recordings made at the same moment
 *  go by their names, which count upwards. */
export function newestFirst(recordings) {
  return [...recordings].sort((a, b) => b.modified - a.modified || natural(b.name, a.name));
}

/** A day, as a number that is the same for every moment of it where the pilot is. */
const dayOf = (moment) => {
  const date = new Date(moment);
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
};

/**
 * Says of each recording on a card where the library has it already. `held` gives, for a name in
 * small letters, the recordings of that name in the library, each `{ size, track }`. One with the
 * same name and size is the same recording: `in` is the track it is in, the one being added to
 * when it is in several.
 */
export function marked(recordings, held, track) {
  return recordings.map((recording) => {
    const same = (held.get(recording.name.toLowerCase()) ?? []).filter((one) => one.size === recording.bytes);
    const here = same.find((one) => one.track === track);
    return { ...recording, in: here?.track ?? same[0]?.track ?? null };
  });
}

/** The recordings ticked when a card is first looked at: the ones the library hasn't got, from
 *  the last day anything new was recorded. Gives their paths. */
export function tickedAtFirst(recordings) {
  const fresh = recordings.filter((recording) => recording.in === null);
  if (fresh.length === 0) return [];
  const last = Math.max(...fresh.map((recording) => dayOf(recording.modified)));
  return fresh.filter((recording) => dayOf(recording.modified) === last).map((recording) => recording.path);
}

/** How many of a card's recordings the library hasn't got. */
export const freshOn = (card) => card.recordings.filter((recording) => recording.in === null).length;
