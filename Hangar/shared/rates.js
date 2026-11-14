// Rates: how far the stick is pushed turns into how fast the quad turns, in each of Betaflight's
// five rate types, and the same feel written in another of them. The arithmetic is the one
// Betaflight's firmware does, written here from its formulas. Nothing here touches a page, so it
// can be tested by itself.
//
// A setting is kept as the CLI keeps it, three whole numbers for each axis: `rc` (roll_rc_rate),
// `srate` (roll_srate) and `expo` (roll_expo). What each means depends on the rate type: in Actual,
// rc 7 is a center sensitivity of 70 degrees a second; in Betaflight, rc 100 is an RC Rate of 1.00.

export const axes = ["roll", "pitch", "yaw"];

/** However the rates are set, Betaflight never turns faster than this: degrees a second. */
export const ceiling = 1998;

/** Betaflight's own step for an RC Rate above 2.00, which climbs much faster from there. */
const steeper = 14.54;

/**
 * The rate types, in the order Betaflight lists them. Each has its three settings as Betaflight's
 * app shows them: a name, how a whole number in the CLI becomes what is shown (`per`), the unit,
 * and the most the app lets it be set to.
 */
export const types = {
  BETAFLIGHT: {
    title: "Betaflight",
    fields: {
      rc: { name: "RC Rate", per: 0.01, max: 255 },
      srate: { name: "Super Rate", per: 0.01, max: 100 },
      expo: { name: "RC Expo", per: 0.01, max: 100 },
    },
  },
  RACEFLIGHT: {
    title: "Raceflight",
    fields: {
      rc: { name: "Rate", per: 10, unit: "°/s", max: 200 },
      srate: { name: "Acro+", per: 1, max: 255 },
      expo: { name: "Expo", per: 1, max: 100 },
    },
  },
  KISS: {
    title: "KISS",
    fields: {
      rc: { name: "RC Rate", per: 0.01, max: 255 },
      srate: { name: "Rate", per: 0.01, max: 99 },
      expo: { name: "RC Curve", per: 0.01, max: 100 },
    },
  },
  ACTUAL: {
    title: "Actual",
    fields: {
      rc: { name: "Center Sensitivity", per: 10, unit: "°/s", max: 200 },
      srate: { name: "Max Rate", per: 10, unit: "°/s", max: 200 },
      expo: { name: "Expo", per: 0.01, max: 100 },
    },
  },
  QUICK: {
    title: "Quick",
    fields: {
      rc: { name: "RC Rate", per: 0.01, max: 255 },
      srate: { name: "Max Rate", per: 10, unit: "°/s", max: 200 },
      expo: { name: "Expo", per: 0.01, max: 100 },
    },
  },
};

export const typeNames = Object.keys(types);
export const settingNames = ["rc", "srate", "expo"];

/** The least each setting may be: an RC Rate (or center, or rate) of nothing would never turn. */
const least = { rc: 1, srate: 0, expo: 0 };

const within = (value, low, high) => Math.min(high, Math.max(low, value));

/** A setting as Betaflight's app shows it: "1.00", "670", "0.54". */
export function shown(type, name, value) {
  const { per } = types[type].fields[name];
  const amount = value * per;
  return per < 1 ? amount.toFixed(2) : String(Math.round(amount));
}

/** What the pilot typed for a setting, as the CLI's whole number, kept to what the app allows.
 *  Null when it isn't a number. */
export function fromShown(type, name, text) {
  const amount = Number(String(text ?? "").trim().replace(",", "."));
  if (String(text ?? "").trim() === "" || !Number.isFinite(amount)) return null;
  const { per, max } = types[type].fields[name];
  return within(Math.round(amount / per), least[name], max);
}

/**
 * How fast the quad is asked to turn with the stick pushed `stick` of the way (-1 to 1), in degrees
 * a second. `setting` is one axis's `{ rc, srate, expo }`, with its `limit` when it has one.
 * `quickExpo` is Quick's quickrates_rc_expo. As Betaflight does it in src/main/fc/rc.c.
 */
export function rateAt(type, setting, stick, quickExpo = false) {
  const s = Math.min(1, Math.abs(stick));
  const rate = Math.min(curve(type, setting, s, quickExpo), setting.limit ?? ceiling, ceiling);
  return stick < 0 ? -rate : rate;
}

