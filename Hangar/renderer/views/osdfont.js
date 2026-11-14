// OSD font: the font an analog whoop's on-screen display draws with, its letters, numbers, icons
// and boot logo, changed dot by dot. A font starts from one of Betaflight's own (fetched from
// Betaflight when asked for), one of the pilot's, or a file. It is saved in the library's OSD
// fonts folder, and Betaflight's Font Manager puts it on the whoop. The font being changed stays
// while the app is open, as it was left.

import { ask, render } from "../core.js";
import { h, label, primary, secondary, plain } from "../ui.js";
import { showSheet, confirm } from "../sheets.js";
import { fileBrowser } from "../words.js";
import { openFromSide } from "./live.js";
import {
  readFont, writeFont, copyFont, glyphOf, setGlyph, setDot, logoOf, setLogo, setLogoDot, logo, inverted, shifted, outlined,
  dotsFromPicture, describeGlyph, takeGlyphs, fontName, groups, betaflightFonts, isClear, BLACK, WHITE, CLEAR, width, height,
} from "../../shared/osdfont.js";

/** The font being changed, where it came from, and how the page is set. */
const kept = {
  font: null,
  /** { kind: "betaflight" | "mine" | "file", id, title } */
  from: null,
  /** The name it was last saved under, and whether it has changed since. */
  savedAs: null,
  changed: false,
  picked: 0x41,
  tool: WHITE,
  undo: [],
  redo: [],
  preview: "flying",
  takeFrom: "default",
  busy: null,
  problem: null,
  mine: null,
};

/** Betaflight's fonts once fetched, by name. */
const fetched = new Map();

const colours = { [WHITE]: [255, 255, 255], [BLACK]: [0, 0, 0] };
/** What see-through shows as where there is no camera picture behind it. */
const behind = [62, 69, 82];

// ---- Changes, and taking them back

/** Keeps the font as it is before a change, so the change can be taken back. */
function before() {
  kept.undo.push(new Uint8Array(kept.font.glyphs));
  if (kept.undo.length > 80) kept.undo.shift();
  kept.redo = [];
}

function changed() {
  kept.changed = true;
  render();
}

function undo() {
  if (kept.undo.length === 0) return;
  kept.redo.push(new Uint8Array(kept.font.glyphs));
  kept.font.glyphs = kept.undo.pop();
  changed();
}

function redo() {
  if (kept.redo.length === 0) return;
  kept.undo.push(new Uint8Array(kept.font.glyphs));
  kept.font.glyphs = kept.redo.pop();
  changed();
}

/** Makes a font the one being changed. */
function use(font, from) {
  kept.font = font;
  kept.from = from;
  kept.savedAs = from.kind === "mine" ? from.id : null;
  kept.changed = false;
  kept.undo = [];
  kept.redo = [];
  kept.problem = null;
  render();
}

// ---- Where fonts come from

async function betaflightFont(id) {
  if (fetched.has(id)) return fetched.get(id);
  const answer = await ask("betaflightOsdFont", id);
  const font = answer?.text ? readFont(answer.text) : null;
  if (!font) throw new Error(answer?.problem ?? "That font couldn't be read.");
  fetched.set(id, font);
  return font;
}

export async function startFromBetaflight(id) {
  const title = betaflightFonts.find(([one]) => one === id)?.[1] ?? id;
  kept.busy = `Fetching Betaflight's ${title} font…`;
  kept.problem = null;
  render();
  try {
    const font = await betaflightFont(id);
    kept.busy = null;
    use(copyFont(font), { kind: "betaflight", id, title: `Betaflight's ${title} font` });
  } catch (error) {
    kept.busy = null;
    kept.problem = error.message;
    render();
  }
}

async function startFromMine(name) {
  const answer = await ask("readOsdFont", name);
  const font = answer?.text ? readFont(answer.text) : null;
  if (!font) {
    kept.problem = answer?.problem ?? "That font couldn't be read.";
    return render();
  }
  use(font, { kind: "mine", id: name, title: `${name}, one of your fonts` });
}

