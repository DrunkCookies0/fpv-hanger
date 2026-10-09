// What the RaceGOW series publishes, read without signing in to anything: its list of registered
// pilots, its schedule of tracks, and the entry form each track gets once it is open.
//
// The addresses are this season's. A new season needs them changed here.

export const season = "RaceGOW6";
export const idLabel = "RaceGOW ID";

/** The season's pilot list, a public sheet, as comma-separated text. */
export const pilotSheet = "https://docs.google.com/spreadsheets/d/152orGNZClpFnAY-tUZgHHl_BhbXsAaBa9wAys3-OvQw/export?format=csv";
/** The "RaceGOW6 Schedule" tab of the series' schedules sheet, as comma-separated text. */
export const scheduleSheet = "https://docs.google.com/spreadsheets/d/18J6211LR0P14YyPdt3seRBbw5T2Un2n5AIu6QjZ8Hi4/export?format=csv&gid=1662031070";
/** The pages that name each open track's form. */
export const formPages = ["https://www.racegow.com/submissions", "https://www.racegow.com/home"];
/** The schedule's times are the Pacific coast's. */
export const zone = "America/Los_Angeles";

/** The rows of comma-separated text, with a quoted cell taken whole, commas and all. */
export function rows(text) {
  const all = [];
  let row = [], cell = "", quoted = false;
  const characters = Array.from(text);
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if (quoted) {
      if (character === '"') {
        // Two in a row is one that belongs to the cell.
        if (characters[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && characters[index + 1] === "\n") index += 1;
      row.push(cell);
      all.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    all.push(row);
  }
  return all;
}

const same = (a, b) => a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;

/** The pilots in the list's text. Its columns are found by their headings, "Reg#" and "Pilot Name". */
export function pilotsIn(text) {
  const all = rows(text);
  const column = (wanted, row) => row.findIndex((cell) => same(cell.trim(), wanted));
  const top = all.findIndex((row) => column("Reg#", row) >= 0 && column("Pilot Name", row) >= 0);
  if (top < 0) return [];
  const numbers = column("Reg#", all[top]), names = column("Pilot Name", all[top]);
  const pilots = [];
  for (const row of all.slice(top + 1)) {
    if (!(row.length > Math.max(numbers, names))) continue;
    const number = row[numbers].trim(), name = row[names].trim();
    if (number !== "" && name !== "") pilots.push({ number, name });
  }
  return pilots;
}

/** Who a pilot name or a registration number could be: the one it names exactly, or failing that
 *  the few whose names have it in them. */
export function findPilots(asked, pilots) {
  const query = asked.trim();
  if (query === "") return [];
  const plain = (text) => Array.from(text.toLowerCase()).filter((character) => /[\p{L}\p{N}]/u.test(character)).join("");
  let found = pilots.filter((pilot) => same(pilot.name, query));
  // A number, with or without its # and its leading zeros, is a registration number. It can be
  // somebody's pilot name as well.
  const digits = query.startsWith("#") ? query.slice(1) : query;
  if (digits !== "" && /^\d+$/.test(digits)) {
    const number = Number(digits);
    return found.concat(pilots.filter((pilot) => /^\d+$/.test(pilot.number) && Number(pilot.number) === number && !found.includes(pilot)));
  }
  if (found.length > 0) return found;
  const wanted = plain(query);
  if (wanted.length < 2) return [];
  found = pilots.filter((pilot) => plain(pilot.name) === wanted);
  return found.length > 0 ? found : pilots.filter((pilot) => plain(pilot.name).includes(wanted)).slice(0, 8);
}

/** A moment given as a day and a time of day in a time zone. */
export function zoned(year, month, day, hour, minute, second, timeZone) {
  const wanted = Date.UTC(year, month - 1, day, hour, minute, second);
  const format = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
  // What the zone's clocks read at a moment, as if that reading were in universal time.
  const reads = (moment) => {
    const parts = Object.fromEntries(format.formatToParts(new Date(moment)).map((part) => [part.type, Number(part.value)]));
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  };
  // Twice, so a moment near a clock change settles on the right side of it.
  let moment = wanted;
  for (let pass = 0; pass < 2; pass += 1) moment += wanted - reads(moment);
  return new Date(moment);
}

const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A day as the schedule writes it, such as "October 9th" or "January 3rd, 2027", at a time of day
 *  on the Pacific coast. A day with no year is the one nearest to now. */
export function day(text, { hour, minute = 0, second = 0 }, now) {
  const found = /([A-Za-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i.exec(text);
  if (!found) return null;
  // By its first three letters, so a slip such as "Sepetember" still reads.
  const month = months.indexOf(found[1].toLowerCase().slice(0, 3));
  if (month < 0) return null;
  const date = (year) => zoned(year, month + 1, Number(found[2]), hour, minute, second, zone);
  if (found[3]) return date(Number(found[3]));
  const thisYear = Number(new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric" }).format(now));
  return [thisYear - 1, thisYear, thisYear + 1].map(date).reduce((best, one) => (Math.abs(one - now) < Math.abs(best - now) ? one : best));
}

/** The tracks in the schedule's text. Its columns are found by their headings, which run over two rows. */
export function tracksIn(text, now) {
  const all = rows(text);
  const top = all.findIndex((row) => {
    const cells = row.map((cell) => cell.toLowerCase());
    return cells.some((cell) => cell.includes("release")) && cells.some((cell) => cell.includes("deadline"));
  });
  if (top < 0) return [];
  const under = all[top + 1] ?? [];
  const headings = all[top].map((cell, index) => `${cell} ${under[index] ?? ""}`.toLowerCase());
  const column = (word) => headings.findIndex((heading) => heading.includes(word));
  const release = column("release"), deadline = column("deadline");
  if (release < 0 || deadline < 0) return [];
  const number = Math.max(0, column("number")), livestream = column("livestream"), sponsor = column("sponsor"), designer = column("designer");
  const cell = (row, index) => {
    if (index < 0 || index >= row.length) return null;
    const value = row[index].trim();
    return value === "" ? null : value;
  };
  const tracks = [];
  for (const row of all.slice(top + 1)) {
    const which = cell(row, number);
    const opens = cell(row, release) && day(cell(row, release), { hour: 9 }, now);
    const closes = cell(row, deadline) && day(cell(row, deadline), { hour: 23, minute: 59, second: 59 }, now);
    if (!which || !/^\d+$/.test(which) || !opens || !closes) continue;
    const streamed = cell(row, livestream), by = cell(row, designer);
    tracks.push({
      number: Number(which), release: opens, deadline: closes,
      livestream: streamed ? day(streamed, { hour: 12 }, now) : null,
      sponsor: cell(row, sponsor),
      designer: by && by.toLowerCase() !== "tbd" ? by : null,
      form: null,
    });
  }
  return tracks;
}

/** The submission form each track is given on a page of the series' site, by track number. The
 *  pages say "Track 1 … Submission Form = <link>", in pieces. */
export function formsIn(html) {
  // Each link's address is put into the text beside its words, then the markup comes out.
  let text = html.replace(/<a\b[^>]*href="([^"]+)"[^>]*>/g, " $1 ");
  text = text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ");
  text = text.replace(/<[^>]+>/g, " ");
  for (const [entity, plain] of [["&amp;", "&"], ["&nbsp;", " "], ["&#39;", "'"], ["&quot;", '"'], ["&lt;", "<"], ["&gt;", ">"]]) text = text.replaceAll(entity, plain);
  text = text.replace(/\s+/g, " ");
  const forms = new Map();
  // From a track's number to the first form named as its submission form, without running on into
  // the next track. The link's own address can stand between the words and the form's, when the
  // page sends it by way of Google.
  const pattern = /Track\s*(\d{1,2})\b((?:(?!Track\s*\d).){0,400}?)Submission\s+Form\b((?:(?!Track\s*\d).){0,300}?)(https:\/\/(?:forms\.gle\/[A-Za-z0-9]+|docs\.google\.com\/forms\/[^\s"'<>]+))/gis;
  for (const found of text.matchAll(pattern)) {
    const number = Number(found[1]);
    if (!forms.has(number)) forms.set(number, found[4]);
  }
  return forms;
}

async function textOf(address, fetcher) {
  const answer = await fetcher(address, { cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (!answer.ok) throw new Error(`the page answered ${answer.status}`);
  return answer.text();
}

/** A short forms.gle link followed to the form itself, which is the address the rest of the app works with. */
export async function resolved(address, fetcher = fetch) {
  let url;
  try {
    url = new URL(address);
  } catch {
    return address;
  }
  if (url.host !== "forms.gle") return address;
  try {
    const answer = await fetcher(address, { signal: AbortSignal.timeout(15000) });
    const final = new URL(answer.url);
    return final.host === "docs.google.com" && final.pathname.includes("/forms/") ? `https://docs.google.com${final.pathname}` : address;
  } catch {
    return address;
  }
}

/** Reads the list of registered pilots as it stands now. */
export async function readPilots(fetcher = fetch) {
  const pilots = pilotsIn(await textOf(pilotSheet, fetcher));
  if (pilots.length === 0) throw new Error("the list isn't laid out the way it used to be");
  return pilots;
}

/** Reads the schedule and the forms posted so far. */
export async function readSeason(now = new Date(), fetcher = fetch) {
  const tracks = tracksIn(await textOf(scheduleSheet, fetcher), now);
  if (tracks.length === 0) throw new Error("the schedule isn't laid out the way it used to be");
  const forms = new Map();
  for (const page of formPages) {
    try {
      for (const [number, link] of formsIn(await textOf(page, fetcher))) if (!forms.has(number)) forms.set(number, link);
    } catch {
      // One page not answering leaves the other.
    }
  }
  for (const track of tracks) if (forms.has(track.number)) track.form = await resolved(forms.get(track.number), fetcher);
  return tracks;
}

/** A moment the way the library's files hold it, which is also what the Mac app reads: no fractions of a second. */
export const stamp = (date) => date.toISOString().replace(/\.\d{3}Z$/, "Z");