/** The turn rate for a stick pushed `s` of the way, from 0 to 1. */
function curve(type, { rc, srate, expo }, s, quickExpo) {
  const e = expo / 100;
  switch (type) {
    case "BETAFLIGHT": {
      const pushed = e ? s * s * s * s * e + s * (1 - e) : s;
      let r = rc / 100;
      if (r > 2) r += steeper * (r - 2);
      const rate = 200 * r * pushed;
      return srate ? rate / within(1 - s * (srate / 100), 0.01, 1) : rate;
    }
    case "RACEFLIGHT": {
      const pushed = (1 + 0.01 * expo * (s * s - 1)) * s;
      return 10 * rc * pushed * (1 + s * srate * 0.01);
    }
    case "KISS": {
      const boost = 1 / within(1 - s * (srate / 100), 0.01, 1);
      return Math.min(ceiling, 2000 * boost * (s * s * s * e + s * (1 - e)) * (rc / 1000));
    }
    case "ACTUAL": {
      const shaped = s * (s ** 5 * e + s * (1 - e));
      const center = rc * 10;
      return s * center + Math.max(0, srate * 10 - center) * shaped;
    }
    case "QUICK": {
      const center = rc * 2;
      if (center <= 0) return 0;
      const top = Math.max(srate * 10, center);
      const reach = (top / center - 1) / (top / center);
      const shaped = s * s * s * e + s * (1 - e);
      if (quickExpo) return Math.min(ceiling, (shaped * center) / within(1 - s * reach, 0.01, 1));
      return Math.min(ceiling, (s * center) / within(1 - shaped * reach, 0.01, 1));
    }
    default:
      return 0;
  }
}

/** The turn rate at full stick. */
export const topOf = (type, setting, quickExpo = false) => rateAt(type, setting, 1, quickExpo);

/** How quickly the turn rate grows round the middle of the stick: the degrees a second it would
 *  reach at full stick if it went on growing that way. Betaflight's app calls it center sensitivity. */
export const centerOf = (type, setting, quickExpo = false) => rateAt(type, setting, 0.001, quickExpo) / 0.001;

// ---- The same feel in another type

/** Where along the stick two curves are compared: 0, 2%, 4% … full stick. */
const steps = 50;
const sticks = Array.from({ length: steps + 1 }, (_, index) => index / steps);

/** The least a point's turn is taken to be, as a share of the fastest, so the very middle of the
 *  stick, where almost no turn is wanted, doesn't count without end. */
const share = 0.25;

/**
 * How much each point counts when two curves are compared. A miss counts for what it is beside the
 * turn wanted there, so 20°/s off round the middle of the stick, where 70°/s is wanted, counts for
 * far more than 20°/s off at full stick: that is how it feels. Full stick counts as much as half of
 * all the rest besides, so the fastest turn comes out the same.
 */
function weightsFor(wanted) {
  const top = Math.max(1, Math.abs(wanted.at(-1)));
  const weights = wanted.map((value) => (top / (Math.abs(value) + share * top)) ** 2);
  weights[weights.length - 1] = weights.slice(0, -1).reduce((sum, one) => sum + one, 0) / 2;
  return weights;
}

function misfit(type, setting, wanted, weights, quickExpo) {
  let total = 0;
  for (let index = 0; index < sticks.length; index += 1) {
    const off = rateAt(type, setting, sticks[index], quickExpo) - wanted[index];
    total += weights[index] * off * off;
  }
  return total;
}

/** The best number for something that scales a curve: Σwgt / Σwg². */
function scaleFor(shape, wanted, weights) {
  let over = 0, under = 0;
  for (let index = 0; index < sticks.length; index += 1) {
    over += weights[index] * shape[index] * wanted[index];
    under += weights[index] * shape[index] * shape[index];
  }
  return under > 0 ? over / under : 0;
}

/** The whole numbers on either side of a value, kept to a range. */
const either = (value, low, high) => [...new Set([Math.floor(value), Math.ceil(value)].map((one) => within(Number.isFinite(one) ? one : low, low, high)))];

/**
 * The setting in `type` whose curve is nearest `wanted` (the turn rate at each of `sticks`), for an
 * axis whose rate limit is `limit`. Every pair of the two settings that shape the curve is tried,
 * and the third, which scales it, is worked out from them; so the answer is the nearest there is.
 */