/** Lets the pilot choose a file on the computer, and hands it on. */
function chooseFile(accept, then) {
  const input = h("input", { type: "file", accept });
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) then(file);
  });
  input.click();
}

/** A font file from anywhere on the computer. */
export async function openFontFile(file) {
  const font = readFont(await file.text());
  if (!font) {
    kept.problem = `${file.name} isn't an OSD font: Betaflight's are .mcm files that start with MAX7456.`;
    return render();
  }
  use(font, { kind: "file", id: fontName(file.name), title: file.name });
}

const startFromFile = () => chooseFile(".mcm", openFontFile);

async function refreshMine() {
  kept.mine = await ask("osdFontsHere");
  render();
}

/** The menu of where to start from. */
function openMenu() {
  let close = () => {};
  const pick = (action) => () => {
    close();
    action();
  };
  const mine = kept.mine?.names ?? [];
  close = showSheet(h("div.alert.font-open",
    h("div.alert-title", "Open a font"),
    label("BETAFLIGHT'S OWN"),
    h("div.font-choices", betaflightFonts.map(([id, title]) => h("button.choice", { type: "button", probe: `font betaflight ${id}`, onclick: pick(() => startFromBetaflight(id)) }, title))),
    mine.length > 0 && [label("YOUR FONTS"), h("div.font-choices", mine.map((name) => h("button.choice", { type: "button", probe: `font mine ${name}`, onclick: pick(() => startFromMine(name)) }, name)))],
    h("div.alert-buttons", plain("A font file on this computer…", pick(startFromFile), { class: "quiet", icon: "folderPlus" }), h("span.spacer"), secondary("Cancel", () => close())),
  ), { onEscape: () => close() });
}

// ---- Saving

function openSave() {
  let close = () => {};
  const name = h("input.field.answer-field", { type: "text", value: kept.savedAs ?? kept.from?.id ?? "My font", spellcheck: false, key: "font name", probe: "font name" });
  const said = h("p.alert-message.warn");
  const save = async (replace = false) => {
    const tidy = fontName(name.value);
    const text = writeFont(kept.font);
    const answer = await ask("saveOsdFont", tidy, text, replace || tidy === kept.savedAs);
    if (answer?.exists) {
      if (await confirm({ title: `Replace ${answer.name}?`, message: `There is a font called ${answer.name} in your OSD fonts already.`, yes: "Replace it", destructive: true })) return save(true);
      return;
    }
    if (answer?.problem) {
      said.textContent = answer.problem;
      return;
    }
    kept.savedAs = answer.name;
    kept.from = { kind: "mine", id: answer.name, title: `${answer.name}, one of your fonts` };
    kept.changed = false;
    close();
    await refreshMine();
  };
  close = showSheet(h("div.alert",
    h("div.alert-title", "Save to your OSD fonts"),
    h("div.alert-message", `It goes in the OSD fonts folder in your library, as a .mcm file, ready for Betaflight's Font Manager.`),
    name, said,
    h("div.alert-buttons", secondary("Cancel", () => close()), primary("Save", () => save(), { probe: "font save", "data-default": "" })),
  ), { onEscape: () => close() });
  name.focus();
  name.select();
}

// ---- Drawing

/** A canvas a picture is drawn into at its own size and shown bigger, each dot square. */
function dotCanvas(across, down, className) {
  const canvas = h(`canvas.${className}`, { width: across, height: down });
  canvas.style.aspectRatio = `${across} / ${down}`;
  return canvas;
}

/** Draws dots into a canvas, see-through over `background` (a colour, or a canvas behind). */
function putDots(canvas, picture, across, at = [0, 0], background = behind) {
  const context = canvas.getContext("2d");
  const image = context.getImageData(at[0], at[1], across, picture.length / across);
  for (let index = 0; index < picture.length; index += 1) {
    const dot = picture[index];
    if (isClear(dot) && background === null) continue;
    const [r, g, b] = isClear(dot) ? background : colours[dot];
    image.data.set([r, g, b, 255], index * 4);
  }
  context.putImageData(image, at[0], at[1]);
}

