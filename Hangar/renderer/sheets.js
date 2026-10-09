// What comes up over the window: sheets (a note, the setup questions), the small questions with
// two buttons, and the menus under a right-click or a button.

import { h, primary, secondary } from "./ui.js";

const open = [];
const layer = () => document.getElementById("sheets");

/** Nothing under a sheet can be reached while it is up, by pointer or by keyboard. */
function settle() {
  const covered = open.length > 0;
  for (const id of ["stage", "status", "editor"]) document.getElementById(id)?.toggleAttribute("inert", covered);
  open.forEach((sheet, index) => sheet.backdrop.toggleAttribute("inert", index < open.length - 1));
}

/**
 * Shows something over the window, in the middle. Returns the function that closes it.
 * `onEscape` is what the Escape key does. Return key presses the button marked `default`.
 */
export function showSheet(content, { onEscape = null, small = false } = {}) {
  const body = h(`div.sheet${small ? ".small" : ""}`, { role: "dialog", "aria-modal": "true" }, content);
  const backdrop = h("div.backdrop", body);
  const sheet = { backdrop, onEscape };
  const close = () => {
    const index = open.indexOf(sheet);
    if (index < 0) return;
    open.splice(index, 1);
    backdrop.remove();
    settle();
  };
  sheet.close = close;
  backdrop.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && sheet.onEscape) {
      event.preventDefault();
      event.stopPropagation();
      sheet.onEscape();
    } else if (event.key === "Enter" && !event.isComposing && !["TEXTAREA", "BUTTON", "A"].includes(event.target.tagName)) {
      const button = body.querySelector("button[data-default]:not(:disabled)");
      if (button) {
        event.preventDefault();
        button.click();
      }
    } else if (event.key === "Tab") {
      // The keyboard stays inside the sheet.
      const stops = [...body.querySelectorAll("button, input, textarea, select, a[href], [tabindex]")].filter((one) => !one.disabled && one.tabIndex >= 0 && one.offsetParent !== null);
      if (stops.length === 0) return;
      const first = stops[0], last = stops.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  open.push(sheet);
  layer().append(backdrop);
  settle();
  // The first box to type in gets the keyboard, or failing that the sheet itself.
  const first = body.querySelector("[data-first], input:not([type=hidden]), textarea");
  body.tabIndex = -1;
  (first ?? body).focus({ preventScroll: true });
  return close;
}

export const sheetIsOpen = () => open.length > 0;

/** Closes every sheet, without doing what any of them is for. */
export function closeSheets() {
  for (const sheet of [...open]) sheet.close();
}

/**
 * A small question in the middle of the window. `buttons` are { title, value, kind } where kind is
 * "primary", "secondary" or "destructive"; the one with `cancel` is what Escape gives. With `field`
 * there is a box to type in, and the answer is { value, text }.
 */
export function question({ title, message = null, buttons, field = null }) {
  return new Promise((answer) => {
    const input = field ? h("input.field", { type: "text", placeholder: field.placeholder ?? "", value: field.value ?? "", spellcheck: false, "data-first": true }) : null;
    let close = () => {};
    const finish = (value) => {
      close();
      answer(field ? { value, text: input.value } : value);
    };
    const cancel = buttons.find((button) => button.cancel);
    const row = h("div.alert-buttons", buttons.map((button) => {
      const make = button.kind === "secondary" ? secondary : primary;
      const made = make(button.title, () => finish(button.value), button.kind === "destructive" ? { class: "destructive" } : {});
      if (button.default) made.dataset.default = "";
      return made;
    }));
    close = showSheet(h("div.alert", h("div.alert-title", title), message && h("div.alert-message", message), input, row), { onEscape: cancel ? () => finish(cancel.value) : null, small: true });
  });
}

/** Asks yes or no. True for yes. */
export function confirm({ title, message = null, yes, no = "Cancel", destructive = false }) {
  return question({ title, message, buttons: [{ title: no, value: false, kind: "secondary", cancel: true }, { title: yes, value: true, kind: destructive ? "destructive" : "primary", default: !destructive }] });
}

let showing = null;

/** A menu at the pointer, or under a button. `items` are { title, action, disabled } or "-" for a line. */
export function menu(at, items) {
  showing?.();
  const list = h("div.menu", { role: "menu" }, items.map((item) => (item === "-" ? h("div.menu-line") : h("button.menu-item", {
    type: "button", role: "menuitem", disabled: item.disabled,
    onclick: () => {
      shut();
      item.action();
    },
  }, item.title))));
  const shut = () => {
    list.remove();
    window.removeEventListener("pointerdown", outside, true);
    window.removeEventListener("keydown", key, true);
    window.removeEventListener("blur", shut);
    window.removeEventListener("resize", shut);
    showing = null;
  };
  const outside = (event) => { if (!list.contains(event.target)) shut(); };
  const key = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      shut();
    }
  };
  document.body.append(list);
  // Kept inside the window, opening upwards or leftwards when there is no room.
  const size = list.getBoundingClientRect();
  const point = at instanceof Element ? { x: at.getBoundingClientRect().left, y: at.getBoundingClientRect().bottom + 4 } : { x: at.clientX, y: at.clientY };
  list.style.left = `${Math.max(8, Math.min(point.x, window.innerWidth - size.width - 8))}px`;
  list.style.top = `${Math.max(8, point.y + size.height > window.innerHeight - 8 ? point.y - size.height - (at instanceof Element ? at.getBoundingClientRect().height + 8 : 0) : point.y)}px`;
  window.addEventListener("pointerdown", outside, true);
  window.addEventListener("keydown", key, true);
  window.addEventListener("blur", shut);
  window.addEventListener("resize", shut);
  showing = shut;
  list.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
}
