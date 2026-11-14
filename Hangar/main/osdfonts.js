// OSD fonts for an analog flight controller: Betaflight's own, fetched from Betaflight when the pilot
// asks for one, and the pilot's, kept in the library's OSD fonts folder for Betaflight's Font
// Manager to upload. Betaflight's fonts are its project's: the app carries none of them. Once
// fetched, a copy is kept in the app's cache, so it opens without a connection after that.
//
// For the app's checks of itself, `--osd-font-feed <folder>` stands in for Betaflight's site: its
// fonts are read from that folder. A copy that shows no window fetches nothing otherwise, unless
// it was asked to with `--live`.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { shell } from "electron";
import { argument } from "./paths.js";
import { readFont, fontName, betaflightFonts, betaflightFontAddress } from "../shared/osdfont.js";

/** How long a fetched font is taken as Betaflight's current one, before it is looked for again. */
const freshFor = 7 * 24 * 60 * 60 * 1000;

/**
 * The pages ask for `osdFontsHere`, `betaflightOsdFont`, `readOsdFont`, `saveOsdFont` and
 * `showOsdFont`. A font goes back and forth as the text of its file.
 */
export function makeOsdFonts({ library, cache, quiet }) {
  const folder = () => join(library.root, "OSD fonts");
  const kept = join(cache, "Betaflight OSD fonts");
  const fileOf = (name) => join(folder(), `${fontName(name)}.mcm`);

  return {
    /** The pilot's own fonts, by name, newest first, and where they are. */
    osdFontsHere() {
      const here = folder();
      let names = [];
      try {
        names = readdirSync(here).filter((file) => /\.mcm$/i.test(file) && !file.startsWith("."))
          .map((file) => ({ name: file.replace(/\.mcm$/i, ""), changed: statSync(join(here, file)).mtimeMs }))
          .sort((a, b) => b.changed - a.changed).map((one) => one.name);
      } catch {}
      return { folder: here, names };
    },

    /** One of Betaflight's fonts, by its name in Betaflight's app ("default", "bold"…). */
    async betaflightOsdFont(id) {
      if (!betaflightFonts.some(([one]) => one === id)) return { problem: "Betaflight has no font by that name." };
      const copy = join(kept, `${id}.mcm`);
      const feed = argument("--osd-font-feed");
      if (feed) {
        try {
          const text = readFileSync(join(feed, `${id}.mcm`), "utf8");
          return readFont(text) ? { text } : { problem: "That isn't a font." };
        } catch {
          return { problem: "Betaflight's site couldn't be reached." };
        }
      }
      let fresh = false;
      try {
        fresh = Date.now() - statSync(copy).mtimeMs < freshFor;
      } catch {}
      if (fresh) return { text: readFileSync(copy, "utf8") };
      if (!quiet || process.argv.includes("--live")) {
        try {
          const answer = await library.fetch(betaflightFontAddress(id), { signal: AbortSignal.timeout(20000) });
          if (answer.ok) {
            const text = await answer.text();
            if (readFont(text)) {
              mkdirSync(kept, { recursive: true });
              writeFileSync(copy, text);
              return { text };
            }
          }
        } catch {}
      }
      // Offline, or Betaflight's site moved: the copy fetched before will do.
      if (existsSync(copy)) return { text: readFileSync(copy, "utf8") };
      return { problem: "Betaflight's fonts come from Betaflight's own site the first time, and it couldn't be reached. Try again with a connection." };
    },

    /** One of the pilot's own fonts. */
    readOsdFont(name) {
      try {
        const text = readFileSync(fileOf(name), "utf8");
        return readFont(text) ? { text } : { problem: `${fontName(name)}.mcm isn't a font Betaflight can use.` };
      } catch {
        return { problem: `${fontName(name)}.mcm isn't in your OSD fonts any more.` };
      }
    },

    /** Keeps a font in the library's OSD fonts folder. One by that name is only replaced when
     *  `replace` says so. */
    saveOsdFont(name, text, replace = false) {
      const tidy = fontName(name);
      if (tidy === "") return { problem: "Give the font a name." };
      if (!readFont(text)) return { problem: "That isn't a font." };
      const file = fileOf(tidy);
      if (existsSync(file) && !replace) return { exists: true, name: tidy };
      try {
        mkdirSync(folder(), { recursive: true });
        writeFileSync(file, text);
        return { name: tidy, file };
      } catch (error) {
        return { problem: `It couldn't be saved: ${error.message}` };
      }
    },

    /** Shows a font in Finder or Explorer, to choose in Betaflight's Font Manager. */
    showOsdFont(name) {
      const file = fileOf(name);
      if (existsSync(file)) shell.showItemInFolder(file);
      else shell.openPath(folder());
    },
  };
}
