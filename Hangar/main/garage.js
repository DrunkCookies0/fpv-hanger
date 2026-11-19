// The Whoop Garage's files: a blackbox log the pilot opens is read and worked out in a worker, shown
// on the page power-up by power-up, and kept once the pilot says which whoop and pack each was.
// Kept, the log is copied into the library's Whoop Garage folder, in a folder of its own named for
// the start of its SHA-256, with what was worked out from each flight kept in it (analysis.json).
// The index of whoops, logs and flights is in hangar.json (shared/garage.js).

import { app, dialog, shell } from "electron";
import { Worker } from "node:worker_threads";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { keepLog, matchWhoop, newWhoopName, packGuess, forgetFlight, changeFlight, renameWhoop, flightsNewestFirst } from "../shared/garage.js";
import { healthRow, setPart, noteChange, forgetChange, changeTime } from "../shared/whoop.js";
import { summaryOf, shortFlight } from "../shared/flight.js";

/** A line of throttle across an arm, for the small picture beside it: about 60 points. */
function sparkOf(flight) {
  const values = flight?.series?.throttle ?? [];
  if (values.length === 0) return [];
  const per = Math.max(1, Math.ceil(values.length / 60));
  const out = [];
  for (let i = 0; i < values.length; i += per) out.push(Math.max(...values.slice(i, i + per).map((v) => v ?? 0)));
  return out;
}

/**
 * The pages ask for `chooseBlackbox`, `readBlackbox`, `keepBlackbox`, `garageFlight`,
 * `changeGarageFlight`, `forgetGarageFlight`, `renameGarageWhoop`, `showGarageLog`, and for one
 * whoop `garageWhoop`, `setGarageWhoopPart`, `noteGarageWhoopChange` and `forgetGarageWhoopChange`.
 */
