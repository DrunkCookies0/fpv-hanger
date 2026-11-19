// The Whoop Garage's index: the pilot's whoops, the blackbox logs kept, and each flight in them with
// the whoop and the pack it was flown on. It lives in the library's hangar.json beside the
// batteries; each log's file and everything worked out from it live in a folder of their own in
// the library (main/garage.js). Nothing here touches a page or a file, so it can be tested by itself.
//
//   whoops   { id, name, uid, craft, board, firmware, added }: uid is the flight controller's own
//            number, which is how a log is known to be from a whoop already in the Garage
//   logs     { id, file, size, savedAt, keptAt }: id is the start of the file's SHA-256
//   flights  { id, log, index, powerUp, whoop, pack, what, savedAt, keptAt, firmware, summary }:
//            one arm of a log; pack is the id of the pack in Batteries (its name is the number
//            written on it), or null when not known

export function garageDefaults(found) {
  const object = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
  const garage = object(found);
  return { whoops: { ...object(garage.whoops) }, logs: { ...object(garage.logs) }, flights: { ...object(garage.flights) } };
}

/** The whoop in the Garage a log's header is from, by its flight controller's number. */
export function matchWhoop(garage, whoop) {
  if (!whoop?.uid) return null;
  return Object.values(garage.whoops).find((one) => one.uid === whoop.uid)?.id ?? null;
}

/** A name for a whoop new to the Garage: its craft name, unless another whoop has it. */
export function newWhoopName(garage, whoop) {
  const taken = new Set(Object.values(garage.whoops).map((one) => one.name.toLowerCase()));
  const craft = String(whoop?.craft ?? "").trim();
  if (craft && !taken.has(craft.toLowerCase())) return craft;
  for (let n = 1; ; n += 1) if (!taken.has(`whoop ${n}`)) return `Whoop ${n}`;
}

/** The pack a file's name says, when it has one three-digit number that is the name of one of the
 *  pilot's packs ("practice2-014.BBL" is pack 014). `packs` are `{ id, name }`; gives the
 *  pack's id, or null. */
export function packGuess(fileName, packs) {
  const byName = new Map(packs.filter((pack) => !pack.retired).map((pack) => [String(pack.name).trim(), pack.id]));
  const found = [...String(fileName ?? "").replace(/\.[^.]+$/, "").matchAll(/(?<!\d)(\d{3})(?!\d)/g)].map((m) => m[1]).filter((name) => byName.has(name));
  return new Set(found).size === 1 ? byName.get(found[0]) : null;
}

const flightId = (log, index) => `${log}-${index}`;

/**
 * The Garage with a log kept: `log` is `{ id, file, size, savedAt }`, and `powerUps` each
 * `{ whoop, pack, what, logs }`, where `whoop` is the id of one in the Garage or
 * `{ id, name, uid, craft, board, firmware }` for a new one, and `logs` the arms kept from that
 * power-up, `{ index, firmware, summary }`. Keeping a log again replaces what was kept of it.
 */
export function keepLog(found, { log, powerUps }, now = new Date().toISOString()) {
  const garage = forgetLog(found, log.id);
  garage.logs[log.id] = { id: log.id, file: log.file, size: log.size, savedAt: log.savedAt ?? null, keptAt: now };
  powerUps.forEach((part, number) => {
    let whoop = typeof part.whoop === "string" ? part.whoop : null;
    if (part.whoop && typeof part.whoop === "object") {
      const fresh = part.whoop;
      whoop = fresh.id;
      garage.whoops[whoop] = {
        id: whoop, name: String(fresh.name ?? "").trim() || newWhoopName(garage, fresh), uid: fresh.uid ?? null,
        craft: fresh.craft ?? null, board: fresh.board ?? null, firmware: fresh.firmware ?? null, added: now,
      };
    }
    if (!whoop || !garage.whoops[whoop]) throw new Error("A power-up has no whoop.");
    for (const arm of part.logs) {
      const id = flightId(log.id, arm.index);
      garage.flights[id] = {
        id, log: log.id, index: arm.index, powerUp: number, whoop, pack: part.pack || null, what: String(part.what ?? "").trim(),
        savedAt: log.savedAt ?? null, keptAt: now, firmware: arm.firmware ?? null, summary: arm.summary ?? null,
      };
    }
    // The whoop's firmware as its newest log says.
    const firmware = part.logs.at(-1)?.firmware;
    if (firmware) garage.whoops[whoop] = { ...garage.whoops[whoop], firmware };
  });
  return garage;
}

