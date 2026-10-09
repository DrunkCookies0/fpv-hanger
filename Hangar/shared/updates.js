// Which packaged version is the newest, as the file attached to each release says it.
//
// The file is latest.json. The Mac app before this one reads `version`, `file`, `sha256` and
// `notes` from it, so those stay what they were: the Mac's archive. Windows has its own beside them.
//
//   { "version": "0.13.0", "file": "FPV-Hangar-v0.13.0-mac.zip", "sha256": "…", "notes": "…",
//     "windows": { "file": "FPV-Hangar-v0.13.0-win64.zip", "sha256": "…" } }

const isVersion = (text) => typeof text === "string" && /^\d+(\.\d+){1,3}$/.test(text);
// An archive is named beside latest.json: a plain name, never a path or an address of its own.
const isArchive = (text) => typeof text === "string" && /^[\w][\w .()+-]{0,120}\.zip$/.test(text);
const isSum = (text) => typeof text === "string" && /^[0-9a-f]{64}$/i.test(text);

/**
 * The release for one kind of computer, from what latest.json says: { version, file, sha256,
 * notes }. Null when the file isn't what it should be, or has nothing for that kind.
 */
export function releaseFor(told, platform) {
  if (!told || typeof told !== "object" || !isVersion(told.version)) return null;
  const mine = platform === "darwin" ? told : platform === "win32" ? told.windows : null;
  if (!mine || !isArchive(mine.file) || !isSum(mine.sha256)) return null;
  return { version: told.version, file: mine.file, sha256: mine.sha256.toLowerCase(), notes: typeof told.notes === "string" ? told.notes : "" };
}

/** True when one version number is later than another: "0.10.0" is later than "0.9.2". */
export function isNewer(one, other) {
  const parts = (text) => String(text).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const a = parts(one), b = parts(other);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0);
  }
  return false;
}

/**
 * The script that puts a new copy of the app where the old one is, on Windows. A program can't
 * replace itself while it runs there, so the app writes this, starts it and closes. It waits for
 * the app to go, moves the old copy aside (kept, as a way back), moves the new one in, and starts
 * it. If the new one can't be put in place, the old one is put back and started.
 *
 * `app` is the folder the app is in, `fresh` the unpacked new copy, `old` where the old copy goes,
 * `program` the name of the app's .exe, `pid` the running app, `after` anything to start it with.
 */
export function windowsSwap({ app, fresh, old, program, pid, after = [] }) {
  const quoted = after.map((word) => `"${word}"`).join(" ");
  return [
    "@echo off",
    "rem Puts a new copy of FPV Hangar where the old one is, once the app has closed.",
    `set "APP=${app}"`,
    `set "NEW=${fresh}"`,
    `set "OLD=${old}"`,
    `set "EXE=${program}"`,
    "set /a tries=0",
    ":wait",
    `tasklist /fi "PID eq ${pid}" /nh 2>nul | find /i ".exe" >nul`,
    "if errorlevel 1 goto gone",
    "set /a tries+=1",
    "if %tries% geq 90 goto restart",
    "ping -n 2 127.0.0.1 >nul",
    "goto wait",
    ":gone",
    'if exist "%OLD%" rmdir /s /q "%OLD%"',
    "set /a tries=0",
    ":aside",
    'move "%APP%" "%OLD%" >nul 2>&1',
    "if not errorlevel 1 goto in",
    "set /a tries+=1",
    "if %tries% geq 20 goto restart",
    "ping -n 2 127.0.0.1 >nul",
    "goto aside",
    ":in",
    'robocopy "%NEW%" "%APP%" /E /MOVE /NFL /NDL /NJH /NJS /NP >nul',
    "if errorlevel 8 goto back",
    `start "" "%APP%\\%EXE%" ${quoted}`.trimEnd(),
    "exit /b 0",
    ":back",
    'if exist "%APP%" rmdir /s /q "%APP%"',
    'move "%OLD%" "%APP%" >nul 2>&1',
    ":restart",
    'start "" "%APP%\\%EXE%"',
    "exit /b 1",
    "",
  ].join("\r\n");
}