function nearest(type, wanted, limit) {
  const { fields } = types[type];
  const weights = weightsFor(wanted);
  let best = null;
  const consider = (setting) => {
    const full = { ...setting, limit };
    const off = misfit(type, full, wanted, weights, false);
    if (!best || off < best.off - 1e-9) best = { setting, off };
  };
  const shape = new Array(sticks.length);
  if (type === "BETAFLIGHT" || type === "KISS" || type === "RACEFLIGHT") {
    // The curve grows with rc in step, so for each srate and expo the best rc is worked out.
    for (let srate = 0; srate <= fields.srate.max; srate += 1) {
      for (let expo = 0; expo <= fields.expo.max; expo += 1) {
        const unit = type === "BETAFLIGHT" ? 100 : type === "KISS" ? 100 : 1;
        for (let index = 0; index < sticks.length; index += 1) shape[index] = curve(type, { rc: unit, srate, expo }, sticks[index], false);
        let rc = scaleFor(shape, wanted, weights) * unit;
        // Above 2.00, Betaflight's RC Rate climbs faster: undo that to find the number to set.
        if (type === "BETAFLIGHT" && rc > 200) rc = (100 * (rc / 100 + steeper * 2)) / (1 + steeper);
        for (const one of either(rc, least.rc, fields.rc.max)) consider({ rc: one, srate, expo });
      }
    }
  } else if (type === "ACTUAL") {
    // For each center and expo, the best max rate is worked out.
    for (let expo = 0; expo <= fields.expo.max; expo += 1) {
      const e = expo / 100;
      for (let index = 0; index < sticks.length; index += 1) {
        const s = sticks[index];
        shape[index] = s * (s ** 5 * e + s * (1 - e));
      }
      for (let rc = least.rc; rc <= fields.rc.max; rc += 1) {
        const rest = wanted.map((value, index) => value - sticks[index] * rc * 10);
        const more = Math.max(0, scaleFor(shape, rest, weights));
        for (const srate of either(rc + more / 10, 0, fields.srate.max)) consider({ rc, srate, expo });
      }
    }
  } else if (type === "QUICK") {
    // Quick's max rate is the turn at full stick, so it is the one wanted there.
    const top = Math.round(Math.min(wanted.at(-1), ceiling) / 10);
    const tops = [...new Set([top - 1, top, top + 1].map((one) => within(one, 0, fields.srate.max)))];
    for (let expo = 0; expo <= fields.expo.max; expo += 1) {
      for (let rc = least.rc; rc <= fields.rc.max; rc += 1) {
        for (const srate of tops) consider({ rc, srate, expo });
      }
    }
  }
  return best.setting;
}

/**
 * The same rates in another type: for each axis, the setting whose curve is nearest. `from` is
 * `{ type, axes: { roll, pitch, yaw }, quickExpo }`, each axis `{ rc, srate, expo, limit }`.
 * Gives `{ type, axes, quickExpo: false, off }`, with `off` the furthest the new curve strays from
 * the old anywhere along the stick, in degrees a second, for each axis.
 */
export function convert(from, type) {
  const found = { type, axes: {}, quickExpo: false, off: {} };
  const done = new Map();
  for (const axis of axes) {
    const setting = from.axes[axis];
    const limit = setting.limit ?? ceiling;
    const wanted = sticks.map((s) => rateAt(from.type, setting, s, from.quickExpo));
    // Roll and pitch are often the same: worked out once.
    const key = JSON.stringify([setting.rc, setting.srate, setting.expo, limit]);
    if (from.type === type && !from.quickExpo) done.set(key, { rc: setting.rc, srate: setting.srate, expo: setting.expo });
    if (!done.has(key)) done.set(key, nearest(type, wanted, limit));
    found.axes[axis] = { ...done.get(key), limit };
    found.off[axis] = strays(from, found, axis);
  }
  return found;
}

/** The furthest two settings' curves are apart for one axis, anywhere along the stick. */
export function strays(one, other, axis) {
  let most = 0;
  for (let index = 0; index <= 200; index += 1) {
    const s = index / 200;
    most = Math.max(most, Math.abs(rateAt(one.type, one.axes[axis], s, one.quickExpo) - rateAt(other.type, other.axes[axis], s, other.quickExpo)));
  }
  return most;
}

