// The small pieces every page is put together from: an element maker, the icons, and the buttons,
// cards and labels that look the same everywhere.

/**
 * Makes an element. `tag` can carry classes: "div.card.wide". `props` (optional) are attributes,
 * with a few that mean more: `on<event>` listens, `style` takes an object, `class` adds classes,
 * `help` is the text shown when the pointer rests on it. Children are elements, text, or lists of
 * them. Nothing, false and null are left out, so `condition && element` reads well.
 */
export function h(tag, props, ...children) {
  const [name, ...classes] = tag.split(".");
  const element = document.createElement(name || "div");
  if (classes.length > 0) element.className = classes.join(" ");
  if (props !== null && typeof props === "object" && !(props instanceof Node) && !Array.isArray(props)) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key.startsWith("on") && typeof value === "function") element.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === "style" && typeof value === "object") Object.assign(element.style, value);
      else if (key === "class") element.classList.add(...String(value).split(/\s+/).filter(Boolean));
      else if (key === "help") element.title = value;
      else if (key === "key") element.dataset.key = value;
      else if (key === "probe") element.dataset.probe = value;
      else if (key === "html") element.innerHTML = value;
      else if (key in element && key !== "list" && key !== "form") element[key] = value;
      else element.setAttribute(key, value === true ? "" : value);
    }
  } else {
    children.unshift(props);
  }
  add(element, children);
  return element;
}

function add(element, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false || child === true) continue;
    if (Array.isArray(child)) add(element, child);
    else element.append(child instanceof Node ? child : String(child));
  }
}

/** Replaces everything inside an element. */
export function fill(element, ...children) {
  element.replaceChildren();
  add(element, children);
  return element;
}

/** Replaces everything inside an element, leaving the keyboard where it was: in the box with the
 *  same `key`, with the same text selected. */
export function redraw(element, ...children) {
  const active = document.activeElement;
  const key = active && element.contains(active) ? active.dataset.key : null;
  const selection = key && typeof active.selectionStart === "number" ? [active.selectionStart, active.selectionEnd] : null;
  fill(element, ...children);
  if (!key) return element;
  const again = element.querySelector(`[data-key="${CSS.escape(key)}"]`);
  if (!again) return element;
  again.focus({ preventScroll: true });
  if (selection) {
    try {
      again.setSelectionRange(...selection);
    } catch {}
  }
  return element;
}

