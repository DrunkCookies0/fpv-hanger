// A track's entry form, which is a Google Form: reading its questions from its page, knowing which
// of them the app can answer by itself, and filling the form in. The pilot presses Submit.

import { zoned } from "./series.js";

/** What kind of answer a question takes. */
const kinds = { 0: "text", 1: "paragraph", 2: "choice", 4: "checkboxes" };

/** What the app can answer on its own: the pilot's handle, their number, the lap time, the video's link. */
export function roleOf(question) {
  // Only something typed can be one of these. Without this, every multiple-choice question that
  // mentions a lap time was taken for the lap time itself.
  if (question.kind !== "text" && question.kind !== "paragraph") return null;
  const text = question.title.toLowerCase();
  if (text.includes("pilot handle") || text.includes("pilot name")) return "handle";
  if (text.includes("registration number")) return "number";
  if (text.includes("youtube") && text.includes("link")) return "link";
  if (text.includes("lap time") || (text.includes("fastest") && text.includes("consecutive"))) return "time";
  return null;
}

/** Reads the question list Google Forms embeds in its page. Null when the page isn't a form. */
export function parseForm(html, now = new Date()) {
  const start = html.indexOf("FB_PUBLIC_LOAD_DATA_ = ");
  if (start < 0) return null;
  const from = start + "FB_PUBLIC_LOAD_DATA_ = ".length;
  const end = html.indexOf(";</script>", from);
  if (end < 0) return null;
  let root;
  try {
    root = JSON.parse(html.slice(from, end));
  } catch {
    return null;
  }
  if (!Array.isArray(root) || root.length < 2 || !Array.isArray(root[1])) return null;
  const info = root[1];
  const questions = [];
  let deadlineText = null;
  for (const item of Array.isArray(info[1]) ? info[1] : []) {
    if (!Array.isArray(item)) continue;
    const title = typeof item[1] === "string" ? item[1] : "";
    const entry = Array.isArray(item[4]) ? item[4][0] : null;
    if (!Array.isArray(entry) || !Number.isInteger(entry[0])) {
      if (title.toLowerCase().includes("deadline")) deadlineText = title;
      continue;
    }
    const options = (Array.isArray(entry[1]) ? entry[1] : []).map((option) => (Array.isArray(option) ? option[0] : null)).filter((option) => typeof option === "string" && option !== "");
    const question = { id: String(entry[0]), title, kind: kinds[item[3]] ?? "other", required: entry[2] === 1, options };
    question.role = roleOf(question);
    questions.push(question);
  }
  return {
    title: typeof info[8] === "string" ? info[8] : "Submission form",
    description: typeof info[0] === "string" ? info[0] : "",
    deadlineText,
    deadline: deadlineText ? parseDeadline(deadlineText, now) : null,
    questions,
  };
}

const monthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const zones = {
  pst: "America/Los_Angeles", pdt: "America/Los_Angeles", pt: "America/Los_Angeles", mst: "America/Denver", mdt: "America/Denver",
  cst: "America/Chicago", cdt: "America/Chicago", est: "America/New_York", edt: "America/New_York", et: "America/New_York", utc: "UTC", gmt: "UTC",
};

/** Finds a date such as "Sunday, October 11th at 11:59:59pm PST" in a line of text. */
export function parseDeadline(text, now = new Date()) {
  const found = new RegExp(`(${monthNames.join("|")})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(?:at\\s+)?(\\d{1,2}):(\\d{2})(?::(\\d{2}))?\\s*(am|pm)\\s*([a-z]{2,4})?`, "i").exec(text);
  if (!found) return null;
  const month = monthNames.indexOf(found[1].toLowerCase());
  let hour = Number(found[3]);
  const half = found[6].toLowerCase();
  if (half === "pm" && hour < 12) hour += 12;
  if (half === "am" && hour === 12) hour = 0;
  const zone = zones[(found[7] ?? "").toLowerCase()] ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const year = Number(new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric" }).format(now));
  const at = (which) => zoned(which, month + 1, Number(found[2]), hour, Number(found[4]), Number(found[5] ?? 0), zone);
  // No year is given: a date long gone means next year's.
  const date = at(year);
  return date - now < -200 * 86400 * 1000 ? at(year + 1) : date;
}

/**
 * The script that fills in a Google Form open in a web view. `answers` maps a question's id to its
 * answers. It returns how many questions it filled.
 */
export function fillScript(answers, email) {
  return `(function (data) {
  const setValue = (el, value) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  let filled = 0;
  document.querySelectorAll('div[role="listitem"]').forEach(item => {
    const holder = item.querySelector('[data-params]');
    const match = holder && holder.getAttribute('data-params').match(/\\[\\[(\\d+),/);
    if (!match || !(match[1] in data.answers)) return;
    const values = data.answers[match[1]];
    if (!values.length) return;
    const radios = item.querySelectorAll('[role="radio"]'), checks = item.querySelectorAll('[role="checkbox"]');
    if (radios.length) radios.forEach(r => { if (values.includes(r.getAttribute('data-value')) && r.getAttribute('aria-checked') !== 'true') r.click(); });
    else if (checks.length) checks.forEach(c => { const want = values.includes(c.getAttribute('data-answer-value')); if (want !== (c.getAttribute('aria-checked') === 'true')) c.click(); });
    else { const field = item.querySelector('textarea, input[type="text"]'); if (field) setValue(field, values[0]); }
    filled += 1;
  });
  if (data.email) { const e = document.querySelector('input[type="email"]'); if (e) setValue(e, data.email); }
  return filled;
})(${JSON.stringify({ answers, email })});`;
}

/** Something@something.something, with no spaces. Enough to catch a slip, not to judge an address. */
export function looksLikeEmail(text) {
  const typed = text.trim();
  const parts = typed.split("@");
  if (parts.length !== 2 || parts[0] === "" || typed.includes(" ")) return false;
  const dot = parts[1].lastIndexOf(".");
  return dot > 0 && dot < parts[1].length - 1;
}

export function looksLikeYouTube(text) {
  try {
    const host = new URL(text.trim()).host.toLowerCase();
    return host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com");
  } catch {
    return false;
  }
}

/** The form's own address, when a link is one, as the app works with it. */
export function isFormAddress(address) {
  try {
    const url = new URL(address.trim());
    return url.protocol === "https:" && ((url.host === "docs.google.com" && url.pathname.includes("/forms/")) || url.host === "forms.gle");
  } catch {
    return false;
  }
}