// ---- Betaflight's CLI

/** What Betaflight sets when a rate profile has been left as it came: Actual since 4.3, and
 *  Betaflight's own type before that. */
export function defaultsFor(version) {
  const [major, minor] = /^\d+\.\d+/.test(String(version ?? "")) ? String(version).split(".").map(Number) : [];
  const older = major !== undefined && (major < 4 || (major === 4 && minor < 3));
  const axis = older ? { rc: 100, srate: 70, expo: 0, limit: ceiling } : { rc: 7, srate: 67, expo: 0, limit: ceiling };
  return { type: older ? "BETAFLIGHT" : "ACTUAL", quickExpo: false, axes: { roll: { ...axis }, pitch: { ...axis }, yaw: { ...axis } } };
}

const settingKey = /^(roll|pitch|yaw)_(rc_rate|srate|expo|rate_limit)$/;
const fieldOf = { rc_rate: "rc", srate: "srate", expo: "expo", rate_limit: "limit" };

/**
 * The rate profiles in what Betaflight's CLI printed: `diff all`, `dump`, `diff` or `get rate`.
 * A diff leaves out what is as it came, so each profile starts from the version's defaults. Gives
 * `{ version, profiles, active }`: each profile `{ index, name, type, quickExpo, axes }`, with
 * `index` null when the text didn't say which profile it was, and `active` the one the flight
 * controller had chosen. Null when there are no rates in it.
 */
export function readRates(text) {
  const lines = String(text ?? "").split(/\r?\n/).map((line) => line.trim());
  const version = lines.map((line) => /^#\s*(?:Betaflight|BTFL)\b.*?\s(\d+\.\d+(?:\.\d+)?)\b/i.exec(line)?.[1]).find(Boolean) ?? null;
  const profiles = new Map();
  let here = null, chosen = null, found = false;
  const profile = (index) => {
    if (!profiles.has(index)) profiles.set(index, { index, name: "", ...defaultsFor(version) });
    return profiles.get(index);
  };
  for (const line of lines) {
    const switched = /^rateprofile\s+(\d+)$/i.exec(line);
    if (switched) {
      here = Number(switched[1]);
      chosen = here;
      profile(here);
      continue;
    }
    const set = /^(?:set\s+)?([a-z_]+)\s*=\s*(.*?)\s*$/i.exec(line);
    if (!set || line.startsWith("#")) continue;
    const key = set[1].toLowerCase(), value = set[2];
    const axis = settingKey.exec(key);
    if (!axis && !["rates_type", "quickrates_rc_expo", "rateprofile_name"].includes(key)) continue;
    const into = profile(here);
    found = true;
    if (key === "rates_type") {
      const type = value.toUpperCase();
      if (Object.hasOwn(types, type)) into.type = type;
    } else if (key === "quickrates_rc_expo") into.quickExpo = /^(on|1)$/i.test(value);
    else if (key === "rateprofile_name") into.name = value;
    else if (/^\d+$/.test(value)) into.axes[axis[1]][fieldOf[axis[2]]] = Number(value);
  }
  if (!found && profiles.size === 0) return null;
  const list = [...profiles.values()].sort((a, b) => (a.index ?? -1) - (b.index ?? -1));
  // A profile named only by the restore line at the end of a `diff all`, with nothing set in it, is
  // still one of the four, as it came.
  return { version, profiles: list, active: chosen ?? list[0].index };
}

/** The CLI lines that set rates, in the order Betaflight writes them, ending with save. */
export function cliLines({ type, axes: settings, quickExpo = false }, profile = null) {
  const lines = [];
  if (profile !== null && profile !== undefined) lines.push(`rateprofile ${profile}`);
  lines.push(`set rates_type = ${type}`);
  if (type === "QUICK") lines.push(`set quickrates_rc_expo = ${quickExpo ? "ON" : "OFF"}`);
  for (const [field, key] of [["rc", "rc_rate"], ["expo", "expo"], ["srate", "srate"]]) {
    for (const axis of axes) lines.push(`set ${axis}_${key} = ${settings[axis][field]}`);
  }
  lines.push("save");
  return lines;
}
