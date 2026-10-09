// The lap timer as the pages show it: over the picture in the marker editor, and in the preview in
// Pilot & settings. It is drawn by the same code that draws it for the finished videos.

import { app, eventOf, trackName } from "./core.js";
import { Panel, corner, cornerMargin, parseHexColor, typeface } from "../shared/panel.js";

const pictures = new Map();

/** A picture from an address, once it has loaded. Null when there is none or it can't be read. */
export function picture(address) {
  if (!address) return Promise.resolve(null);
  if (!pictures.has(address)) {
    pictures.set(address, new Promise((done) => {
      const image = new Image();
      image.onload = () => done(image);
      image.onerror = () => done(null);
      image.src = address;
    }));
  }
  return pictures.get(address);
}

/** The typeface the timer is drawn in has to have arrived before anything is measured with it. */
export const typefaceReady = () => Promise.all([document.fonts.load(`800 66px ${typeface}`), document.fonts.load(`700 24px ${typeface}`)]);

/** The pilot's details and the timer's look for a track's videos. */
export function lookFor(track) {
  const settings = app.state.settings;
  const event = eventOf(track) ?? { name: "", id: "", idLabel: "ID", logo: null };
  return {
    accent: parseHexColor(settings.accent || "#FFD60A") ?? parseHexColor("#FFD60A"),
    title: settings.pilot || null,
    badge: event.id ? (event.idLabel ? `${event.idLabel} ${event.id}` : event.id) : null,
    event: event.name || null,
    track: trackName(track),
    position: settings.corner || "tr",
    logoAddress: event.logo ?? null,
  };
}

/**
 * Draws the 16:9 video's timer on a canvas that stands for the whole frame, in the corner the
 * pilot chose, as it reads `seconds` into the clip. The canvas is cleared first.
 */
export function drawCornerTimer(canvas, { race, look, logo = null, seconds, maxRows = 8 }) {
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (!race) return null;
  const panel = new Panel({ race, scale: canvas.height / 1080, accent: look.accent, title: look.title, badge: look.badge, event: look.event, track: look.track, maxRows, logo });
  const at = corner(look.position, { boxWidth: panel.pixelWidth, boxHeight: panel.pixelHeight, frameWidth: canvas.width, frameHeight: canvas.height, inset: Math.round(cornerMargin * panel.scale) })
    ?? { x: canvas.width - panel.pixelWidth - Math.round(cornerMargin * panel.scale), y: Math.round(cornerMargin * panel.scale) };
  context.save();
  context.translate(at.x, at.y);
  panel.draw(context, seconds);
  context.restore();
  return { x: at.x, y: at.y, width: panel.pixelWidth, height: panel.pixelHeight };
}