/** All the pictures, 32 across and 8 down: the boot logo is the bottom three rows. */
const sheetColumns = 32;
const cell = { across: width + 1, down: height + 1 };
function drawSheet(canvas) {
  const context = canvas.getContext("2d");
  context.fillStyle = "#0b0d10";
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < 256; index += 1) {
    const x = (index % sheetColumns) * cell.across + 1, y = Math.floor(index / sheetColumns) * cell.down + 1;
    putDots(canvas, glyphOf(kept.font, index), width, [x, y]);
  }
  // The picture being changed, framed in yellow.
  const x = (kept.picked % sheetColumns) * cell.across, y = Math.floor(kept.picked / sheetColumns) * cell.down;
  context.strokeStyle = "#ffd60a";
  context.lineWidth = 1;
  context.strokeRect(x + 0.5, y + 0.5, cell.across, cell.down);
}

/** One picture big, with each dot a square and a faint grid between. */
const zoom = 22;
function drawGlyph(canvas) {
  const context = canvas.getContext("2d");
  const glyph = glyphOf(kept.font, kept.picked);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dot = glyph[y * width + x];
      context.fillStyle = dot === WHITE ? "#fff" : dot === BLACK ? "#000" : (x + y) % 2 ? "#2b3039" : "#343a45";
      context.fillRect(x * zoom, y * zoom, zoom, zoom);
    }
  }
  context.strokeStyle = "rgba(255, 255, 255, 0.08)";
  context.beginPath();
  for (let x = 1; x < width; x += 1) context.moveTo(x * zoom + 0.5, 0), context.lineTo(x * zoom + 0.5, height * zoom);
  for (let y = 1; y < height; y += 1) context.moveTo(0, y * zoom + 0.5), context.lineTo(width * zoom, y * zoom + 0.5);
  context.stroke();
}

/** A picture like a whoop's camera, behind the preview: sky, floor and a gate. */
function drawCamera(context, across, down) {
  const sky = context.createLinearGradient(0, 0, 0, down);
  sky.addColorStop(0, "#5f7d9c");
  sky.addColorStop(0.55, "#a5afb8");
  sky.addColorStop(0.56, "#6d6156");
  sky.addColorStop(1, "#3d342d");
  context.fillStyle = sky;
  context.fillRect(0, 0, across, down);
  context.fillStyle = "#c8452f";
  context.fillRect(across * 0.3, down * 0.28, 10, down * 0.36);
  context.fillRect(across * 0.62, down * 0.28, 10, down * 0.36);
  context.fillRect(across * 0.3, down * 0.28, across * 0.32 + 10, 9);
}

/** Text in the font's own letters: the OSD has capitals only. */
const textGlyphs = (text) => [...text.toUpperCase()].map((character) => character.charCodeAt(0));

/** What the goggles show: Betaflight's start-up screen with the logo, or flying with the usual numbers. */
function drawPreview(canvas) {
  const context = canvas.getContext("2d");
  drawCamera(context, canvas.width, canvas.height);
  const at = (column, row, codes) => codes.forEach((code, step) => {
    const x = (column + step) * width, y = row * height;
    const glyph = glyphOf(kept.font, code);
    const image = context.getImageData(x, y, width, height);
    glyph.forEach((dot, index) => { if (!isClear(dot)) image.data.set([...colours[dot], 255], index * 4); });
    context.putImageData(image, x, y);
  });
  if (kept.preview === "start") {
    // Betaflight puts the logo in the middle, a little above it, and the menu's keys under it.
    for (let row = 0; row < logo.rows; row += 1) at(3, 3 + row, Array.from({ length: logo.columns }, (_, column) => logo.first + row * logo.columns + column));
    at(9, 8, textGlyphs("MENU:THR MID"));
    at(11, 9, textGlyphs("+ YAW LEFT"));
    at(11, 10, textGlyphs("+ PITCH UP"));
  } else {
    at(1, 1, [0x01, ...textGlyphs("99")]);
    at(12, 1, textGlyphs("WHOOP"));
    at(24, 1, [0x7b, ...textGlyphs("100")]);
    at(14, 7, [0x72, 0x73, 0x74]);
    at(1, 13, [0x04, ...textGlyphs("42")]);
    at(1, 14, [0x97, ...textGlyphs("4.18"), 0x06]);
    at(9, 14, [...textGlyphs("1.24"), 0x9a]);
    at(16, 14, [...textGlyphs("120"), 0x07]);
    at(23, 14, [0x9c, ...textGlyphs("01:23")]);
  }
}