// Icons. Drawn on a 24 by 24 grid as outlines two units thick, unless they say otherwise.
const line = (d) => `<path d="${d}"/>`;
const solid = (d) => `<path d="${d}" fill="currentColor" stroke="none"/>`;
const drawings = {
  chevronLeft: line("M15 5l-7 7 7 7"),
  chevronRight: line("M9 5l7 7-7 7"),
  chevronDown: line("M5 9l7 7 7-7"),
  arrowRight: line("M4 12h15M13 6l6 6-6 6"),
  arrowUpRight: line("M7 17L17 7M8 7h9v9"),
  plus: line("M12 5v14M5 12h14"),
  check: line("M5 12.5l4.5 4.5L19 7.5"),
  close: line("M6 6l12 12M18 6L6 18"),
  book: line("M12 6.5C10 5 7.5 4.5 4 4.5v13c3.5 0 6 .5 8 2 2-1.500 4.500-2 8-2v-13c-3.500 0-6 .5-8 2zM12 6.500v13"),
  gear: '<circle cx="12" cy="12" r="8" stroke-width="3.4" stroke-dasharray="3.2 3.083" stroke-linecap="butt"/><circle cx="12" cy="12" r="6.3"/><circle cx="12" cy="12" r="2.4"/>',
  personPlus: '<circle cx="10" cy="8" r="3.500"/>' + line("M3.500 20c.6-3.600 3.100-5.800 6.500-5.800 1.800 0 3.300.6 4.500 1.700M19 12.500v6M16 15.500h6"),
  film: '<rect x="3" y="4.500" width="18" height="15" rx="2.500"/>' + line("M7.500 4.500v15M16.500 4.500v15M3 9.500h4.500M3 14.500h4.500M16.500 9.500H21M16.500 14.500H21"),
  picture: '<rect x="3" y="4.500" width="18" height="15" rx="2.500"/><circle cx="8.500" cy="9.500" r="1.600" fill="currentColor" stroke="none"/>' + line("M4 17.500l4.800-4.800 3.200 3.200 2.800-2.800 5.200 5.200"),
  cube: line("M12 3l8 4.500v9L12 21l-8-4.500v-9zM4 7.500l8 4.500 8-4.500M12 12v9"),
  filmStack: '<rect x="5" y="8" width="16" height="12" rx="2"/>' + line("M3 15V6a2 2 0 012-2h11M9 8v12M17 8v12"),
  listNumber: line("M10.500 6.500H20M10.500 12H20M10.500 17.500H20") + '<g stroke-width="1.500">' + line("M4.300 5.100l1.400-.9v5M3.900 11.300c.4-1.200 2.800-1.100 2.800.3 0 1.100-2.800 1.600-2.800 2.800h2.900M3.900 16.300h2.700l-1.600 1.800c1.800-.2 2.100 2.300.2 2.400-.7 0-1.200-.3-1.500-.8") + "</g>",
  upload: line("M12 15V3.500M8 7l4-4 4 4M7 10.500H5.500A1.500 1.500 0 004 12v7a1.500 1.500 0 001.500 1.500h13A1.500 1.500 0 0020 19v-7a1.500 1.500 0 00-1.500-1.500H17"),
  download: line("M12 3.500V15M8 11.500l4 4 4-4M7 9H5.500A1.500 1.500 0 004 10.500v8A1.500 1.500 0 005.500 20h13a1.500 1.500 0 001.500-1.500v-8A1.500 1.500 0 0018.500 9H17"),
  folderPlus: line("M3.500 7.500a2 2 0 012-2h3.700l2 2.300h7.300a2 2 0 012 2V17a2 2 0 01-2 2h-13a2 2 0 01-2-2zM12 11v5M9.500 13.500h5"),
  trash: line("M4.500 7h15M9.500 7V4.500h5V7M6.500 7l.8 12a1.500 1.500 0 001.500 1.400h6.400a1.500 1.500 0 001.500-1.400l.8-12M10 10.500V17M14 10.500V17"),
  warning: '<path fill="currentColor" stroke="none" fill-rule="evenodd" d="M12 3a1.700 1.700 0 011.500.9l8 14.200a1.700 1.700 0 01-1.500 2.500H4a1.700 1.700 0 01-1.500-2.500l8-14.200A1.700 1.700 0 0112 3zm-1 6v5.500h2V9zm0 7.300v2h2v-2z"/>',
  checkCircle: '<circle cx="12" cy="12" r="9.500" fill="currentColor" stroke="none"/><path d="M7.500 12.400l3.100 3.100 5.900-6.300" stroke="var(--knock, #16191e)" stroke-width="2.200"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  seal: '<circle cx="12" cy="12" r="8.200" fill="currentColor" stroke="currentColor" stroke-width="3" stroke-dasharray="0.100 4.190" stroke-linecap="round"/><circle cx="12" cy="12" r="8.600" fill="currentColor" stroke="none"/><path d="M7.800 12.300l2.900 2.900 5.500-5.900" stroke="var(--knock, #16191e)" stroke-width="2.200"/>',
  music: line("M9 18V6l10-2v11") + '<circle cx="6.500" cy="18" r="2.500" fill="currentColor"/><circle cx="16.500" cy="15" r="2.500" fill="currentColor"/>',
  copies: '<rect x="8" y="8" width="12" height="12" rx="2"/>' + line("M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"),
  landscape: '<rect x="2.500" y="6" width="19" height="12" rx="2" fill="currentColor" stroke="none"/>',
  portrait: '<rect x="6.500" y="2.500" width="11" height="19" rx="2" fill="currentColor" stroke="none"/>',
  timer: '<circle cx="12" cy="13.500" r="7.500"/>' + line("M12 13.500V9.500M9.500 2.800h5M12 2.800V6"),
  play: solid("M7 4.500v15a.6.6 0 00.9.5l12-7.500a.6.6 0 000-1l-12-7.500a.6.6 0 00-.9.5z"),
  pause: solid("M6 4.500h4v15H6zM14 4.500h4v15h-4z"),
  speaker: solid("M4 9.500v5h3.500l4.500 4v-13l-4.500 4z") + line("M15.500 9a4.200 4.200 0 010 6M18 6.500a8 8 0 010 11"),
  waveform: line("M3 12v0M6.500 9v6M10 5v14M13.500 8v8M17 3.500v17M20.500 10v4"),
  scope: '<circle cx="12" cy="12" r="7.500"/>' + line("M12 2v4M12 18v4M2 12h4M18 12h4"),
  skipBack: solid("M5.500 5H8v14H5.500zM19 5.600v12.800a.6.6 0 01-.950.490l-8.900-6.400a.6.6 0 010-.980l8.900-6.400a.6.6 0 01.950.490z"),
  skipForward: solid("M16 5h2.500v14H16zM5 5.600v12.800a.6.6 0 00.950.490l8.900-6.400a.6.6 0 000-.980l-8.900-6.400A.6.6 0 005 5.600z"),
  frameBack: solid("M17 5h2.500v14H17zM14.500 5.600v12.800a.6.6 0 01-.950.490l-8.900-6.400a.6.6 0 010-.980l8.900-6.400a.6.6 0 01.950.490z"),
  frameForward: solid("M4.500 5H7v14H4.500zM9.500 5.600v12.800a.6.6 0 00.950.490l8.900-6.400a.6.6 0 000-.980l-8.900-6.400a.6.6 0 00-.950.490z"),
  zoomIn: '<circle cx="10.500" cy="10.500" r="6.500"/>' + line("M15.500 15.500L20 20M10.500 7.800v5.400M7.800 10.500h5.400"),
  zoomOut: '<circle cx="10.500" cy="10.500" r="6.500"/>' + line("M15.500 15.500L20 20M7.800 10.500h5.400"),
  diamond: solid("M12 3l7 9-7 9-7-9z"),
  triangleUp: solid("M12 5l8 14H4z"),
};