export function makeGarage({ library, window, tell }) {
  /** Logs read and not yet kept, by their id: the file, and everything worked out from it. */
  const readings = new Map();
  /** The last log's analysis read back from the library, by its id. */
  let opened = null;
  /** What health needs of each kept log's flights, by the log's id: read once, as a log's analysis
   *  doesn't change once it is kept (keeping it again gives it a new keptAt). */
  const healthRows = new Map();

  const folderOf = (logId) => join(library.garageFolder, logId);

  const analyse = (path) => new Promise((done) => {
    const worker = new Worker(new URL("./garageworker.js", import.meta.url), { workerData: { path } });
    worker.once("message", (answer) => {
      done(answer);
      worker.terminate();
    });
    worker.once("error", (error) => done({ problem: `It couldn't be read: ${error.message}` }));
  });

  const analysisOf = (logId) => {
    if (opened?.id === logId) return opened.analysis;
    try {
      const analysis = JSON.parse(readFileSync(join(folderOf(logId), "analysis.json"), "utf8"));
      opened = { id: logId, analysis };
      return analysis;
    } catch {
      return null;
    }
  };

  return {
    /** The pilot picks a log; it starts in Downloads, where Betaflight's app saves one. */
    async chooseBlackbox() {
      const picked = await dialog.showOpenDialog(window(), {
        title: "Open a blackbox log",
        message: "Choose a log Betaflight saved: Blackbox tab, Save flash to file.",
        buttonLabel: "Open",
        defaultPath: app.getPath("downloads"),
        properties: ["openFile"],
        filters: [{ name: "Blackbox logs", extensions: ["bbl", "bfl", "BBL", "BFL", "txt"] }, { name: "All files", extensions: ["*"] }],
      });
      return picked.canceled ? null : picked.filePaths[0];
    },

    /**
     * Reads a log and says what is in it, for the page that asks which whoop and pack: each
     * power-up, with the whoop it seems to be and the pack the file's name suggests, and its arms.
     */
    async readBlackbox(path) {
      if (typeof path !== "string" || !existsSync(path)) return { problem: "That file isn't there." };
      const started = Date.now();
      const answer = await analyse(path);
      if (answer.problem) return { problem: answer.problem };
      const name = basename(path);
      readings.set(answer.id, { path, name, ...answer });
      const garage = library.garage;
      const packs = Object.values(library.batteries.packs ?? {});
      const parts = answer.reading.powerUps.map((indexes) => answer.reading.logs.filter((log) => indexes.includes(log.index)));
      const guess = parts.length === 1 ? packGuess(name, packs) : null;
      return {
        id: answer.id, name, size: answer.size, savedAt: answer.savedAt, seconds: Math.round((Date.now() - started) / 100) / 10,
        already: Boolean(garage.logs[answer.id]),
        powerUps: parts.map((logs) => {
          const whoop = logs.find((log) => log.whoop?.uid || log.whoop?.craft)?.whoop ?? logs[0].whoop;
          const flown = logs.filter((log) => log.flight && !log.flight.tooShort && !log.flight.missing);
          return {
            whoop, match: matchWhoop(garage, whoop), suggestedName: newWhoopName(garage, whoop), pack: guess,
            startVolts: flown[0]?.flight.battery?.beforeArm ?? null,
            flyingSeconds: Math.round(flown.reduce((sum, log) => sum + (log.flight.flyingSeconds ?? 0), 0)),
            firmware: logs.at(-1)?.facts?.firmware ?? null,
            arms: logs.map((log) => {
              const summary = log.flight ? summaryOf(log.flight) : null;
              const usable = Boolean(log.flight) && !log.flight.tooShort && !log.flight.missing;
              return {
                index: log.index, frames: log.frames, usable, summary, spark: sparkOf(log.flight),
                keep: usable && (log.flight.flyingSeconds ?? 0) >= shortFlight,
              };
            }),
          };
        }),
      };
    },

    /**
     * Keeps a log read just now, with the pilot's answers for each power-up: `{ whoop, name, pack,
     * what, keep }`, where `whoop` is the id of one in the Garage or "new" (named `name`), and
     * `keep` the arms to keep.
     */
    keepBlackbox(id, answers) {
      const held = readings.get(id);
      if (!held) return { problem: "Open the log again: it was read too long ago." };
      if (!Array.isArray(answers) || answers.length !== held.reading.powerUps.length) return { problem: "Say which whoop each power-up was." };
      const byIndex = new Map(held.reading.logs.map((log) => [log.index, log]));
      const powerUps = [];
      held.reading.powerUps.forEach((indexes, number) => {
        const said = answers[number] ?? {};
        const keep = (said.keep ?? []).filter((index) => indexes.includes(index) && byIndex.get(index)?.flight && !byIndex.get(index).flight.tooShort);
        if (keep.length === 0) return;
        const first = byIndex.get(indexes.find((index) => byIndex.get(index)?.whoop?.uid) ?? indexes[0]);
        let whoop = said.whoop && said.whoop !== "new" ? said.whoop : null;
        if (!whoop) {
          // A whoop new to the Garage goes by its flight controller's number, made unique if a whoop
          // in the Garage has it already and the pilot said this is another.
          let fresh = `w-${first.whoop.uid ?? randomUUID().slice(0, 8)}`;
          if (library.garage.whoops[fresh] || powerUps.some((part) => part.whoop?.id === fresh && part.whoop.name !== said.name)) fresh = `${fresh}-${randomUUID().slice(0, 4)}`;
          whoop = { ...first.whoop, id: fresh, name: said.name };
        }
        powerUps.push({
          whoop, pack: said.pack || null, what: said.what ?? "",
          logs: keep.map((index) => ({ index, firmware: byIndex.get(index).facts?.firmware ?? null, summary: summaryOf(byIndex.get(index).flight) })),
        });
      });
      if (powerUps.length === 0) return { problem: "Tick at least one flight to keep." };
      let garage;
      try {
        garage = keepLog(library.garage, { log: { id, file: held.name, size: held.size, savedAt: held.savedAt }, powerUps });
      } catch (error) {
        return { problem: error.message };
      }
      try {
        const folder = folderOf(id);
        mkdirSync(folder, { recursive: true });
        if (!existsSync(join(folder, held.name))) copyFileSync(held.path, join(folder, held.name));
        const kept = new Set(powerUps.flatMap((part) => part.logs.map((log) => log.index)));
        writeFileSync(join(folder, "analysis.json"), JSON.stringify({ file: held.name, logs: held.reading.logs.filter((log) => kept.has(log.index)), powerUps: held.reading.powerUps }));
      } catch (error) {
        return { problem: `The log couldn't be put in your library: ${error.message}` };
      }
      if (opened?.id === id) opened = null;
      library.keepGarage(garage);
      readings.delete(id);
      tell("changed");
      return { garage: library.garage, flights: powerUps.flatMap((part) => part.logs.map((log) => `${id}-${log.index}`)) };
    },

    /** One kept flight: everything worked out from it, the header facts, and the whoop it came from. */
    garageFlight(flightId) {
      const flight = library.garage.flights[flightId];
      if (!flight) return { problem: "That flight isn't in the Garage any more." };
      const analysis = analysisOf(flight.log);
      const log = analysis?.logs.find((one) => one.index === flight.index);
      if (!log) return { problem: "That flight's log isn't in your library's Whoop Garage folder any more." };
      return { flight: log.flight, facts: log.facts, whoop: log.whoop };
    },

    /** A flight's pack, what it was, or whoop, changed; for its whole power-up. */
    changeGarageFlight(flightId, changes) {
      library.keepGarage(changeFlight(library.garage, flightId, changes ?? {}));
      tell("changed");
      return { garage: library.garage };
    },

    /** A flight taken out of the Garage. Its log goes to the Trash once none of its flights is left. */
    async forgetGarageFlight(flightId) {
      const { garage, logGone } = forgetFlight(library.garage, flightId);
      library.keepGarage(garage);
      if (logGone && existsSync(folderOf(logGone))) await library.trash(folderOf(logGone)).catch(() => {});
      if (opened?.id === logGone) opened = null;
      tell("changed");
      return { garage: library.garage };
    },

    /**
     * What a whoop's page needs beyond the Garage's index: each of its flights as health reads it,
     * and the header facts of its newest flight, for the parts its log fills in.
     */
    garageWhoop(id) {
      const garage = library.garage;
      if (!garage.whoops[id]) return { problem: "That whoop isn't in the Garage any more." };
      const flights = flightsNewestFirst(garage, { whoop: id });
      const rows = [];
      let facts = null;
      for (const flight of flights) {
        const log = garage.logs[flight.log];
        const key = `${flight.log} ${log?.keptAt ?? ""}`;
        if (!healthRows.has(key)) {
          const analysis = analysisOf(flight.log);
          healthRows.set(key, new Map((analysis?.logs ?? []).map((one) => [one.index, { flight: one.flight ? healthRow({ id: "", index: one.index }, one.flight) : null, facts: one.facts ?? null }])));
        }
        const found = healthRows.get(key).get(flight.index);
        if (!found) continue;
        facts ??= found.facts;
        if (found.flight) rows.push({ ...found.flight, id: flight.id, at: flight.savedAt ?? flight.keptAt, what: flight.what, pack: flight.pack });
      }
      return { rows, facts };
    },

    /** One of a whoop's parts typed; an empty one goes back to what its log says. */
    setGarageWhoopPart(id, key, value) {
      library.keepGarage(setPart(library.garage, id, key, value));
      tell("changed");
      return { garage: library.garage };
    },

    /** A change to a whoop noted, made on `day` ("YYYY-MM-DD"). */
    noteGarageWhoopChange(id, { day, text } = {}) {
      const when = changeTime(day);
      if (when.problem) return { problem: when.problem };
      const { garage, problem } = noteChange(library.garage, id, { at: when.at, text });
      if (problem) return { problem };
      library.keepGarage(garage);
      tell("changed");
      return { garage: library.garage };
    },

    forgetGarageWhoopChange(id, changeId) {
      library.keepGarage(forgetChange(library.garage, id, changeId));
      tell("changed");
      return { garage: library.garage };
    },

    renameGarageWhoop(id, name) {
      const { garage, problem } = renameWhoop(library.garage, id, name);
      if (problem) return { problem };
      library.keepGarage(garage);
      tell("changed");
      return { garage: library.garage };
    },

    /** Shows a kept flight's log file, to open in Betaflight's Blackbox Explorer. */
    showGarageLog(flightId) {
      const flight = library.garage.flights[flightId];
      const log = flight && library.garage.logs[flight.log];
      if (!log) return;
      const file = join(folderOf(log.id), log.file);
      if (existsSync(file)) shell.showItemInFolder(file);
    },
  };
}