/** Where a pointer is on a canvas, in its own dots. */
function dotUnder(canvas, event, scaleAcross, scaleDown = scaleAcross) {
  const box = canvas.getBoundingClientRect();
  return {
    x: Math.floor(((event.clientX - box.left) / box.width) * (canvas.width / scaleAcross)),
    y: Math.floor(((event.clientY - box.top) / box.height) * (canvas.height / scaleDown)),
  };
}

/** Painting with the pointer: pressed, dragged and let go. The canvas is drawn again as it goes,
 *  the rest of the page once it is let go. */
function paintable(canvas, paint, redraw) {
  let down = false;
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    down = true;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {}
    before();
    paint(event);
    redraw();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!down) return;
    paint(event);
    redraw();
  });
  const end = () => {
    if (!down) return;
    down = false;
    changed();
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
}

// ---- The parts of the page

const toolNames = [[WHITE, "White"], [BLACK, "Black"], [CLEAR, "See-through"]];

function tools() {
  return h("div.font-tools", { role: "radiogroup", "aria-label": "Paint with" },
    toolNames.map(([dot, title]) => h(`button.choice.font-tool${kept.tool === dot ? ".picked" : ""}`, {
      type: "button", role: "radio", "aria-checked": String(kept.tool === dot), probe: `font tool ${title}`,
      onclick: () => { kept.tool = dot; render(); },
    }, h(`span.font-swatch.${title === "See-through" ? "clear" : title.toLowerCase()}`), title)),
    h("span.spacer"),
    plain("Undo", undo, { class: "quiet", disabled: kept.undo.length === 0, probe: "font undo" }),
    plain("Redo", redo, { class: "quiet", disabled: kept.redo.length === 0 }),
  );
}

/** A change to the picture being changed, kept for Undo. */
function changeGlyph(make) {
  before();
  setGlyph(kept.font, kept.picked, make(glyphOf(kept.font, kept.picked)));
  changed();
}

function sheetCard() {
  const across = sheetColumns * cell.across + 1, down = (256 / sheetColumns) * cell.down + 1;
  const canvas = dotCanvas(across, down, "font-sheet");
  drawSheet(canvas);
  const at = (event) => {
    const box = canvas.getBoundingClientRect();
    const column = Math.floor(((event.clientX - box.left) / box.width) * across / cell.across);
    const row = Math.floor(((event.clientY - box.top) / box.height) * down / cell.down);
    return Math.min(255, Math.max(0, row * sheetColumns + Math.min(sheetColumns - 1, column)));
  };
  canvas.addEventListener("mousemove", (event) => {
    const one = describeGlyph(at(event));
    canvas.title = `${one.hex}${one.character && one.character !== " " ? ` ${one.character}` : ""}: ${one.purpose}`;
  });
  canvas.addEventListener("click", (event) => {
    kept.picked = at(event);
    render();
  });
  canvas.dataset.probe = "font sheet";
  return h("section.card.font-card", { "aria-label": "Every picture in the font" },
    h("div.rates-card-head", label("EVERY PICTURE"), h("span.spacer"), h("span.small.dim", "Pick one to change it. The bottom three rows are the boot logo.")),
    canvas,
  );
}

