// The library on disk, built up from nothing in a scratch folder the way a new pilot's is: the
// setup questions, the season's tracks arriving on their days, a recording added, its laps saved,
// a song and a logo kept, things deleted and put back. Then the Mac app is asked to read it.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { Library, runName, trackNumber, keepsake } from "../main/library.js";
import { FFmpeg } from "../main/ffmpeg.js";
import { FrameRate } from "../shared/timing.js";
import { zoned, zone, stamp } from "../shared/series.js";

const here = dirname(fileURLToPath(import.meta.url));
const binary = join(here, "..", "vendor", `${process.platform}-${process.arch}`, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const at = (year, month, date, hour = 12, minute = 0) => zoned(year, month, date, hour, minute, 0, zone);

const sheet = `,,A Schedule,,,
Track,Release: ,Deadline: ,Livestream:,Title,Track
Number,Friday ~9am PST,Sunday 11:59pm PST ,Saturday ~12 noon pST,Sponsor,Designer
1,September 25th,October 11th,October 17th,Prop Shop,GateKeeper
2,October 9th,October 25th,October 31st,TinyMotors,TBD
3,October 23rd,November 8th,November 14th,Whoops.example,LoopDeLoop
`;
const page = `<h2>RaceGOW6 Track 1</h2><p>Submission Form = <a href="https://docs.google.com/forms/d/e/madeUpForm1/viewform">here</a></p>`;
/** The series' pages, made up, so nothing here needs the network. */
const fetcher = async (address) => ({
  ok: true, status: 200, url: address,
  text: async () => (address.includes("spreadsheets") ? sheet : page),
});

test("names", () => {
  assert.equal(runName("hdz_0012.ts.csv"), "hdz_0012");
  assert.equal(runName("hdz_0010.csv"), "hdz_0010");
  assert.equal(runName("notes.md"), null);
  assert.equal(trackNumber("Track 12"), 12);
  assert.equal(trackNumber("Practice"), null);
});

test("a library from nothing to a timed run, and what the Mac app makes of it", { skip: existsSync(binary) ? false : "FFmpeg hasn't been fetched", timeout: 120000 }, async () => {
  const scratch = mkdtempSync(join(tmpdir(), "hangar-library-"));
  const root = join(scratch, "library"), bin = join(scratch, "trash");
  mkdirSync(bin);
  const ffmpeg = new FFmpeg(binary);
  const trash = async (path) => renameSync(path, join(bin, `${Date.now()}-${basename(path)}`));
  const open = () => new Library(root, { ffmpeg, cache: join(scratch, "cache"), trash, fetch: fetcher });
  try {
    // A new library has nothing in it.
    let library = open();
    assert.deepEqual([library.events, library.tracks], [[], []]);
    assert.equal(library.settings.pilot, "");

    // The setup questions, answered as a pilot who flies the season.
    library.finishSetUp({ pilot: " TEST PILOT ", fliesSeries: true, number: "042" });
    assert.equal(library.settings.pilot, "TEST PILOT");
    assert.deepEqual(library.events.map((event) => event.folder), ["RaceGOW6"]);
    assert.deepEqual(library.details("RaceGOW6"), { name: "RaceGOW6", id: "042", idLabel: "RaceGOW ID" });
    assert.equal(library.seasonEvent, "RaceGOW6");

    // The season is read, and its tracks arrive on their days.
    assert.deepEqual(await library.readSeasonIfDue({ force: true, now: at(2026, 10, 8) }), ["RaceGOW6/Track 1"]);
    assert.equal(library.state("RaceGOW6/Track 1").formURL, "https://docs.google.com/forms/d/e/madeUpForm1/viewform");
    assert.equal(library.nextSeasonTrack("RaceGOW6", at(2026, 10, 8)).number, 2);
    assert.deepEqual(library.applySeason(at(2026, 10, 9, 8, 59)), []);
    assert.deepEqual(library.applySeason(at(2026, 10, 9, 9, 1)), ["RaceGOW6/Track 2"]);
    assert.equal(library.seasonTrack("RaceGOW6/Track 1").sponsor, "Prop Shop");
    // Read again too soon, it isn't.
    assert.deepEqual(await library.readSeasonIfDue({ now: at(2026, 10, 8, 13) }), []);

    // A track the pilot deletes doesn't come back by itself. New track brings it back.
    assert.equal((await library.removeTrack("RaceGOW6/Track 2")).problem, null);
    assert.deepEqual(library.applySeason(at(2026, 10, 10)), []);
    assert.deepEqual(library.tracks, ["RaceGOW6/Track 1"]);
    assert.deepEqual(library.newTrack("RaceGOW6", at(2026, 10, 10)), { track: "RaceGOW6/Track 2" });
    assert.match(library.newTrack("RaceGOW6", at(2026, 10, 10)).notice, /Track 3 opens on/);

    // A recording, made here: two seconds of a test picture as a transport stream.
    const recording = join(scratch, "clip_0001.ts");
    const made = await ffmpeg.run(["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=60", "-t", "2", "-c:v", "libx264", "-preset", "ultrafast", "-bf", "0", "-g", "30", "-f", "mpegts", recording]);
    assert.equal(made.code, 0, made.said);
    const track = "RaceGOW6/Track 1";
    let heard = 0;
    const added = await library.addClips(track, [recording, join(scratch, "nothing.txt")], (fraction) => { heard = fraction; });
    assert.deepEqual([added.added, added.present, added.left, heard], [["clip_0001.ts"], [], 1, 1]);
    assert.deepEqual((await library.addClips(track, [recording])).present, ["clip_0001.ts"]);
    const clip = library.clips(track)[0];
    const facts = await library.facts(clip);
    assert.deepEqual([facts.codec, facts.width, facts.height, facts.fps.label, facts.frames, facts.reorders], ["h264", 320, 180, "60", 120, false]);
    // Asked again, it comes from what was kept.
    assert.equal((await library.facts(clip)).frames, 120);

    // Its laps are saved, and the run is timed.
    assert.match((await library.saveRun(track, "clip_0001", { frames: [10], fps: new FrameRate(60), markersChanged: true, edit: {} })).problem, /at least two/);
    const saved = await library.saveRun(track, "clip_0001", {
      frames: [6, 36, 66, 96, 114], fps: new FrameRate(60), markersChanged: true,
      edit: { song: "song.wav", songStart: -1.5, songMarks: [0.25], videoStart: null }, songMarks: { "song.wav": [0.25] },
    });
    assert.deepEqual(saved, { problem: null, replaced: [] });
    const summary = await library.summary(track);
    assert.equal(summary.runs.length, 1);
    const run = summary.runs[0];
    assert.deepEqual([run.name, run.laps, run.best.seconds, run.best.firstLap, run.best.lastLap, run.bestLap], ["clip_0001", ["0.500", "0.500", "0.500", "0.300"], "1.300", 2, 4, "0.300"]);
    assert.deepEqual(library.state(track).edits, { clip_0001: { song: "song.wav", songStart: -1.5, songMarks: [0.25] } });
    assert.deepEqual(library.songMarks, { "song.wav": [0.25] });

    // A song is kept in the library, once. A logo is kept with its event.
    const song = join(scratch, "song.wav");
    assert.equal((await ffmpeg.run(["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", song])).code, 0);
    assert.deepEqual(library.keepSong(song), { name: "song.wav", problem: null });
    assert.deepEqual(library.songs(track, "clip_0001"), { songs: ["song.wav"], premiere: null });
    assert.equal(library.songFile("song.wav", track), join(root, "Songs", "song.wav"));
    const picture = join(scratch, "badge.jpg");
    assert.equal((await ffmpeg.run(["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=64x40", "-frames:v", "1", picture])).code, 0);
    assert.equal((await library.setLogo("RaceGOW6", picture)).problem, null);
    assert.equal(library.logo("RaceGOW6"), join(root, "RaceGOW6", "Logo.png"));
    assert.match((await library.setLogo("RaceGOW6", join(scratch, "nothing.txt"))).problem, /can't be read/);

    // What goes before and after an event's videos is kept with the event too: a picture, held for
    // three seconds unless told otherwise, and a clip.
    const nothing = { before: null, after: null };
    assert.deepEqual(library.bookends("RaceGOW6"), { landscape: nothing, upright: nothing });
    const card = join(scratch, "my title card.png"), outro = join(scratch, "sign off.mp4");
    assert.equal((await ffmpeg.run(["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=320x180", "-frames:v", "1", card])).code, 0);
    assert.equal((await ffmpeg.run(["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=green:s=320x180:r=30:d=0.5", "-pix_fmt", "yuv420p", outro])).code, 0);
    assert.equal((await library.setBookend("RaceGOW6", "landscape", "before", card)).problem, null);
    assert.equal((await library.setBookend("RaceGOW6", "landscape", "after", outro)).problem, null);
    assert.deepEqual(library.bookends("RaceGOW6"), {
      landscape: {
        before: { file: join(root, "RaceGOW6", "Before.png"), name: "Before.png", kind: "picture", seconds: 3 },
        after: { file: join(root, "RaceGOW6", "After.mp4"), name: "After.mp4", kind: "clip", seconds: null },
      },
      upright: nothing,
    });
    // 9:16 videos have a pair of their own, kept under their own names and with their own seconds.
    assert.equal((await library.setBookend("RaceGOW6", "upright", "before", card)).problem, null);
    library.setBookendSeconds("RaceGOW6", "upright", "before", 2);
    assert.deepEqual(library.bookends("RaceGOW6").upright, { before: { file: join(root, "RaceGOW6", "Before 9x16.png"), name: "Before 9x16.png", kind: "picture", seconds: 2 }, after: null });
    assert.equal(library.bookends("RaceGOW6").landscape.before.seconds, 3);
    // The seconds are kept between half a second and thirty, in a file of this app's own: the Mac
    // app writes its two out with only what it knows of, and would drop them.
    library.setBookendSeconds("RaceGOW6", "landscape", "before", "4.5");
    assert.equal(library.bookends("RaceGOW6").landscape.before.seconds, 4.5);
    library.setBookendSeconds("RaceGOW6", "landscape", "before", 400);
    assert.equal(library.bookends("RaceGOW6").landscape.before.seconds, 30);
    library.setBookendSeconds("RaceGOW6", "landscape", "before", "4.5");
    assert.deepEqual(JSON.parse(readFileSync(join(root, "hangar.json"), "utf8")), { events: { RaceGOW6: { bookendSeconds: { "upright before": 2, before: 4.5 } } } });
    assert.ok(!readFileSync(join(root, "dashboard.json"), "utf8").includes("bookend"));
    // Another in its place sends the old one to the Trash. So does taking it away.
    assert.equal((await library.setBookend("RaceGOW6", "landscape", "after", picture)).problem, null);
    assert.equal(library.bookends("RaceGOW6").landscape.after.name, "After.jpg");
    assert.ok(!existsSync(join(root, "RaceGOW6", "After.mp4")) && readdirSync(bin).some((name) => name.endsWith("-After.mp4")));
    await library.removeBookend("RaceGOW6", "landscape", "after");
    assert.equal(library.bookends("RaceGOW6").landscape.after, null);
    assert.ok(readdirSync(bin).some((name) => name.endsWith("-After.jpg")));
    // Taking one shape's away leaves the other's.
    assert.equal(library.bookends("RaceGOW6").upright.before.name, "Before 9x16.png");
    // Something that is neither is refused, and so are tracks with no event folder to keep it in.
    assert.match((await library.setBookend("RaceGOW6", "landscape", "after", song)).problem, /isn't a video clip or a picture/);
    assert.match((await library.setBookend("", "landscape", "before", card)).problem, /event of their own/);

    // Opened afresh, everything is as it was left.
    library = open();
    assert.deepEqual(library.bookends("RaceGOW6").landscape.before, { file: join(root, "RaceGOW6", "Before.png"), name: "Before.png", kind: "picture", seconds: 4.5 });
    assert.equal(library.bookends("RaceGOW6").upright.before.seconds, 2);
    assert.deepEqual(library.tracks, ["RaceGOW6/Track 1", "RaceGOW6/Track 2"]);
    assert.equal(library.settings.pilot, "TEST PILOT");
    assert.equal((await library.summary(track)).runs[0].best.seconds, "1.300");

    // Deleting: an event only once its tracks are gone. A track put back from the Trash brings what was remembered.
    assert.match((await library.removeEvent("RaceGOW6")).problem, /still has 2 tracks/);
    assert.equal(library.holdsAnything(library.place("RaceGOW6/Track 2")), false);
    assert.equal(library.holdsAnything(library.place(track)), true);
    assert.deepEqual(library.holdings([track]).clips, 1);
    assert.equal((await library.removeTrack(track)).problem, null);
    assert.equal(library.store.tracks[track], undefined);
    const binned = readdirSync(bin).find((name) => name.endsWith("Track 1"));
    assert.ok(existsSync(join(bin, binned, keepsake)));
    renameSync(join(bin, binned), library.place(track));
    library.findTracks();
    assert.equal(library.state(track).edits.clip_0001.song, "song.wav");
    assert.ok(!existsSync(join(library.place(track), keepsake)));

    // Something another copy saved is taken up.
    const other = JSON.parse(readFileSync(library.storeFile, "utf8"));
    other.email = "pilot@example.com";
    other.somethingNewer = { kept: true };
    writeFileSync(library.storeFile, JSON.stringify(other));
    library.refresh(at(2026, 10, 10));
    assert.equal(library.store.email, "pilot@example.com");
    library.recordSubmission(track, { run: "clip_0001", time: "1.300", link: "https://youtu.be/EXAMPLE" }, at(2026, 10, 10));
    const written = JSON.parse(readFileSync(library.storeFile, "utf8"));
    assert.deepEqual(written.somethingNewer, { kept: true }, "a field this version doesn't know is kept");
    assert.equal(written.tracks[track].submissions[0].date, stamp(at(2026, 10, 10)));

    // The Mac app reads the library this wrote: the same event, tracks, form and run.
    const mac = "/Applications/FPV Hangar.app/Contents/MacOS/FPV Hangar";
    if (process.platform === "darwin" && existsSync(mac)) {
      const copy = join(scratch, "for-the-mac-app");
      execFileSync("cp", ["-R", root, copy]);
      const read = execFileSync(mac, ["--root", copy, "--check-events"], { encoding: "utf8", timeout: 60000 });
      assert.match(read, /RaceGOW6: on the timer "RaceGOW6", RaceGOW ID "042", tracks \["RaceGOW6\/Track 1", "RaceGOW6\/Track 2"\]/, read);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