/** An icon, as big as the text around it unless a size is given. */
export function icon(name, size = null, props = {}) {
  const holder = h("span.icon", props);
  if (size !== null) holder.style.fontSize = `${size}px`;
  holder.innerHTML = `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${drawings[name] ?? ""}</svg>`;
  return holder;
}

/** The small capitals over a card or a group. */
export const label = (text, ...more) => h("div.label", text, ...more);

function button(kind, title, action, props = {}) {
  const { icon: picture = null, ...rest } = props;
  return h(`button.button.${kind}`, { type: "button", onclick: action, ...rest }, picture && icon(picture), title);
}

/** The yellow call-to-action button. */
export const primary = (title, action, props) => button("primary", title, action, props);
/** The quiet outlined button. */
export const secondary = (title, action, props) => button("secondary", title, action, props);
/** A button that is only its words or its icon. */
export const plain = (title, action, props) => button("plain", title, action, props);

export const comingSoonBadge = () => h("span.badge.soon", "COMING SOON");
export const testCopyBadge = () => h("span.badge.test", { help: "A copy for trying changes before they are released. It doesn't update itself." }, "TEST COPY");

/** A text box with its name above it. */
export function field(title, value, onInput, props = {}) {
  const { required = false, width = null, ...rest } = props;
  const { class: classes = null, ...more } = rest;
  const input = h("input.field.answer-field", { type: "text", value, spellcheck: false, oninput: () => onInput(input.value), ...more });
  const holder = h("label.answer", { class: classes }, h("span.question", title, required && h("span.required", "  required")), input);
  if (width !== null) holder.style.width = `${width}px`;
  return holder;
}

/** Text with **bold** and `code` in it, as the changelog is written. */
export function marked(text) {
  const parts = [];
  for (const piece of text.split(/(\*\*[^*]+\*\*|`[^`]+`)/)) {
    if (piece.startsWith("**") && piece.endsWith("**")) parts.push(h("strong", piece.slice(2, -2)));
    else if (piece.startsWith("`") && piece.endsWith("`")) parts.push(h("code", piece.slice(1, -1)));
    else if (piece !== "") parts.push(piece);
  }
  return parts;
}

/** A moment in words: "Today at 4:53 PM", "Yesterday at 9:10 AM", "8 Oct 2026 at 2:15 PM". */
export function when(moment) {
  const date = new Date(moment), now = new Date();
  const day = (one) => new Date(one.getFullYear(), one.getMonth(), one.getDate()).getTime();
  const days = Math.round((day(now) - day(date)) / 86400000);
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (days === 0) return `Today at ${time}`;
  if (days === 1) return `Yesterday at ${time}`;
  return `${date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} at ${time}`;
}