function glyphCard() {
  const about = describeGlyph(kept.picked);
  const canvas = dotCanvas(width * zoom, height * zoom, "font-glyph");
  drawGlyph(canvas);
  canvas.dataset.probe = "font glyph";
  paintable(canvas, (event) => {
    const { x, y } = dotUnder(canvas, event, zoom);
    setDot(kept.font, kept.picked, x, y, kept.tool);
  }, () => drawGlyph(canvas));
  const group = groups.find((one) => one.id === about.group);
  const step = (dx, dy, arrow) => plain(arrow, () => changeGlyph((glyph) => shifted(glyph, width, dx, dy)), { class: "quiet", help: "Moves the picture a dot" });
  return h("section.card.font-card", { "aria-label": "The picture being changed" },
    h("div.rates-card-head", label(`PICTURE ${about.index} · ${about.hex}`), h("span.spacer"),
      plain("", () => { kept.picked = (kept.picked + 255) % 256; render(); }, { icon: "chevronLeft", class: "quiet", help: "The picture before" }),
      plain("", () => { kept.picked = (kept.picked + 1) % 256; render(); }, { icon: "chevronRight", class: "quiet", help: "The next picture" })),
    h("p.font-purpose", { probe: "font purpose" }, h("strong", about.purpose), group && h("span.dim", ` · ${group.name}`)),
    h("div.font-editor",
      canvas,
      h("div.font-actions",
        tools(),
        h("div.row.wrap.tight",
          secondary("Clear", () => changeGlyph((glyph) => glyph.fill(CLEAR)), { help: "Makes the whole picture see-through" }),
          secondary("Swap white and black", () => changeGlyph((glyph) => inverted(glyph))),
          secondary("Black outline", () => changeGlyph((glyph) => outlined(glyph, width)), { help: "Black round the edge of the white, so it shows on any picture" })),
        h("div.row.tight", h("span.small.dim", "Move it"), step(-1, 0, "←"), step(1, 0, "→"), step(0, -1, "↑"), step(0, 1, "↓")),
        takeCard(about, group),
      ),
    ),
  );
}

/** Pictures from another of Betaflight's fonts in place of this one's: an icon set from one, letters from another. */
function takeCard(about, group) {
  const choose = h("select.field.font-take-from", { probe: "font take from", onchange: (event) => { kept.takeFrom = event.target.value; } },
    betaflightFonts.map(([id, title]) => h("option", { value: id, selected: id === kept.takeFrom }, title)));
  const take = async (indexes, what) => {
    try {
      kept.busy = `Fetching Betaflight's font…`;
      render();
      const from = await betaflightFont(kept.takeFrom);
      kept.busy = null;
      before();
      takeGlyphs(kept.font, from, indexes);
      changed();
    } catch (error) {
      kept.busy = null;
      kept.problem = `${what} couldn't be taken: ${error.message}`;
      render();
    }
  };
  const text = groups.find((one) => one.id === "text").glyphs, logoGlyphs = groups.find((one) => one.id === "logo").glyphs;
  return h("div.font-take",
    label("TAKE FROM BETAFLIGHT'S"), choose,
    h("div.row.wrap.tight",
      secondary("This picture", () => take([kept.picked], "The picture"), { probe: "font take one" }),
      group && group.id !== "text" && group.id !== "logo" && secondary(group.name, () => take(group.glyphs, group.name), { probe: "font take group" }),
      secondary("Letters and numbers", () => take(text, "The letters"), { probe: "font take text" }),
      secondary("Everything but the logo", () => take(Array.from({ length: 256 }, (_, index) => index).filter((index) => !logoGlyphs.includes(index)), "The font"))),
  );
}

