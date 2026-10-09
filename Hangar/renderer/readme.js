// The read-me that goes out beside the app in a download, as plain text. It is written by the app
// itself, from the same words as its welcome note, so the two can't drift apart.

import { readMeFor, moviesFolder } from "./words.js";

/** Text broken into lines no longer than `width`, each starting `indent` in, the first with `lead` in its place. */
function wrapped(text, { width = 80, indent = "", lead = indent } = {}) {
  const lines = [];
  let line = lead, words = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (words > 0 && line.length + 1 + word.length > width) {
      lines.push(line);
      line = indent + word;
    } else {
      // The lead ends in its own space, as "  1. " does.
      line += (words > 0 ? " " : "") + word;
    }
    words += 1;
  }
  lines.push(line);
  return lines.join("\n");
}

const needs = {
  darwin: ["A Mac with Apple silicon (an M1 or later) running macOS 13 (Ventura) or newer."],
  win32: ["A PC running Windows 10 or 11, 64-bit."],
};

const installing = {
  darwin: [
    'Drag "FPV Hangar" into your Applications folder.',
    "Open it. The first time, macOS will refuse, because the app does not come from the App Store or a registered developer. To let it through:\n\nmacOS 15 or newer\nPress Done on the warning. Open System Settings > Privacy & Security, scroll down to the line about FPV Hangar, press Open Anyway, and confirm.\n\nmacOS 13 or 14\nRight-click the app, choose Open, then press Open.\n\nYou only do this once. If neither works, open Terminal and run:\n\nxattr -dr com.apple.quarantine \"/Applications/FPV Hangar.app\"",
  ],
  win32: [
    "Unzip the whole folder somewhere you can save files, such as your Desktop or your Documents. Don't run it from inside the zip.",
    'Open "FPV Hangar.exe" in that folder. The first time, Windows may say it protected your PC, because the app is not signed: press "More info", then "Run anyway". You only do this once.',
  ],
};

/** The read-me for one kind of computer ("darwin" or "win32"), for a version of the app. */
export function readMeText(platform, version) {
  const mac = platform !== "win32", told = readMeFor(mac);
  const out = [`FPV HANGAR v${version}`, "", wrapped(told.summary), "", "", "WHAT YOU NEED", ""];
  for (const line of needs[mac ? "darwin" : "win32"]) out.push(wrapped(line, { indent: "  " }), "");
  out.push("", "INSTALLING", "");
  installing[mac ? "darwin" : "win32"].forEach((step, index) => {
    // A step can have more to it under its first paragraph, set further in.
    const [first, ...rest] = step.split("\n\n");
    out.push(wrapped(first, { indent: "     ", lead: `  ${index + 1}. ` }));
    for (const more of rest) out.push("", ...more.split("\n").map((line, at) => wrapped(line, { indent: at === 0 ? "       " : "         ", lead: at === 0 ? "       " : "         " })));
  });
  out.push("");
  for (const section of told.sections) {
    out.push("", section.title.toUpperCase(), "");
    if (section.library) out.push(wrapped(`In a folder called "FPV Hangar" in your ${mac ? "Movies" : "Videos"} folder. Pilot & settings shows it and lets you use a different one.`, { indent: "  " }), "");
    let step = 0;
    for (const [kind, text] of section.items) {
      if (kind === "step") {
        step += 1;
        out.push(wrapped(text, { indent: "     ", lead: `  ${step}. ` }));
      } else if (kind === "point") {
        out.push(wrapped(text, { indent: "    ", lead: "  - " }));
      } else {
        out.push("", wrapped(text, { indent: "  " }));
      }
    }
    out.push("");
  }
  return `${out.join("\n").replace(/\n{4,}/g, "\n\n\n").trimEnd()}\n`;
}

export { moviesFolder };