/** The Garage without a log and its flights. */
export function forgetLog(found, logId) {
  const garage = garageDefaults(found);
  delete garage.logs[logId];
  for (const [id, flight] of Object.entries(garage.flights)) if (flight.log === logId) delete garage.flights[id];
  return garage;
}

/** The Garage without one flight; a log with no flight left goes too. `{ garage, logGone }`, with
 *  logGone the log's id when its folder can go. */
export function forgetFlight(found, id) {
  const garage = garageDefaults(found);
  const flight = garage.flights[id];
  if (!flight) return { garage, logGone: null };
  delete garage.flights[id];
  const left = Object.values(garage.flights).some((one) => one.log === flight.log);
  if (!left) delete garage.logs[flight.log];
  return { garage, logGone: left ? null : flight.log };
}

/** A flight's pack, what it was or whoop changed. A change of pack or of what it was goes for the
 *  whole power-up, as one pack flew all of it. */
export function changeFlight(found, id, changes) {
  const garage = garageDefaults(found);
  const flight = garage.flights[id];
  if (!flight) return garage;
  const together = Object.values(garage.flights).filter((one) => one.log === flight.log && one.powerUp === flight.powerUp);
  for (const one of together) {
    const changed = { ...one };
    if ("pack" in changes) changed.pack = changes.pack || null;
    if ("what" in changes) changed.what = String(changes.what ?? "").trim();
    if ("whoop" in changes && garage.whoops[changes.whoop]) changed.whoop = changes.whoop;
    garage.flights[one.id] = changed;
  }
  return garage;
}

/** A whoop renamed; a name another whoop has is refused. */
export function renameWhoop(found, id, name) {
  const garage = garageDefaults(found);
  const tidy = String(name ?? "").trim().slice(0, 40);
  if (!garage.whoops[id] || !tidy) return { garage, problem: "Give the whoop a name." };
  if (Object.values(garage.whoops).some((one) => one.id !== id && one.name.toLowerCase() === tidy.toLowerCase())) return { garage, problem: `Another whoop is called ${tidy}.` };
  garage.whoops[id] = { ...garage.whoops[id], name: tidy };
  return { garage, problem: null };
}

/** Flights newest first: by when their log was saved, then the latest arm first. */
export function flightsNewestFirst(garage, { whoop = null, pack = null } = {}) {
  return Object.values(garage.flights)
    .filter((one) => (whoop === null || one.whoop === whoop) && (pack === null || one.pack === pack))
    .sort((a, b) => String(b.savedAt ?? b.keptAt).localeCompare(String(a.savedAt ?? a.keptAt)) || b.index - a.index);
}

/** Each whoop with its flights counted, its newest flight, and how long it has flown. */
export function whoopCards(garage) {
  return Object.values(garage.whoops).map((whoop) => {
    const flights = flightsNewestFirst(garage, { whoop: whoop.id });
    const seconds = flights.reduce((sum, one) => sum + (one.summary?.flyingSeconds ?? 0), 0);
    return { ...whoop, flights: flights.length, latest: flights[0] ?? null, flyingSeconds: Math.round(seconds) };
  }).sort((a, b) => String(b.latest?.savedAt ?? b.added).localeCompare(String(a.latest?.savedAt ?? a.added)));
}