function logoCard() {
  const canvas = dotCanvas(logo.width, logo.height, "font-logo");
  const redraw = () => putDots(canvas, logoOf(kept.font), logo.width);
  redraw();
  canvas.dataset.probe = "font logo";
  paintable(canvas, (event) => {
    const { x, y } = dotUnder(canvas, event, 1);
    setLogoDot(kept.font, x, y, kept.tool);
  }, redraw);
  const changeLogo = (make) => {
    before();
    setLogo(kept.font, make(logoOf(kept.font)));
    changed();
  };
  return h("section.card.font-card", { "aria-label": "The boot logo" },
    h("div.rates-card-head", label("BOOT LOGO · 288 × 72"), h("span.spacer"), h("span.small.dim", "Paint on it with the same white, black and see-through.")),
    canvas,
    h("div.row.wrap.tight",
      primary("Use a picture…", openPicture, { icon: "picture", probe: "font logo picture" }),
      secondary("Black outline", () => changeLogo((picture) => outlined(picture, logo.width))),
      secondary("Swap white and black", () => changeLogo((picture) => inverted(picture))),
      secondary("Clear", () => changeLogo((picture) => picture.fill(CLEAR))),
      secondary(`Betaflight's logo`, async () => {
        try {
          const from = await betaflightFont(kept.takeFrom);
          changeLogo(() => logoOf(from));
        } catch (error) {
          kept.problem = error.message;
          render();
        }
      }, { help: "The logo from the font chosen under Take from Betaflight's" })),
  );
}

/** A picture from the computer for the logo: fitted into 288 by 72, made into dots, with a
 *  preview while the split between white and black, the background and the outline are set. */
const openPicture = () => chooseFile("image/png,image/jpeg,image/gif,image/webp,image/bmp", useLogoPicture);

export async function useLogoPicture(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    kept.problem = `${file.name} couldn't be opened as a picture.`;
    return render();
  }
  // Fitted whole into the logo's 288 by 72, in the middle, the rest see-through.
  const fit = document.createElement("canvas");
  fit.width = logo.width;
  fit.height = logo.height;
  const scale = Math.min(logo.width / bitmap.width, logo.height / bitmap.height);
  const across = Math.max(1, Math.round(bitmap.width * scale)), down = Math.max(1, Math.round(bitmap.height * scale));
  const context = fit.getContext("2d");
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, Math.floor((logo.width - across) / 2), Math.floor((logo.height - down) / 2), across, down);
  const rgba = context.getImageData(0, 0, logo.width, logo.height).data;
  const settings = { split: 128, invert: false, background: "corners", outline: true };
  const preview = dotCanvas(logo.width, logo.height, "font-logo");
  const draw = () => putDots(preview, dotsFromPicture(rgba, logo.width, logo.height, settings), logo.width);
  draw();
  const split = h("input.font-split", { type: "range", min: 1, max: 254, value: 128, oninput: (event) => { settings.split = Number(event.target.value); draw(); } });
  const check = (key, words) => h("label.check", h("input", { type: "checkbox", checked: settings[key], onchange: (event) => { settings[key] = event.target.checked; draw(); } }), words);
  let close = () => {};
  close = showSheet(h("div.alert.font-picture",
    h("div.alert-title", "Use a picture for the logo"),
    h("div.alert-message", `${file.name}, fitted into 288 × 72 dots. Light parts become white and dark parts black.`),
    preview,
    h("label.font-row", h("span.small.dim", "Darker"), split, h("span.small.dim", "Lighter")),
    h("label.check", h("input", { type: "checkbox", checked: true, onchange: (event) => { settings.background = event.target.checked ? "corners" : "keep"; draw(); } }), "The plain colour round it is see-through"),
    check("outline", "Black outline round the white"),
    check("invert", "Swap white and black"),
    h("div.alert-buttons", secondary("Cancel", () => close()), primary("Use it", () => {
      before();
      setLogo(kept.font, dotsFromPicture(rgba, logo.width, logo.height, settings));
      close();
      changed();
    }, { probe: "font picture use" })),
  ), { onEscape: () => close() });
}

function previewCard() {
  const canvas = dotCanvas(30 * width, 16 * height, "font-preview");
  drawPreview(canvas);
  canvas.dataset.probe = "font preview";
  const pick = (which, title) => h(`button.choice${kept.preview === which ? ".picked" : ""}`, { type: "button", onclick: () => { kept.preview = which; render(); } }, title);
  return h("section.card.font-card", { "aria-label": "In the goggles" },
    h("div.rates-card-head", label("IN THE GOGGLES"), h("span.spacer"), h("div.font-choices", pick("flying", "Flying"), pick("start", "Starting up"))),
    canvas,
    h("p.small.dim", "A PAL screen, 30 by 16 pictures. The numbers are made up; your OSD's layout is set in Betaflight's OSD tab."),
  );
}

