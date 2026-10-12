// A card from the goggles, on a track's page: the line that says one is plugged in, and the sheet
// for picking which of its recordings to add.

import { app, trackName } from "../core.js";
import { h, icon, primary, secondary, when } from "../ui.js";
import { showSheet, menu } from "../sheets.js";
import { tickedAtFirst, freshOn } from "../../shared/cards.js";
import * as act from "../actions.js";

const some = (count, one, many) => `${count} ${count === 1 ? one : many}`;
/** The cards plugged in, when they were looked for from this track. */
export const cardsFor = (track) => (app.cards?.track === track ? app.cards.cards : []);

/** The sheet for a card: its recordings, the newest first, with the new ones from the last day
 *  of flying ticked. */
export function showCard(track, card) {
  const name = trackName(track);
  const ticked = new Set(tickedAtFirst(card.recordings));
  let close = () => {};
  const add = primary("", () => {
    close();
    act.addFromCard(track, card.recordings.filter((recording) => ticked.has(recording.path)).map((recording) => recording.path));
  }, { "data-default": true, probe: "card add" });
  const count = () => {
    add.replaceChildren(ticked.size === 0 ? "Add" : `Add ${some(ticked.size, "recording", "recordings")}`);
    add.disabled = ticked.size === 0;
  };
  const rows = card.recordings.map((recording) => {
    const here = recording.in === track;
    const box = h("input", { type: "checkbox", checked: ticked.has(recording.path), disabled: here, onchange: () => {
      if (box.checked) ticked.add(recording.path);
      else ticked.delete(recording.path);
      count();
    } });
    return h(`label.card-recording${here ? ".here" : ""}`, { "data-probe": "card recording" },
      box,
      h("div.file-words", h("div.file-name", recording.name), h("div.file-detail", `${recording.size} · ${when(recording.modified)}`)),
      h("span.spacer"),
      recording.in && h("span.faint.small", here ? `Already in ${name}` : `Already in ${recording.in}`),
    );
  });
  const fresh = freshOn(card);
  count();
  close = showSheet(h("div.card-sheet",
    h("div.card-sheet-title", icon("film"), `Add to ${name} from ${card.name}`),
    h("p.dim.small", `${some(card.recordings.length, "recording", "recordings")} on it, ${fresh === 0 ? "all of them in your library already" : `${fresh} of them not in your library yet`}. The ones you tick are copied in, and the card is left as it is.`),
    h("div.card-recordings", rows),
    h("div.sheet-buttons", h("span.spacer"), secondary("Cancel", () => close()), add),
  ), { onEscape: () => close() });
}

/** What Add clips does: with a card plugged in it asks where from, and without one it goes
 *  straight to choosing files. */
export function addClips(track, button) {
  const cards = cardsFor(track);
  if (cards.length === 0) return act.chooseClips(track);
  menu(button, [
    ...cards.map((card) => ({ title: `From ${card.name}: ${some(card.recordings.length, "recording", "recordings")}${freshOn(card) > 0 ? `, ${freshOn(card)} new` : ""}…`, action: () => showCard(track, card) })),
    "-",
    { title: "Choose files…", action: () => act.chooseClips(track) },
  ]);
}

/** The line on a track's page when a card has recordings the library hasn't got. */
export function cardNote(track) {
  const cards = cardsFor(track).filter((card) => freshOn(card) > 0);
  if (cards.length === 0) return null;
  return cards.map((card) => h("div.card-note", { "data-probe": "card note" },
    icon("download", 15),
    h("span.grow", h("strong", card.name), ` is plugged in, with ${some(freshOn(card), "recording that isn't", "recordings that aren't")} in your library yet.`),
    primary("Add from the card…", () => showCard(track, card), { disabled: Boolean(app.state.job), probe: "card open" }),
  ));
}