function onTheWhoop() {
  const name = kept.savedAs;
  return h("section.card.font-card", { "aria-label": "Putting it on the whoop" },
    label("PUTTING IT ON THE WHOOP"),
    h("ol.font-steps",
      h("li", name ? ["Saved as ", h("strong", `${name}.mcm`), " in your OSD fonts."] : "Save it to your OSD fonts."),
      h("li", "Plug the whoop in over USB, open Betaflight and connect, and go to the OSD tab."),
      h("li", "Press Font Manager, then Open Font File, and choose it", name ? ` (${kept.mine?.folder ?? "your library's OSD fonts folder"}).` : "."),
      h("li", "Press Upload Font and leave the whoop plugged in until Betaflight says it is done. It takes about a minute, and the whoop starts again."),
    ),
    h("div.row.tight",
      name ? secondary(`Show in ${fileBrowser}`, () => ask("showOsdFont", name), { icon: "folderPlus" }) : primary("Save…", openSave),
      secondary("Open Betaflight", () => openFromSide("betaflight"), { icon: "chip" })),
    h("p.small.dim", "For analog OSD chips, the MAX7456 and the AT7456E most whoop boards have. HDZero, Walksnail and DJI draw their own OSD from fonts in the goggles."),
  );
}

function startCard() {
  const mine = kept.mine?.names ?? [];
  return h("section.card.font-card", { "aria-label": "Where to start" },
    label("START FROM"),
    h("p.dim", "One of Betaflight's own fonts, fetched from Betaflight, one you saved before, or a .mcm file."),
    h("div.font-choices", betaflightFonts.map(([id, title]) => h("button.choice", { type: "button", probe: `font betaflight ${id}`, disabled: Boolean(kept.busy), onclick: () => startFromBetaflight(id) }, title))),
    mine.length > 0 && [label("YOUR FONTS"), h("div.font-choices", mine.map((name) => h("button.choice", { type: "button", probe: `font mine ${name}`, onclick: () => startFromMine(name) }, name)))],
    h("div.row", plain("A font file on this computer…", startFromFile, { class: "quiet", icon: "folderPlus" })),
  );
}

export function osdFontPage() {
  if (kept.mine === null) {
    kept.mine = { folder: "", names: [] };
    refreshMine();
  }
  const font = kept.font;
  const status = font && h("p.small", { probe: "font status" },
    h("span.dim", kept.from.title),
    kept.changed ? h("span.accent", " · changed, not saved") : kept.savedAs ? h("span.dim", ` · saved as ${kept.savedAs}`) : null);
  return h("div.scroll", { "data-scroll": "page" }, h("div.plain-page.osd-font",
    h("header.page-head",
      h("div.grow", label("FIRMWARE & SETUP"), h("h1.head-title", "OSD font")),
      font && secondary("Open…", openMenu, { icon: "folderPlus", probe: "font open" }),
      font && (kept.changed ? primary : secondary)("Save…", openSave, { probe: "font save open" }),
      secondary("Open Betaflight", () => openFromSide("betaflight"), { icon: "chip" })),
    h("p.dim.rates-intro", "An analog whoop's OSD draws every letter, number and icon, and the logo it shows as it starts, from a font of 256 little pictures, each 12 dots by 18 in white, black and see-through. Change any of them, take icons or letters from Betaflight's other fonts, or make a logo from a picture, then put it on the whoop with Betaflight's Font Manager."),
    kept.busy && h("p.small.accent", kept.busy),
    kept.problem && h("p.small.warn", { probe: "font problem" }, kept.problem),
    font ? [status, sheetCard(), glyphCard(), logoCard(), h("div.font-pair", previewCard(), onTheWhoop())] : startCard(),
  ));
}
