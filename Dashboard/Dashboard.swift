// FPV Hangar — a macOS front end for the lap timer in ../Lap Timer.
// It marks the laps on each clip, ranks each track's runs, makes the timer overlays and finished
// videos, and fills in the submission form. Build with ./build.sh.

import AVFoundation
import CryptoKit
import SwiftUI
import UniformTypeIdentifiers
import WebKit

// MARK: - Theme

enum Theme {
    static let background = Color(red: 0.043, green: 0.051, blue: 0.063)
    static let sidebar = Color(red: 0.028, green: 0.032, blue: 0.043)
    static let card = Color(red: 0.086, green: 0.098, blue: 0.118)
    static let raised = Color(red: 0.125, green: 0.141, blue: 0.165)
    static let stroke = Color.white.opacity(0.08)
    static let accent = Color(red: 1, green: 0.84, blue: 0.04)
    static let onAccent = Color(red: 0.05, green: 0.05, blue: 0.06)
    static let dim = Color.white.opacity(0.58)
    static let faint = Color.white.opacity(0.32)
    static let good = Color(red: 0.27, green: 0.86, blue: 0.52)
    static let warn = Color(red: 1, green: 0.62, blue: 0.22)
    /// The bass in a song's sound wave.
    static let bass = Color(red: 0.96, green: 0.3, blue: 0.2)
    /// A drop the app heard in a song, and a mark the pilot put in it. Two colours that are neither
    /// each other's nor the playhead's, so one is never taken for the other.
    static let drop = Color(red: 0.36, green: 0.8, blue: 1)
    static let mark = Color(red: 1, green: 0.4, blue: 0.74)
}

extension View {
    func card(padding: CGFloat = 18) -> some View {
        self.padding(padding)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.stroke))
    }

    func label() -> some View {
        self.font(.system(size: 11, weight: .heavy)).tracking(1.4).foregroundStyle(Theme.dim)
    }
}

/// The yellow call-to-action button.
struct PrimaryButton: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .heavy))
            .foregroundStyle(Theme.onAccent)
            .padding(.horizontal, 16).padding(.vertical, 9)
            .background(Theme.accent.opacity(enabled ? (configuration.isPressed ? 0.75 : 1) : 0.3), in: Capsule())
    }
}

/// The quiet outlined button.
struct SecondaryButton: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(.white.opacity(enabled ? 0.92 : 0.35))
            .padding(.horizontal, 13).padding(.vertical, 8)
            .background(Theme.raised.opacity(configuration.isPressed ? 0.6 : 1), in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.stroke))
    }
}

// MARK: - Data

/// Pilot details and timer look, shared with the lap timer tool as settings.json.
struct TimerSettings: Codable, Equatable {
    var pilot = ""
    var id = ""
    var idLabel = "RaceGOW ID"
    var corner = "tr"
    var accent: String?
    /// The competition, shown with the track name on the timer.
    var event: String?
}

struct BestWindow: Codable, Equatable {
    let seconds: String
    let firstLap: Int
    let lastLap: Int
}

/// One run, as the lap timer's --json output describes it.
struct RunInfo: Codable, Identifiable, Equatable {
    let name: String
    let markers: String
    let clip: String
    let fps: String
    let width: Int
    let height: Int
    let laps: [String]
    let bestLap: String
    let best: BestWindow?
    let coarseStep: Int
    let overlays: [String]
    let uprights: [String]
    var landscapes: [String]?
    /// The music file for this run's upright video, if there is one in the track's music folder.
    var music: String?
    /// The gate crossings, in seconds from the start of the clip.
    var crossings: [Double]?
    var id: String { markers }
}

struct SkippedFile: Codable, Equatable {
    let file: String
    let reason: String
}

struct UndecidedRun: Codable, Equatable {
    let name: String
    let actual: String
    let claimed: String
}

struct TrackSummary: Codable, Equatable {
    var window = 3
    var runs: [RunInfo] = []
    var skipped: [SkippedFile] = []
    var undecided: [UndecidedRun] = []
    /// Lower-case names of the files imported into the Premiere project.
    var premiereMedia: [String]?
    /// The fastest run that has a combined time.
    var best: RunInfo? { runs.first { $0.best != nil } }
}

struct Submission: Codable, Equatable {
    var run: String
    var time: String
    var link: String
    var date: Date
}

/// How a run's finished videos are cut and scored, as set in the marker editor.
struct RunEdit: Codable, Equatable {
    /// The clip times the finished videos start and end at. Nil leaves it to the lap timer.
    var videoStart: Double?
    var videoEnd: Double?
    /// A song in the library's Songs folder, or in the track's own music folder, where songs were
    /// kept before there was a library. Empty is silence. Nil is the sound file named after the run,
    /// lined up from the Premiere project, when there is one.
    var song: String?
    /// The clip time the song's first moment belongs at. Before 0 means the song is already under way when the clip starts.
    var songStart: Double?
    /// The clip times the music comes in at and stops at. Nil is the whole of the video.
    var musicIn: Double?
    var musicOut: Double?
    /// Marks in the song, such as a drop, as times into the song. They move with it. They belong to
    /// the song, which keeps them for every run (`Store.songs`); this copy is what the editor works
    /// on, and what a version of the app from before the song library reads.
    var songMarks: [Double]?
}

/// What is kept about a song, whichever run it is used in.
struct SongNotes: Codable, Equatable {
    /// The pilot's own marks in the song, as times into it.
    var marks: [Double]?
}

struct TrackState: Codable, Equatable {
    var formURL = ""
    /// Timebase of sequences made from clips whose header frame rate is wrong.
    var mismatchFPS = ""
    var links: [String: String] = [:]
    var submissions: [Submission] = []
    /// By run name. Optional so a dashboard.json from before the marker editor still loads.
    var edits: [String: RunEdit]?
}

/// What an event keeps for itself, beyond its folder: the name its tracks' timers show, and the
/// pilot's ID in that race or series.
struct EventState: Codable, Equatable {
    /// Shown on the timer in place of the event's folder name.
    var name: String?
    var id: String?
    var idLabel: String?
    /// For the event that is a season of the series: its tracks as the series last published them,
    /// and when that was read. Kept here so a track can open on its day with no network.
    var season: [SeasonTrack]?
    var seasonRead: Date?
    /// Tracks of the season the pilot deleted, by number. They are not made again by themselves.
    var skipped: [Int]?
}

/// One track of a season, as the series' own schedule and pages give it.
struct SeasonTrack: Codable, Equatable, Identifiable {
    var number: Int
    /// When it opens, and when its entries close.
    var release: Date
    var deadline: Date
    /// When its results are streamed.
    var livestream: Date?
    var sponsor: String?
    var designer: String?
    /// Its submission form, once the series has posted one. Every track gets a form of its own.
    var form: String?

    var id: Int { number }
    var name: String { "Track \(number)" }
}

/// Everything the app remembers, kept as dashboard.json in the project folder.
struct Store: Codable, Equatable {
    var email = ""
    /// Form answers by question title, reused for the next track's form.
    var answers: [String: [String]] = [:]
    /// By track: its path inside the library, such as "RaceGOW6/Track 1", or just "Track 1" for a
    /// track that sits in the library itself.
    var tracks: [String: TrackState] = [:]
    /// By event folder. Optional so a dashboard.json from before there were events still loads.
    var events: [String: EventState]?
    /// By song file name. Optional so a dashboard.json from before the song library still loads.
    var songs: [String: SongNotes]?
}

// MARK: - Submission form

struct FormQuestion: Identifiable, Equatable {
    enum Kind { case text, paragraph, choice, checkboxes, other }
    /// What the app can answer on its own.
    enum Role { case handle, number, time, link }

    let id: String
    let title: String
    let kind: Kind
    let required: Bool
    let options: [String]

    var role: Role? {
        // Only something typed can be one of these. Without this, every multiple-choice question
        // that mentions a lap time was taken for the lap time itself.
        guard kind == .text || kind == .paragraph else { return nil }
        let text = title.lowercased()
        if text.contains("pilot handle") || text.contains("pilot name") { return .handle }
        if text.contains("registration number") { return .number }
        if text.contains("youtube") && text.contains("link") { return .link }
        if text.contains("lap time") || (text.contains("fastest") && text.contains("consecutive")) { return .time }
        return nil
    }
}

struct FormDefinition: Equatable {
    let title: String
    let description: String
    let deadline: Date?
    let deadlineText: String?
    let questions: [FormQuestion]

    /// Reads the question list Google Forms embeds in its page.
    static func parse(html: String) -> FormDefinition? {
        guard let start = html.range(of: "FB_PUBLIC_LOAD_DATA_ = "),
              let end = html.range(of: ";</script>", range: start.upperBound..<html.endIndex),
              let root = try? JSONSerialization.jsonObject(with: Data(html[start.upperBound..<end.lowerBound].utf8)) as? [Any],
              root.count > 1, let info = root[1] as? [Any] else { return nil }
        func at(_ list: [Any], _ index: Int) -> Any? { index < list.count ? list[index] : nil }
        var questions: [FormQuestion] = []
        var deadlineText: String?
        for case let item as [Any] in (at(info, 1) as? [Any]) ?? [] {
            let title = (at(item, 1) as? String) ?? ""
            let entries = (at(item, 4) as? [Any]) ?? []
            guard let entry = entries.first as? [Any], let id = at(entry, 0) as? Int else {
                if title.lowercased().contains("deadline") { deadlineText = title }
                continue
            }
            let kind: FormQuestion.Kind
            switch at(item, 3) as? Int {
            case 0: kind = .text
            case 1: kind = .paragraph
            case 2: kind = .choice
            case 4: kind = .checkboxes
            default: kind = .other
            }
            let options = ((at(entry, 1) as? [Any]) ?? []).compactMap { ($0 as? [Any])?.first as? String }.filter { !$0.isEmpty }
            questions.append(FormQuestion(id: String(id), title: title, kind: kind, required: (at(entry, 2) as? Int) == 1, options: options))
        }
        return FormDefinition(title: (at(info, 8) as? String) ?? "Submission form", description: (at(info, 0) as? String) ?? "",
                              deadline: deadlineText.flatMap(parseDeadline), deadlineText: deadlineText, questions: questions)
    }

    /// Finds a date such as "Sunday, October 11th at 11:59:59pm PST" in a line of text.
    static func parseDeadline(_ text: String) -> Date? {
        let pattern = #"(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(?:at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)\s*([a-z]{2,4})?"#
        guard let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else { return nil }
        func group(_ index: Int) -> String? {
            Range(match.range(at: index), in: text).map { String(text[$0]).lowercased() }
        }
        let months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
        let zones = ["pst": "America/Los_Angeles", "pdt": "America/Los_Angeles", "pt": "America/Los_Angeles",
                     "mst": "America/Denver", "mdt": "America/Denver", "cst": "America/Chicago", "cdt": "America/Chicago",
                     "est": "America/New_York", "edt": "America/New_York", "et": "America/New_York", "utc": "UTC", "gmt": "UTC"]
        guard let month = group(1).flatMap(months.firstIndex(of:)), let day = group(2).flatMap({ Int($0) }),
              var hour = group(3).flatMap({ Int($0) }), let minute = group(4).flatMap({ Int($0) }) else { return nil }
        if group(6) == "pm", hour < 12 { hour += 12 }
        if group(6) == "am", hour == 12 { hour = 0 }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = group(7).flatMap { zones[$0] }.flatMap(TimeZone.init(identifier:)) ?? .current
        var parts = DateComponents(year: calendar.component(.year, from: Date()), month: month + 1, day: day, hour: hour, minute: minute)
        parts.second = group(5).flatMap { Int($0) } ?? 0
        guard var date = calendar.date(from: parts) else { return nil }
        // No year is given: a date long gone means next year's.
        if date.timeIntervalSinceNow < -200 * 86400, let next = calendar.date(byAdding: .year, value: 1, to: date) { date = next }
        return date
    }
}

/// Fills in a Google Form that is open in a web view. `answers` maps entry ids to a value or a list of values.
func fillScript(answers: [String: [String]], email: String) -> String {
    let payload = (try? JSONSerialization.data(withJSONObject: ["answers": answers, "email": email])) ?? Data("{}".utf8)
    return """
    (function (data) {
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
    })(\(String(decoding: payload, as: UTF8.self)));
    """
}

// MARK: - Version, library and updates

/// The app's version. build.sh writes it into the bundle from the VERSION file.
enum AppVersion {
    static let current = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "0.0.0"
    /// True for a copy built under another identifier to try things before a release (see build.sh).
    /// It says so in the sidebar, and it never updates itself: a release would replace it.
    static let isTestCopy = Bundle.main.bundleIdentifier != "local.racegow.dashboard"

    /// True when `candidate` comes after `base`: 0.10.0 comes after 0.9.3.
    static func isNewer(_ candidate: String, than base: String) -> Bool {
        let new = candidate.split(separator: ".").map { Int($0) ?? 0 }, old = base.split(separator: ".").map { Int($0) ?? 0 }
        for index in 0..<max(new.count, old.count) {
            let a = index < new.count ? new[index] : 0, b = index < old.count ? old[index] : 0
            if a != b { return a > b }
        }
        return false
    }
}

/// Where the tracks live.
enum Library {
    /// The folder chosen in Pilot & settings, remembered between launches.
    static let key = "library"

    /// Where a new copy of the app starts out keeping things.
    static var standard: URL {
        FileManager.default.urls(for: .moviesDirectory, in: .userDomainMask)[0].appendingPathComponent("FPV Hangar", isDirectory: true)
    }

    /// The folder to use, and whether this copy is tied to it.
    /// - `--root <folder>` when given, for trying things on a copy.
    /// - The folder the app sits in, when that is already a project (it has a dashboard.json or the
    ///   lap timer's folder): a copy kept beside its footage.
    /// - Otherwise the chosen library, which starts out as "FPV Hangar" in the Movies folder. An app in
    ///   Applications ends up here, and so does one macOS is running from a quarantined copy.
    static func current() -> (folder: URL, fixed: Bool) {
        let arguments = CommandLine.arguments
        if let index = arguments.firstIndex(of: "--root"), index + 1 < arguments.count {
            return (URL(fileURLWithPath: arguments[index + 1]), true)
        }
        let beside = Bundle.main.bundleURL.deletingLastPathComponent()
        if ["dashboard.json", "Lap Timer"].contains(where: { FileManager.default.fileExists(atPath: beside.appendingPathComponent($0).path) }) {
            return (beside, true)
        }
        return (UserDefaults.standard.string(forKey: key).map { URL(fileURLWithPath: $0, isDirectory: true) } ?? standard, false)
    }
}

/// One packaged version of the app, as the latest.json attached to its release describes it.
struct Release: Codable, Equatable {
    let version: String
    /// The archive's name. It sits beside latest.json.
    let file: String
    var sha256: String?
    var notes: String?
}

enum UpdateState: Equatable {
    case idle, checking, current
    case available(Release)
    case installing(Release)
    case failed(String)
}

enum Updates {
    /// Where packaged versions are published: the Releases page of the app's repository on GitHub.
    static let page = URL(string: "https://github.com/DrunkCookies0/fpv-hanger/releases")!

    /// The folder latest.json and the archives are read from. `--update-feed <URL>` points it somewhere else, for testing.
    static var feed: URL {
        let arguments = CommandLine.arguments
        if let index = arguments.firstIndex(of: "--update-feed"), index + 1 < arguments.count, let url = URL(string: arguments[index + 1]) { return url }
        // GitHub sends this address on to the files attached to whichever release is the newest.
        return URL(string: "https://github.com/DrunkCookies0/fpv-hanger/releases/latest/download/")!
    }

    /// Reads which packaged version is the newest.
    static func latest() async throws -> Release {
        let request = URLRequest(url: feed.appendingPathComponent("latest.json"), cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        let (data, response) = try await URLSession.shared.data(for: request)
        if let code = (response as? HTTPURLResponse)?.statusCode, code != 200 {
            throw NSError(domain: "Updates", code: code, userInfo: [NSLocalizedDescriptionKey: "the download page answered \(code)"])
        }
        return try JSONDecoder().decode(Release.self, from: data)
    }

    /// Downloads a release and puts it where this copy of the app is. The copy that was running goes to
    /// the Trash, so there is a way back. Returns what went wrong, or nil.
    static func install(_ release: Release) -> String? {
        let manager = FileManager.default
        let app = Bundle.main.bundleURL
        guard app.pathExtension == "app" else { return "This copy isn't an app bundle, so it can't update itself." }
        // macOS runs an app it hasn't cleared yet from a read-only copy somewhere else.
        if app.path.contains("/AppTranslocation/") || !manager.isWritableFile(atPath: app.deletingLastPathComponent().path) {
            return "FPV Hangar can't replace itself where it is. Move it into your Applications folder, open it from there, and try again."
        }
        let work = manager.temporaryDirectory.appendingPathComponent("FPV Hangar update \(UUID().uuidString)", isDirectory: true)
        defer { try? manager.removeItem(at: work) }
        do {
            try manager.createDirectory(at: work, withIntermediateDirectories: true)
            let data = try Data(contentsOf: feed.appendingPathComponent(release.file))
            if let expected = release.sha256, !expected.isEmpty {
                let actual = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
                guard actual == expected.lowercased() else { return "The download didn't arrive in one piece. Try again." }
            }
            let archive = work.appendingPathComponent("update.zip")
            try data.write(to: archive)
            let unpacked = work.appendingPathComponent("unpacked", isDirectory: true)
            guard runTool(URL(fileURLWithPath: "/usr/bin/ditto"), ["-x", "-k", archive.path, unpacked.path]).status == 0 else {
                return "The download couldn't be unpacked."
            }
            // The app is at the top of the archive, or one folder down.
            func apps(in folder: URL) -> [URL] {
                ((try? manager.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []).filter { $0.pathExtension == "app" }
            }
            let folders = (try? manager.contentsOfDirectory(at: unpacked, includingPropertiesForKeys: nil)) ?? []
            guard let fresh = (apps(in: unpacked) + folders.flatMap(apps(in:))).first,
                  let info = NSDictionary(contentsOf: fresh.appendingPathComponent("Contents/Info.plist")),
                  info["CFBundleIdentifier"] as? String == Bundle.main.bundleIdentifier,
                  info["CFBundleShortVersionString"] as? String == release.version else {
                return "The download isn't the version of FPV Hangar it says it is."
            }
            guard runTool(URL(fileURLWithPath: "/usr/bin/codesign"), ["--verify", "--deep", "--strict", fresh.path]).status == 0 else {
                return "The download is damaged."
            }
            var trashed: NSURL?
            try manager.trashItem(at: app, resultingItemURL: &trashed)
            do {
                try manager.moveItem(at: fresh, to: app)
            } catch {
                // Put the old copy back rather than leave nothing there.
                if let trashed { try? manager.moveItem(at: trashed as URL, to: app) }
                throw error
            }
            return nil
        } catch {
            return "The update couldn't be installed: \(error.localizedDescription)"
        }
    }
}

/// Planned, not built yet. Each one is marked "Coming soon" where it will live, and all of them are
/// listed on the How it works page.
enum ComingSoon: CaseIterable {
    case anyFootage, upload, leaderboards

    var title: String {
        switch self {
        case .anyFootage: return "Video Creator for any footage"
        case .upload: return "Upload to YouTube, TikTok and Instagram"
        case .leaderboards: return "Season leaderboards"
        }
    }

    var detail: String {
        switch self {
        case .anyFootage: return "The same clipping, lap timer and music for any FPV footage, without a race series or an entry form. For now, the Video Creator under RaceGOW takes any recording: make an event for it."
        case .upload: return "Send a finished video straight to your channels from here, with the YouTube link filled into the submission form for you. For now, upload it yourself and paste the link."
        case .leaderboards: return "The whole season's standings, next to your own times."
        }
    }

    var icon: String {
        switch self {
        case .anyFootage: return "film.stack"
        case .upload: return "square.and.arrow.up"
        case .leaderboards: return "list.number"
        }
    }
}

/// RaceGOW's own list of who is registered for the season: a public Google Sheet that racegow.com
/// links as its "Pilot List". The setup questions read it to find a pilot's registration number.
/// Nothing is sent to it but the request for the list, and nothing from it is kept but the one
/// pilot's own name and number.
enum PilotList {
    /// The season the list is for, which is also what its event is called here.
    static let season = "RaceGOW6"
    /// What goes before the number on the timer.
    static let idLabel = "RaceGOW ID"
    /// The sheet as comma-separated text.
    static let address = URL(string: "https://docs.google.com/spreadsheets/d/152orGNZClpFnAY-tUZgHHl_BhbXsAaBa9wAys3-OvQw/export?format=csv")!

    struct Pilot: Identifiable, Equatable {
        /// The registration number as the list writes it, such as "042".
        let number: String
        let name: String
        var id: String { number + "/" + name }
    }

    /// Reads the list as it stands now.
    static func read() async throws -> [Pilot] {
        let request = URLRequest(url: address, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        let (data, response) = try await URLSession.shared.data(for: request)
        if let code = (response as? HTTPURLResponse)?.statusCode, code != 200 {
            throw NSError(domain: "PilotList", code: code, userInfo: [NSLocalizedDescriptionKey: "the list's page answered \(code)"])
        }
        let pilots = parse(String(decoding: data, as: UTF8.self))
        guard !pilots.isEmpty else {
            throw NSError(domain: "PilotList", code: 0, userInfo: [NSLocalizedDescriptionKey: "the list isn't laid out the way it used to be"])
        }
        return pilots
    }

    /// The rows of comma-separated text, with a quoted cell taken whole, commas and all.
    static func rows(of text: String) -> [[String]] {
        var rows: [[String]] = [], row: [String] = [], cell = ""
        var quoted = false
        let characters = Array(text)
        var index = 0
        while index < characters.count {
            let character = characters[index]
            if quoted {
                if character == "\"" {
                    // Two in a row is one that belongs to the cell.
                    if index + 1 < characters.count, characters[index + 1] == "\"" {
                        cell.append("\"")
                        index += 1
                    } else {
                        quoted = false
                    }
                } else {
                    cell.append(character)
                }
            } else if character == "\"" {
                quoted = true
            } else if character == "," {
                row.append(cell)
                cell = ""
            } else if character.isNewline {
                row.append(cell)
                rows.append(row)
                row = []
                cell = ""
            } else {
                cell.append(character)
            }
            index += 1
        }
        if !cell.isEmpty || !row.isEmpty {
            row.append(cell)
            rows.append(row)
        }
        return rows
    }

    /// The pilots in the sheet's text. Its columns are found by their headings, "Reg#" and "Pilot Name".
    static func parse(_ text: String) -> [Pilot] {
        let rows = rows(of: text)
        func column(_ wanted: String, in row: [String]) -> Int? {
            row.firstIndex { $0.trimmingCharacters(in: .whitespaces).caseInsensitiveCompare(wanted) == .orderedSame }
        }
        guard let top = rows.firstIndex(where: { column("Reg#", in: $0) != nil && column("Pilot Name", in: $0) != nil }),
              let numbers = column("Reg#", in: rows[top]), let names = column("Pilot Name", in: rows[top]) else { return [] }
        return rows.dropFirst(top + 1).compactMap { row in
            guard row.count > max(numbers, names) else { return nil }
            let number = row[numbers].trimmingCharacters(in: .whitespaces), name = row[names].trimmingCharacters(in: .whitespaces)
            return number.isEmpty || name.isEmpty ? nil : Pilot(number: number, name: name)
        }
    }

    /// Who a pilot name or a registration number could be: the one it names exactly, or failing
    /// that the few whose names have it in them.
    static func find(_ asked: String, in pilots: [Pilot]) -> [Pilot] {
        let query = asked.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return [] }
        func plain(_ text: String) -> String { text.lowercased().filter { $0.isLetter || $0.isNumber } }
        var found = pilots.filter { $0.name.caseInsensitiveCompare(query) == .orderedSame }
        // A number, with or without its # and its leading zeros, is a registration number. It can be
        // somebody's pilot name as well.
        let digits = query.hasPrefix("#") ? String(query.dropFirst()) : query
        if !digits.isEmpty, digits.allSatisfy(\.isNumber), let number = Int(digits) {
            found += pilots.filter { Int($0.number) == number && !found.contains($0) }
            return found
        }
        if !found.isEmpty { return found }
        let wanted = plain(query)
        guard wanted.count >= 2 else { return [] }
        found = pilots.filter { plain($0.name) == wanted }
        return found.isEmpty ? Array(pilots.filter { plain($0.name).contains(wanted) }.prefix(8)) : found
    }
}

/// This season of RaceGOW as the series publishes it: a schedule of its tracks in a public Google
/// Sheet, and on racegow.com a submission form for each track once that track is open. Each track has
/// a form of its own, which closes at that track's deadline.
enum SeasonSchedule {
    /// The "RaceGOW6 Schedule" tab of the sheet racegow.com shows as "GOW Schedules", as comma-separated text.
    static let sheet = URL(string: "https://docs.google.com/spreadsheets/d/18J6211LR0P14YyPdt3seRBbw5T2Un2n5AIu6QjZ8Hi4/export?format=csv&gid=1662031070")!
    /// The pages that name each open track's form.
    static let pages = [URL(string: "https://www.racegow.com/submissions")!, URL(string: "https://www.racegow.com/home")!]
    /// The schedule's times are the Pacific coast's.
    static let zone = TimeZone(identifier: "America/Los_Angeles") ?? .current

    /// Reads the schedule and the forms posted so far.
    static func read(now: Date = Date()) async throws -> [SeasonTrack] {
        let (data, response) = try await URLSession.shared.data(for: URLRequest(url: sheet, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20))
        if let code = (response as? HTTPURLResponse)?.statusCode, code != 200 {
            throw NSError(domain: "SeasonSchedule", code: code, userInfo: [NSLocalizedDescriptionKey: "the schedule's page answered \(code)"])
        }
        var tracks = tracks(inSchedule: String(decoding: data, as: UTF8.self), now: now)
        guard !tracks.isEmpty else {
            throw NSError(domain: "SeasonSchedule", code: 0, userInfo: [NSLocalizedDescriptionKey: "the schedule isn't laid out the way it used to be"])
        }
        var forms: [Int: String] = [:]
        for page in pages {
            guard let (data, _) = try? await URLSession.shared.data(for: URLRequest(url: page, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)) else { continue }
            for (number, link) in Self.forms(inPage: String(decoding: data, as: UTF8.self)) where forms[number] == nil { forms[number] = link }
        }
        for index in tracks.indices {
            if let link = forms[tracks[index].number] { tracks[index].form = await resolved(link) }
        }
        return tracks
    }

    private static func captures(of pattern: String, in text: String) -> [[String]] {
        guard let expression = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive, .dotMatchesLineSeparators]) else { return [] }
        let whole = NSRange(text.startIndex..., in: text)
        return expression.matches(in: text, range: whole).map { match in
            (0..<match.numberOfRanges).map { Range(match.range(at: $0), in: text).map { String(text[$0]) } ?? "" }
        }
    }

    /// A day as the schedule writes it, such as "October 9th" or "January 3rd, 2027", at a time of
    /// day on the Pacific coast. A day with no year is the one nearest to now.
    static func day(_ text: String, hour: Int, minute: Int = 0, second: Int = 0, near now: Date) -> Date? {
        guard let found = captures(of: #"([A-Za-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?"#, in: text).first,
              let day = Int(found[2]) else { return nil }
        // By its first three letters, so a slip such as "Sepetember" still reads.
        let months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
        guard let month = months.firstIndex(of: String(found[1].lowercased().prefix(3))) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        func date(in year: Int) -> Date? {
            calendar.date(from: DateComponents(year: year, month: month + 1, day: day, hour: hour, minute: minute, second: second))
        }
        if let year = Int(found[3]) { return date(in: year) }
        let thisYear = calendar.component(.year, from: now)
        return [thisYear - 1, thisYear, thisYear + 1].compactMap(date(in:)).min { abs($0.timeIntervalSince(now)) < abs($1.timeIntervalSince(now)) }
    }

    /// The tracks in the schedule's text. Its columns are found by their headings, which run over two rows.
    static func tracks(inSchedule text: String, now: Date) -> [SeasonTrack] {
        let rows = PilotList.rows(of: text)
        guard let top = rows.firstIndex(where: { row in
            let cells = row.map { $0.lowercased() }
            return cells.contains { $0.contains("release") } && cells.contains { $0.contains("deadline") }
        }) else { return [] }
        let under = top + 1 < rows.count ? rows[top + 1] : []
        let headings = rows[top].indices.map { (rows[top][$0] + " " + ($0 < under.count ? under[$0] : "")).lowercased() }
        func column(_ word: String) -> Int? { headings.firstIndex { $0.contains(word) } }
        guard let release = column("release"), let deadline = column("deadline") else { return [] }
        let number = column("number") ?? 0, livestream = column("livestream"), sponsor = column("sponsor"), designer = column("designer")
        func cell(_ row: [String], _ index: Int?) -> String? {
            guard let index, index < row.count else { return nil }
            let text = row[index].trimmingCharacters(in: .whitespaces)
            return text.isEmpty ? nil : text
        }
        return rows.dropFirst(top + 1).compactMap { row in
            guard let which = cell(row, number).flatMap({ Int($0) }),
                  let opens = cell(row, release).flatMap({ day($0, hour: 9, near: now) }),
                  let closes = cell(row, deadline).flatMap({ day($0, hour: 23, minute: 59, second: 59, near: now) }) else { return nil }
            return SeasonTrack(number: which, release: opens, deadline: closes, livestream: cell(row, livestream).flatMap { day($0, hour: 12, near: now) },
                               sponsor: cell(row, sponsor), designer: cell(row, designer).flatMap { $0.caseInsensitiveCompare("TBD") == .orderedSame ? nil : $0 })
        }
    }

    /// The submission form each track is given on a page of the series' site, by track number. The
    /// pages say "Track 1 … Submission Form = <link>", in pieces.
    static func forms(inPage html: String) -> [Int: String] {
        // Each link's address is put into the text beside its words, then the markup comes out.
        var text = html.replacingOccurrences(of: #"<a\b[^>]*href="([^"]+)"[^>]*>"#, with: " $1 ", options: .regularExpression)
        text = text.replacingOccurrences(of: #"<script.*?</script>|<style.*?</style>"#, with: " ", options: .regularExpression)
        text = text.replacingOccurrences(of: "<[^>]+>", with: " ", options: .regularExpression)
        for (entity, plain) in [("&amp;", "&"), ("&nbsp;", " "), ("&#39;", "'"), ("&quot;", "\""), ("&lt;", "<"), ("&gt;", ">")] { text = text.replacingOccurrences(of: entity, with: plain) }
        text = text.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        var forms: [Int: String] = [:]
        // From a track's number to the first form named as its submission form, without running on into the next track.
        // The link's own address can stand between the words and the form's, when the page sends it by way of Google.
        let pattern = #"Track\s*(\d{1,2})\b((?:(?!Track\s*\d).){0,400}?)Submission\s+Form\b((?:(?!Track\s*\d).){0,300}?)(https://(?:forms\.gle/[A-Za-z0-9]+|docs\.google\.com/forms/[^\s"'<>]+))"#
        for found in captures(of: pattern, in: text) {
            if let number = Int(found[1]), forms[number] == nil { forms[number] = found[4] }
        }
        return forms
    }

    /// A short forms.gle link followed to the form itself, which is the address the rest of the app works with.
    static func resolved(_ address: String) async -> String {
        guard let url = URL(string: address), url.host == "forms.gle" else { return address }
        guard let (_, response) = try? await URLSession.shared.data(for: URLRequest(url: url, timeoutInterval: 15)),
              let final = response.url, final.host == "docs.google.com", final.path.contains("/forms/") else { return address }
        return "https://docs.google.com" + final.path
    }
}

/// The first screen lays the tools out by suite. A suite is what a set of tools is for: one race
/// series, or any footage at all.
enum Suite: String, CaseIterable, Identifiable {
    case raceGOW, anyFootage

    var id: String { rawValue }

    var title: String {
        switch self {
        case .raceGOW: return "RaceGOW"
        case .anyFootage: return "Any footage"
        }
    }

    var summary: String {
        switch self {
        case .raceGOW: return "The whoop racing series judged from video. One entry for each track: your fastest three laps in a row."
        case .anyFootage: return "For flying that isn't part of a series."
        }
    }

    var tools: [Tool] {
        switch self {
        case .raceGOW: return [.videoCreator, .leaderboards]
        case .anyFootage: return [.anyFootage, .upload]
        }
    }

    /// Pages of the series' own site, when it has one.
    var links: [(title: String, address: String)] {
        switch self {
        case .raceGOW: return [("racegow.com", "home"), ("Tracks", "tracks"), ("Submissions", "submissions"), ("Leaderboards", "leaderboards")].map { ($0.0, "https://www.racegow.com/\($0.1)") }
        case .anyFootage: return []
        }
    }
}

/// One tile on the first screen.
enum Tool: String, Identifiable {
    case videoCreator, leaderboards, anyFootage, upload

    var id: String { rawValue }

    var title: String {
        switch self {
        case .videoCreator, .anyFootage: return "Video Creator"
        case .leaderboards: return "Leaderboards"
        case .upload: return "Upload"
        }
    }

    var summary: String {
        switch self {
        case .videoCreator: return "For each track in the series: time your laps on the recording, put the timer and music on, make the videos, and fill in the entry form."
        case .leaderboards: return "Your best time on each track now. The whole season's standings will join them."
        case .anyFootage: return "Clip a flight, time its laps and add music, without a race series or an entry form."
        case .upload: return "Send a finished video to YouTube, TikTok and Instagram from here."
        }
    }

    var icon: String {
        switch self {
        case .videoCreator: return "film"
        case .leaderboards: return ComingSoon.leaderboards.icon
        case .anyFootage: return ComingSoon.anyFootage.icon
        case .upload: return ComingSoon.upload.icon
        }
    }

    /// What isn't built yet about it, if anything.
    var comingSoon: ComingSoon? {
        switch self {
        case .videoCreator: return nil
        case .leaderboards: return .leaderboards
        case .anyFootage: return .anyFootage
        case .upload: return .upload
        }
    }
}

struct ComingSoonBadge: View {
    var body: some View {
        Text("COMING SOON")
            .font(.system(size: 9, weight: .heavy)).tracking(1.1).foregroundStyle(Theme.accent)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(Theme.accent.opacity(0.14), in: Capsule())
            .fixedSize()
    }
}

/// What a new pilot needs to know, written once. The welcome window shows it the first time the app
/// is opened, and `--read-me` prints it as the "Read Me First" file that goes in the download.
enum ReadMe {
    enum Item {
        case paragraph(String)
        case step(String)
        case point(String)
        /// Lines kept exactly as they are. These go in the file only.
        case lines([String])
    }

    struct Section: Identifiable {
        let title: String
        let items: [Item]
        /// Only useful before the app is open, so the welcome window leaves it out.
        var fileOnly = false
        var id: String { title }
    }

    static let summary = "A hangar of tools for FPV pilots. The first one is the Video Creator: lap times, finished videos with the timer and music on them, and race entry forms, straight from your goggle recordings. Right now it is set up for the RaceGOW whoop series."
    static let files = "Where your files are"
    static let comingSoon = "Coming soon"

    static var sections: [Section] {
        [
            Section(title: "What you need", items: [
                .paragraph("A Mac running macOS 14 (Sonoma) or newer."),
                .paragraph("The app is built for both Apple silicon and Intel Macs. It has only been run on Apple silicon so far."),
            ], fileOnly: true),
            Section(title: "Installing", items: [
                .step("Drag \"FPV Hangar\" into your Applications folder."),
                .step("Open it. The first time, macOS will refuse, because the app does not come from the App Store or a registered developer. To let it through:"),
                .lines([
                    "       macOS 15 or newer",
                    "         Press Done on the warning. Open System Settings > Privacy & Security,",
                    "         scroll down to the line about FPV Hangar, press Open Anyway, and confirm.",
                    "",
                    "       macOS 14",
                    "         Right-click the app, choose Open, then press Open.",
                    "",
                    "     You only do this once. If neither works, open Terminal and run:",
                    "",
                    "       xattr -dr com.apple.quarantine \"/Applications/FPV Hangar.app\"",
                ]),
            ], fileOnly: true),
            Section(title: "Getting started", items: [
                .step("Answer the two questions the app asks first: your pilot name, and whether you fly RaceGOW6. If you do, it finds your registration number on the series' pilot list. Both go on every timer and video and into the entry form, and both can be changed in Pilot & settings."),
                .step("On the first screen, open Video Creator, under RaceGOW. If you fly RaceGOW6 its open tracks are there already. Otherwise press New event, then New track. Press Add clips and choose your recordings, or drop them onto the track's page."),
                .step("Press Mark laps on a clip. A recording you add by itself opens there straight away. Step to the frame where you cross the start/finish gate and press M. Do that for every crossing, then press Done, which saves it."),
                .step("Press Make 16:9 video for YouTube, or Make 9:16 video for Shorts, TikTok and Reels. Markers & music lets you add a song, put one of its drops on the start gate, and choose where the video starts and ends."),
                .step("Upload your video to YouTube and press Submit this run. The app fills the track's entry form in, and you press Submit on the form yourself. A RaceGOW6 track has its form already. For any other, paste its Google Form link on the track page first."),
                .paragraph("The full walk-through and the editor's keys are in the app under How it works."),
            ]),
            Section(title: files, items: [
                .paragraph("In a folder called \"FPV Hangar\" in your Movies folder. Pilot & settings shows it and lets you use a different one."),
            ]),
            Section(title: "Updates", items: [
                .paragraph("The app looks for a newer version when it opens. When there is one, a yellow update button appears on the first screen. It downloads the new version and swaps it in, and the previous copy goes to the Trash."),
                .paragraph("Keep the app in your Applications folder. From anywhere else it may not be able to replace itself."),
                .lines(["  Versions and what changed: \(Updates.page.absoluteString)"]),
            ]),
            Section(title: comingSoon, items: [.paragraph("These are marked \"Coming soon\" in the app and do nothing yet:")] + ComingSoon.allCases.map { .point($0.title) }),
            Section(title: "Good to know", items: [
                .point("Flying another race or series, or just out flying? Press New event in the Video Creator. Each event has its own tracks, its own name on the timer and its own ID, and no event needs an entry form."),
                .point("Lap times are as exact as your markers: one video frame, which is about 0.017 seconds at 60 frames a second."),
                .point("It has been used most with HDZero recordings (.ts). An .mp4 recording has been tested once. Other formats have not been tried."),
                .point("If you fly RaceGOW6, its tracks appear by themselves: each one on the day it opens, with its deadline and, once the series posts it, its entry form. Every track has a form of its own."),
                .point("The app goes online for three things only: to read your Google Form, to check for a newer version, and, if you say you fly RaceGOW6, to read what the series publishes: its pilot list, its schedule and its entry forms."),
                .point("It never sends your entry for you. Nothing goes to RaceGOW until you press Submit on the form."),
                .paragraph("Something not working? Tell whoever sent you this."),
            ]),
        ]
    }

    /// The whole read-me as plain text, wrapped for a text file.
    static func text() -> String {
        func wrapped(_ text: String, first: String, rest: String) -> [String] {
            var lines: [String] = []
            var line = first
            for word in text.split(separator: " ") {
                if line.count + word.count + 1 > 84, line.trimmingCharacters(in: .whitespaces).count > first.trimmingCharacters(in: .whitespaces).count || line != first {
                    lines.append(line)
                    line = rest + word
                } else {
                    line += (line == first || line == rest ? "" : " ") + word
                }
            }
            return lines + [line]
        }
        var lines = ["FPV HANGAR v\(AppVersion.current)", ""] + wrapped(summary, first: "", rest: "")
        for section in sections {
            lines += ["", "", section.title.uppercased(), ""]
            var number = 0
            for item in section.items {
                switch item {
                case .paragraph(let text):
                    if lines.last != "" { lines.append("") }
                    lines += wrapped(text, first: "  ", rest: "  ") + [""]
                case .step(let text):
                    number += 1
                    lines += wrapped(text, first: "  \(number). ", rest: "     ")
                case .point(let text):
                    lines += wrapped(text, first: "  - ", rest: "    ")
                case .lines(let kept):
                    if lines.last != "" { lines.append("") }
                    lines += kept + [""]
                }
            }
            while lines.last == "" { lines.removeLast() }
        }
        return lines.joined(separator: "\n") + "\n"
    }
}

/// The changelog, which build.sh puts inside the app. It is what the "What's new" note shows.
enum ChangeLog {
    struct Entry: Identifiable {
        let version: String
        let date: String
        /// The entry's lines: points start with "- ", anything else is a sentence of its own.
        var lines: [String]
        var id: String { version }
    }

    /// Every version in the file, newest first.
    static let entries: [Entry] = {
        guard let file = Bundle.main.url(forResource: "CHANGELOG", withExtension: "md"),
              let text = try? String(contentsOf: file, encoding: .utf8) else { return [] }
        var found: [Entry] = []
        for line in text.components(separatedBy: .newlines) {
            if line.hasPrefix("## v") {
                let heading = line.dropFirst(4).split(separator: " ", maxSplits: 1)
                let date = heading.count > 1 ? heading[1].trimmingCharacters(in: CharacterSet(charactersIn: "() ")) : ""
                found.append(Entry(version: heading.first.map(String.init) ?? "", date: date, lines: []))
            } else if !found.isEmpty, !line.trimmingCharacters(in: .whitespaces).isEmpty {
                found[found.count - 1].lines.append(line)
            }
        }
        return found
    }()

    /// What changed after `version`, up to the version that is running. With nil, everything.
    static func entries(after version: String?) -> [Entry] {
        entries.filter { entry in
            !AppVersion.isNewer(entry.version, than: AppVersion.current) && (version.map { AppVersion.isNewer(entry.version, than: $0) } ?? true)
        }
    }
}

/// The note that opens over the window by itself: the read-me on the very first run, and what
/// changed the first time a newer version is run.
enum LaunchNote: Identifiable, Equatable {
    case welcome
    /// What is new since a version. With nil, the whole changelog.
    case whatsNew(since: String?)
    /// The questions a new pilot is asked: their name, and whether they fly this season of RaceGOW.
    case setUp

    var id: String {
        switch self {
        case .welcome: return "welcome"
        case .whatsNew(let since): return "new since \(since ?? "the start")"
        case .setUp: return "set up"
        }
    }
}

// MARK: - Model

struct Job: Equatable {
    var title: String
    var progress: Double
}

/// Files waiting for a yes before they go to the Trash.
struct PendingTrash: Equatable {
    let track: String
    let paths: [String]
    let warning: String?
}

struct SubmitTarget: Identifiable, Equatable {
    let track: String
    let run: RunInfo
    var id: String { track + "/" + run.id }
}

/// A finished video that has just been made, for the question whether to watch it now.
struct MadeVideo: Equatable {
    let path: String
    /// What it is, such as "16:9 video", and the run it is of.
    let title: String
    let run: String
}

final class OutputBox: @unchecked Sendable {
    private let lock = NSLock()
    private var data = Data()
    func append(_ chunk: Data) {
        lock.lock()
        data.append(chunk)
        lock.unlock()
    }
    var text: String {
        lock.lock()
        defer { lock.unlock() }
        return String(decoding: data, as: UTF8.self)
    }
}

/// Runs the lap timer and waits for it. `progress` hears the percentages it prints while rendering.
func runTool(_ tool: URL, _ arguments: [String], progress: (@Sendable (Double) -> Void)? = nil) -> (status: Int32, output: String, error: String) {
    let process = Process()
    process.executableURL = tool
    process.arguments = arguments
    let output = Pipe(), failure = Pipe()
    process.standardOutput = output
    process.standardError = failure
    let collected = OutputBox(), problems = OutputBox()
    output.fileHandleForReading.readabilityHandler = { handle in
        let chunk = handle.availableData
        guard !chunk.isEmpty else { return }
        collected.append(chunk)
        let text = String(decoding: chunk, as: UTF8.self)
        if let progress, let match = text.range(of: #"\d+%"#, options: [.regularExpression, .backwards]), let percent = Double(text[match].dropLast()) {
            progress(percent / 100)
        }
    }
    failure.fileHandleForReading.readabilityHandler = { handle in
        let chunk = handle.availableData
        if !chunk.isEmpty { problems.append(chunk) }
    }
    do {
        try process.run()
    } catch {
        return (-1, "", "The lap timer couldn't be started: \(error.localizedDescription)")
    }
    process.waitUntilExit()
    output.fileHandleForReading.readabilityHandler = nil
    failure.fileHandleForReading.readabilityHandler = nil
    collected.append(output.fileHandleForReading.readDataToEndOfFile())
    problems.append(failure.fileHandleForReading.readDataToEndOfFile())
    return (process.terminationStatus, collected.text, problems.text)
}

@MainActor
final class Model: ObservableObject {
    enum Page: Hashable {
        /// The first screen: every tool, grouped by suite.
        case home
        /// The Video Creator, on one of its tracks.
        case track(String)
        /// The Video Creator before it has a track to show.
        case tracks
        case leaderboard
        case settings
        case guide

        /// True for the pages that are inside the Video Creator.
        var isInVideoCreator: Bool {
            switch self {
            case .track, .tracks: return true
            default: return false
            }
        }
    }

    /// The folder the tracks live in.
    @Published private(set) var root: URL
    /// True when this copy is tied to its folder: one kept beside its footage, or started with --root.
    let libraryIsFixed: Bool
    @Published var update = UpdateState.idle
    /// The welcome or "What's new" note that is open.
    @Published var note: LaunchNote?
    private var greeted = false
    @Published var automaticUpdates = !UserDefaults.standard.bool(forKey: "noAutomaticUpdates") {
        didSet { UserDefaults.standard.set(!automaticUpdates, forKey: "noAutomaticUpdates") }
    }
    /// Every track, as its path inside the library: "RaceGOW6/Track 1", or just "Track 1" for one that
    /// sits in the library itself.
    @Published var tracks: [String] = []
    /// The tracks grouped by event, in the order the sidebar lists them.
    @Published var events: [Event] = []

    /// A race or a series: a folder in the library with its tracks inside.
    struct Event: Identifiable, Equatable {
        /// The event's folder. Empty for the tracks that sit loose in the library itself, which is how
        /// every library was laid out before there were events.
        let folder: String
        var tracks: [String]
        var id: String { folder }
    }

    /// A track or an event with something in it, waiting for its phrase to be typed before it goes to the Trash.
    struct PendingRemoval: Equatable, Identifiable {
        let title: String
        let detail: String
        let tracks: [String]
        /// The event's folder, when it is the event that is going.
        var event: String?
        var id: String { title }
    }
    /// What has to be typed before something with anything in it is deleted.
    static let removalPhrase = "I UNDERSTAND"
    @Published var pendingRemoval: PendingRemoval?
    /// Where the tracks and events sent to the Trash this session ended up.
    private(set) var trashed: [URL] = []

    /// What an event puts on its tracks' timers and into their forms.
    struct EventDetails: Equatable {
        var name: String
        var id: String
        var idLabel: String
    }

    static func trackName(_ track: String) -> String { (track as NSString).lastPathComponent }
    static func eventFolder(of track: String) -> String { track.contains("/") ? String(track.prefix { $0 != "/" }) : "" }

    /// An event's details. The loose tracks keep theirs where they always were, in the pilot settings.
    func details(ofEvent folder: String) -> EventDetails {
        if folder.isEmpty { return EventDetails(name: settings.event ?? "", id: settings.id, idLabel: settings.idLabel) }
        let own = store.events?[folder]
        return EventDetails(name: own?.name ?? folder, id: own?.id ?? "", idLabel: own?.idLabel ?? "ID")
    }

    func setDetails(_ details: EventDetails, ofEvent folder: String) {
        if folder.isEmpty {
            settings.event = details.name.isEmpty ? nil : details.name
            settings.id = details.id
            settings.idLabel = details.idLabel
        } else {
            var all = store.events ?? [:]
            var kept = all[folder] ?? EventState()
            kept.name = details.name.isEmpty || details.name == folder ? nil : details.name
            kept.id = details.id
            kept.idLabel = details.idLabel
            all[folder] = kept
            store.events = all
        }
    }

    /// The event of the track that is showing, or the first event when another page is.
    var currentEvent: String {
        if case .track(let track) = page { return Self.eventFolder(of: track) }
        return events.first?.folder ?? ""
    }
    @Published var page: Page = .home {
        didSet {
            // The track last looked at is where the Video Creator opens next time.
            if case .track(let track) = page { UserDefaults.standard.set(track, forKey: "lastTrack") }
        }
    }
    /// Where Pilot & settings, How it works or the leaderboard was opened from: the page its way back leads to.
    @Published private(set) var cameFrom: Page = .home
    @Published var summaries: [String: TrackSummary] = [:]
    @Published var settings = TimerSettings() { didSet { if settings != oldValue { saveSettings() } } }
    @Published var store = Store() { didSet { if store != oldValue { saveStore() } } }
    @Published var forms: [String: FormDefinition] = [:]
    @Published var formProblems: [String: String] = [:]
    @Published var job: Job?
    @Published var notice: String?
    @Published var submitting: SubmitTarget?
    /// Runs whose files are showing.
    @Published var expanded: Set<String> = []
    @Published var pendingTrash: PendingTrash?
    /// The finished video made a moment ago, while the pilot is being asked whether to watch it.
    @Published var justMade: MadeVideo?
    /// The race clips in each track's Raw files folder.
    @Published var clips: [String: [String]] = [:]
    /// The clip open in the marker editor.
    @Published var editor: Editor?
    static let videoExtensions: Set<String> = ["ts", "mts", "m2ts", "mp4", "m4v", "mov", "mkv", "avi", "mxf"]
    static let audioExtensions: Set<String> = ["mp3", "m4a", "aac", "wav", "aif", "aiff", "caf", "flac"]
    let vlc = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "org.videolan.vlc")

    /// The lap timer. The app carries its own, built with it, so the two always match. A copy run
    /// without one (a bare build) falls back on the one in a "Lap Timer" folder in the library.
    var tool: URL {
        if let inside = Bundle.main.url(forAuxiliaryExecutable: "laptimer"), FileManager.default.isExecutableFile(atPath: inside.path) { return inside }
        return root.appendingPathComponent("Lap Timer/laptimer")
    }
    var toolFound: Bool { FileManager.default.isExecutableFile(atPath: tool.path) }
    /// Pilot details. Beside the lap timer's source when the library has it, where the command-line tool also reads them.
    private var settingsFile: URL {
        let beside = root.appendingPathComponent("Lap Timer", isDirectory: true)
        return FileManager.default.fileExists(atPath: beside.path) ? beside.appendingPathComponent("settings.json") : root.appendingPathComponent("settings.json")
    }
    private var storeFile: URL { root.appendingPathComponent("dashboard.json") }
    private var loaded = false

    init(root: URL, fixed: Bool) {
        self.root = root
        libraryIsFixed = fixed
        load()
    }

    /// Opens the welcome note on the very first run, or what is new the first time a newer version is
    /// run. Called when the window appears, so the modes that show no window leave it for a real launch.
    func greet() {
        guard !greeted else { return }
        greeted = true
        let defaults = UserDefaults.standard
        let last = defaults.string(forKey: "lastVersion")
        if last == nil, !defaults.bool(forKey: "welcomed") {
            note = .welcome
        } else if let last, AppVersion.isNewer(AppVersion.current, than: last) {
            if ChangeLog.entries(after: last).isEmpty {
                notice = "Updated to FPV Hangar v\(AppVersion.current)."
            } else {
                note = .whatsNew(since: last)
            }
        }
        defaults.set(true, forKey: "welcomed")
        defaults.set(AppVersion.current, forKey: "lastVersion")
    }

    convenience init() {
        let library = Library.current()
        self.init(root: library.folder, fixed: library.fixed)
    }

    /// Reads the library's pilot details and saved state, making the folder first when it is a new library.
    private func load() {
        loaded = false
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        // A new library starts out set up for the series the app is built around.
        var fresh = TimerSettings()
        fresh.event = "RaceGOW6"
        settings = (try? Data(contentsOf: settingsFile)).flatMap { try? decoder.decode(TimerSettings.self, from: $0) } ?? fresh
        store = (try? Data(contentsOf: storeFile)).flatMap { try? decoder.decode(Store.self, from: $0) } ?? Store()
        loaded = true
        gatherSongMarks()
        summaries = [:]
        clips = [:]
        expanded = []
        findTracks()
        page = .home
        cameFrom = .home
    }

    /// Closes the note. After the welcome, a pilot with no name yet is asked the setup questions.
    func closeNote() {
        let askNext = note == .welcome && settings.pilot.isEmpty
        note = nil
        // One sheet has to be gone before the next can come up.
        if askNext { DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self.note = .setUp } }
    }

    /// Takes the answers to the setup questions: the pilot's name, and for a pilot flying this
    /// season of RaceGOW, an event for it carrying their registration number. A library starts with
    /// no event at all, so that nobody gets a series they don't fly printed on their videos.
    func finishSetUp(pilot: String, fliesRaceGOW: Bool, number: String) {
        let name = pilot.trimmingCharacters(in: .whitespacesAndNewlines)
        if !name.isEmpty { settings.pilot = name }
        if fliesRaceGOW {
            let event = events.first { details(ofEvent: $0.folder).name.caseInsensitiveCompare(PilotList.season) == .orderedSame }?.folder ?? PilotList.season
            let id = number.trimmingCharacters(in: .whitespacesAndNewlines)
            if event.isEmpty {
                // The tracks that sit loose in an older library are this season's already.
                if !id.isEmpty { settings.id = id }
                settings.idLabel = PilotList.idLabel
            } else {
                // An event is a folder in the library. Without its folder it would be remembered and never shown.
                try? FileManager.default.createDirectory(at: root.appendingPathComponent(event), withIntermediateDirectories: true)
                var all = store.events ?? [:]
                var kept = all[event] ?? EventState()
                if !id.isEmpty { kept.id = id }
                kept.idLabel = PilotList.idLabel
                all[event] = kept
                store.events = all
            }
            findTracks()
            readSeasonIfDue(force: true)
        }
        note = nil
        if !name.isEmpty {
            let id = fliesRaceGOW ? details(ofEvent: events.first { details(ofEvent: $0.folder).name.caseInsensitiveCompare(PilotList.season) == .orderedSame }?.folder ?? "").id : ""
            notice = "You are set up, \(name)\(id.isEmpty ? "" : ", \(PilotList.idLabel) \(id)"). Open Video Creator to start on a track."
        }
    }

    /// True while the Video Creator is asking for a new event's name.
    @Published var namingEvent = false

    // MARK: The season

    /// The folder of the event that is this season of RaceGOW, when the library has one.
    var seasonEvent: String? {
        events.first { !$0.folder.isEmpty && details(ofEvent: $0.folder).name.caseInsensitiveCompare(PilotList.season) == .orderedSame }?.folder
    }

    /// The season's tracks as the series last published them.
    func season(of event: String) -> [SeasonTrack] { store.events?[event]?.season ?? [] }

    /// The number in a track's name: 1 for "Track 1".
    static func number(inTrackName name: String) -> Int? { Int(name.filter(\.isNumber)) }

    /// What the series' schedule says about a track, when it is one of the season's.
    func seasonTrack(for track: String) -> SeasonTrack? {
        let event = Self.eventFolder(of: track)
        guard !event.isEmpty, event == seasonEvent, let number = Self.number(inTrackName: Self.trackName(track)) else { return nil }
        return season(of: event).first { $0.number == number }
    }

    /// The season's next track that isn't open yet.
    func nextSeasonTrack(in event: String, now: Date = Date()) -> SeasonTrack? {
        guard event == seasonEvent else { return nil }
        return season(of: event).filter { $0.release > now }.min { $0.release < $1.release }
    }

    /// Makes a track for each of the season's tracks that has opened, and gives each track its
    /// submission form once the series has posted it. Nothing the pilot set is changed, and a track
    /// the pilot deleted is not made again. It goes by what was last read, so it works with no network.
    func applySeason(now: Date = Date()) {
        guard let event = seasonEvent else { return }
        let season = season(of: event)
        guard !season.isEmpty else { return }
        let skipped = Set(store.events?[event]?.skipped ?? [])
        func numbers() -> Set<Int> { Set((events.first { $0.folder == event }?.tracks ?? []).compactMap { Self.number(inTrackName: Self.trackName($0)) }) }
        var made = false
        for one in season where one.release <= now && !skipped.contains(one.number) && !numbers().contains(one.number) {
            let track = event + "/" + one.name
            for part in ["Raw files", "csv markers", "music"] {
                try? FileManager.default.createDirectory(at: folder(track, part), withIntermediateDirectories: true)
            }
            made = true
            findTracks()
        }
        for track in events.first(where: { $0.folder == event })?.tracks ?? [] {
            guard let one = seasonTrack(for: track), let form = one.form, state(track).formURL.trimmingCharacters(in: .whitespaces).isEmpty else { continue }
            update(track) { $0.formURL = form }
            if made { loadSummary(track) }
        }
    }

    private var readingSeason = false

    /// Reads the season's schedule and forms again when that was last done some hours ago. The
    /// series posts a track's form on the day the track opens, so this is how the form arrives.
    func readSeasonIfDue(force: Bool = false) {
        guard let event = seasonEvent, !readingSeason else { return }
        if !force, let last = store.events?[event]?.seasonRead, Date().timeIntervalSince(last) < 3 * 3600 { return }
        readingSeason = true
        Task {
            defer { readingSeason = false }
            guard let tracks = try? await SeasonSchedule.read() else { return }
            var all = store.events ?? [:]
            var kept = all[event] ?? EventState()
            kept.season = tracks
            kept.seasonRead = Date()
            all[event] = kept
            store.events = all
            let before = self.tracks
            applySeason()
            for track in self.tracks where !before.contains(track) { loadSummary(track) }
            // A Video Creator that was showing "no tracks yet" goes to the track that has just arrived.
            if page == .tracks, let first = self.tracks.first { page = .track(first) }
        }
    }

    /// Opens the Video Creator where it was left: on the track last looked at, or else its first.
    func openVideoCreator() {
        if let last = UserDefaults.standard.string(forKey: "lastTrack"), tracks.contains(last) {
            page = .track(last)
        } else {
            page = tracks.first.map { .track($0) } ?? .tracks
        }
    }

    /// Goes to a page that has a way back, remembering where from.
    func open(_ destination: Page) {
        if page == .home || page.isInVideoCreator { cameFrom = page }
        page = destination
    }

    /// Back from Pilot & settings, How it works or the leaderboard to where it was opened from.
    func goBack() {
        if case .track(let track) = cameFrom, !tracks.contains(track) { cameFrom = .home }
        page = cameFrom
    }

    /// What the way back is called.
    var backTitle: String { cameFrom.isInVideoCreator ? "Video Creator" : "Hangar" }

    /// Asks for a different folder to keep the tracks in.
    func chooseLibrary() {
        guard !libraryIsFixed, job == nil, editor == nil else { return }
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.directoryURL = root
        panel.prompt = "Use this folder"
        panel.message = "Choose the folder to keep your tracks, markers and videos in."
        guard panel.runModal() == .OK, let folder = panel.url, folder.standardizedFileURL != root.standardizedFileURL else { return }
        UserDefaults.standard.set(folder.path, forKey: Library.key)
        root = folder
        load()
        refresh()
        notice = "Now using \(folder.path). Nothing was moved: anything in the old folder is still there."
    }

    // MARK: Updates

    /// Looks for a newer packaged version. `quietly` is the check made at launch, which says nothing unless there is one.
    func checkForUpdates(quietly: Bool = false) {
        guard !AppVersion.isTestCopy else { return }
        switch update {
        case .checking, .installing: return
        default: break
        }
        let before = update
        if !quietly { update = .checking }
        Task {
            do {
                let release = try await Updates.latest()
                UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: "lastUpdateCheck")
                update = AppVersion.isNewer(release.version, than: AppVersion.current) ? .available(release) : .current
            } catch {
                update = quietly ? before : .failed("Couldn't check for updates: \(error.localizedDescription).")
            }
        }
    }

    /// The check at launch: once a day at most, and not at all when it has been switched off.
    func checkForUpdatesIfDue() {
        guard automaticUpdates, Date().timeIntervalSince1970 - UserDefaults.standard.double(forKey: "lastUpdateCheck") > 20 * 3600 else { return }
        checkForUpdates(quietly: true)
    }

    /// Replaces this copy of the app with the newer one and starts it.
    func installUpdate() {
        guard case .available(let release) = update else { return }
        guard job == nil, editor == nil else {
            notice = "Let the video finish, or close the marker editor, before updating."
            return
        }
        update = .installing(release)
        Task {
            if let problem = await Task.detached(operation: { Updates.install(release) }).value {
                update = .failed(problem)
                return
            }
            // Start the new copy once this one has gone.
            let starter = Process()
            starter.executableURL = URL(fileURLWithPath: "/bin/sh")
            starter.arguments = ["-c", "sleep 1; /usr/bin/open \"$0\"", Bundle.main.bundleURL.path]
            try? starter.run()
            NSApp.terminate(nil)
        }
    }

    private func write<T: Encodable>(_ value: T, to file: URL) {
        guard loaded else { return }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        if let data = try? encoder.encode(value) { try? data.write(to: file, options: .atomic) }
    }
    private func saveSettings() { write(settings, to: settingsFile) }
    private func saveStore() { write(store, to: storeFile) }

    /// Two copies of the app can be open on one library: the released one and a test copy, say. Each
    /// saves the whole of what it remembers whenever something changes, so one that has not looked
    /// since the other saved would write over it. Before doing anything else on coming to the front,
    /// this copy takes what is in the files now. Nothing of its own is lost: it saves as it goes.
    private func takeWhatAnotherCopySaved() {
        guard loaded else { return }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        loaded = false
        if let saved = (try? Data(contentsOf: storeFile)).flatMap({ try? decoder.decode(Store.self, from: $0) }), saved != store { store = saved }
        if let saved = (try? Data(contentsOf: settingsFile)).flatMap({ try? decoder.decode(TimerSettings.self, from: $0) }), saved != settings { settings = saved }
        loaded = true
        // A copy from before the song library saves the file without the songs' own marks. They are
        // still in the runs, so they are gathered again.
        gatherSongMarks()
    }

    func folder(_ track: String, _ name: String) -> URL { root.appendingPathComponent(track).appendingPathComponent(name) }

    /// Finds the tracks and the events they belong to. A track is a folder that holds marker files or
    /// raw clips. An event is a folder in the library with tracks inside it, or one made here that has
    /// none yet. Tracks sitting in the library itself, from before there were events, form one of their own.
    func findTracks() {
        let manager = FileManager.default
        func isTrack(_ folder: URL) -> Bool {
            ["csv markers", "Raw files"].contains { manager.fileExists(atPath: folder.appendingPathComponent($0).path) }
        }
        func folders(in place: URL) -> [String] {
            ((try? manager.contentsOfDirectory(atPath: place.path)) ?? []).filter { name in
                guard !name.hasPrefix("."), !name.hasSuffix(".app") else { return false }
                var isFolder: ObjCBool = false
                return manager.fileExists(atPath: place.appendingPathComponent(name).path, isDirectory: &isFolder) && isFolder.boolValue
            }.sorted { $0.localizedStandardCompare($1) == .orderedAscending }
        }
        var loose: [String] = []
        var found: [Event] = []
        for name in folders(in: root) {
            let folder = root.appendingPathComponent(name)
            if isTrack(folder) {
                loose.append(name)
                continue
            }
            let inside = folders(in: folder).filter { isTrack(folder.appendingPathComponent($0)) }
            if !inside.isEmpty || store.events?[name] != nil { found.append(Event(folder: name, tracks: inside.map { name + "/" + $0 })) }
        }
        if !loose.isEmpty { found.insert(Event(folder: "", tracks: loose), at: 0) }
        // Anything put back from the Trash brings what was remembered about it.
        for event in found {
            if !event.folder.isEmpty, store.events?[event.folder] == nil,
               let kept = takeBack(EventState.self, from: root.appendingPathComponent(event.folder)) {
                var all = store.events ?? [:]
                all[event.folder] = kept
                store.events = all
            }
            for track in event.tracks where store.tracks[track] == nil {
                if let kept = takeBack(TrackState.self, from: root.appendingPathComponent(track)) { store.tracks[track] = kept }
            }
        }
        if found != events { events = found }
        let all = found.flatMap(\.tracks)
        if all != tracks { tracks = all }
    }

    func state(_ track: String) -> TrackState { store.tracks[track] ?? TrackState() }
    func update(_ track: String, _ change: (inout TrackState) -> Void) {
        var value = state(track)
        change(&value)
        store.tracks[track] = value
    }

    func refresh() {
        takeWhatAnotherCopySaved()
        findTracks()
        applySeason()
        readSeasonIfDue()
        for track in tracks { loadSummary(track) }
        if case .track(let name) = page, !tracks.contains(name) { page = tracks.first.map { .track($0) } ?? .tracks }
        if page == .tracks, let first = tracks.first { page = .track(first) }
    }

    /// The pilot's details and the timer's corner, handed to the lap timer directly: the one inside the
    /// app has no settings file beside it to read them from.
    private func pilotArguments(for track: String) -> [String] {
        let event = details(ofEvent: Self.eventFolder(of: track))
        var arguments = ["--position", settings.corner, "--id-label", event.idLabel]
        if !settings.pilot.isEmpty { arguments += ["--pilot", settings.pilot] }
        if !event.id.isEmpty { arguments += ["--id", event.id] }
        if !event.name.isEmpty { arguments += ["--event", event.name] }
        if let accent = settings.accent, !accent.isEmpty { arguments += ["--accent", accent] }
        if let logo = logo(ofEvent: Self.eventFolder(of: track)) { arguments += ["--logo", logo.path] }
        return arguments
    }

    // MARK: An event's logo

    static let pictureExtensions: Set<String> = ["png", "jpg", "jpeg", "webp", "heic", "tif", "tiff", "gif", "bmp"]

    /// An event can have a logo: a picture called Logo in its folder. It goes on the event's videos:
    /// across the head of the timer box on a 16:9 one, and in the heading of a 9:16 one, beside the
    /// pilot's name. It is the pilot's own copy, kept with the event.
    func logo(ofEvent folder: String) -> URL? {
        guard !folder.isEmpty else { return nil }
        let place = root.appendingPathComponent(folder, isDirectory: true)
        return ((try? FileManager.default.contentsOfDirectory(atPath: place.path)) ?? [])
            .first { ($0 as NSString).deletingPathExtension.lowercased() == "logo" && Self.pictureExtensions.contains(($0 as NSString).pathExtension.lowercased()) }
            .map { place.appendingPathComponent($0) }
    }

    func chooseLogo(forEvent folder: String) {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.image]
        panel.message = "Choose a picture for this event's logo. A copy is kept with the event. One with a see-through background looks best."
        guard panel.runModal() == .OK, let picked = panel.url else { return }
        if let problem = setLogo(from: picked, ofEvent: folder) { notice = problem }
    }

    /// Keeps a copy of a picture as an event's logo. It is saved as a PNG, which keeps any see-through
    /// background and is a kind the lap timer can always read. Returns what went wrong, or nil.
    func setLogo(from picture: URL, ofEvent folder: String) -> String? {
        guard !folder.isEmpty else { return "Give these tracks an event of their own first, in Pilot & settings. The logo is kept in the event's folder." }
        guard let source = CGImageSourceCreateWithURL(picture as CFURL, nil), let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            return "\(picture.lastPathComponent) can't be read as a picture."
        }
        let place = root.appendingPathComponent(folder, isDirectory: true)
        let file = place.appendingPathComponent("Logo.png")
        // The one it replaces goes to the Trash, unless it is the very file that was picked.
        if let old = logo(ofEvent: folder), old.standardizedFileURL != picture.standardizedFileURL { try? FileManager.default.trashItem(at: old, resultingItemURL: nil) }
        guard let destination = CGImageDestinationCreateWithURL(file as CFURL, "public.png" as CFString, 1, nil) else { return "The logo couldn't be saved in \(folder)." }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { return "The logo couldn't be saved in \(folder)." }
        objectWillChange.send()
        return nil
    }

    func removeLogo(ofEvent folder: String) {
        guard let old = logo(ofEvent: folder) else { return }
        do {
            try FileManager.default.trashItem(at: old, resultingItemURL: nil)
            notice = "Moved \(details(ofEvent: folder).name)'s logo to the Trash."
        } catch {
            notice = "The logo couldn't be moved to the Trash: \(error.localizedDescription)"
        }
        objectWillChange.send()
    }

    /// The pilot's details and the timer's look for a track's videos, as the lap timer itself takes
    /// them from what it is handed. The marker editor draws its timer from this.
    func timerOptions(for track: String) -> Options {
        var options = parseArguments(pilotArguments(for: track))
        options.trackName = Self.trackName(track)
        return options
    }

    /// The timer as the lap timer program draws it for a run's 16:9 video at one moment of the clip,
    /// on a see-through frame. The marker editor's own timer is checked against this.
    func timerStill(markers: String, track: String, at seconds: Double, to file: URL) -> Bool {
        let arguments = ["--markers", markers, "--size", "1920x1080", "--still", String(seconds), file.path] + pilotArguments(for: track) + toolArguments(track)
        return runTool(tool, arguments).status == 0
    }

    /// Where things that can be made again are kept: the timer preview and the editor's playable copies.
    /// The bundle identifier still has the app's first name in it, so its caches carried over.
    nonisolated static var caches: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(Bundle.main.bundleIdentifier ?? "local.racegow.dashboard", isDirectory: true)
    }

    /// The timer exactly as the lap timer draws it on a 16:9 frame, once the last of `laps` is done,
    /// with the rest of the frame see-through. For the preview in Pilot & settings.
    func timerPreview(laps: [String], track: String) async -> NSImage? {
        guard toolFound else { return nil }
        try? FileManager.default.createDirectory(at: Self.caches, withIntermediateDirectories: true)
        let file = Self.caches.appendingPathComponent("Timer preview.png")
        let finish = laps.compactMap { Double($0) }.reduce(0, +)
        let arguments = ["--laps"] + laps + ["--first-crossing", "0", "--fps", "60", "--size", "1920x1080", "--track", Self.trackName(track),
                                             "--still", String(finish + 1), file.path] + pilotArguments(for: track)
        let tool = tool
        let result = await Task.detached { runTool(tool, arguments) }.value
        guard result.status == 0, let data = try? Data(contentsOf: file) else { return nil }
        return NSImage(data: data)
    }

    /// A frame of the pilot's own footage to show the timer over, when one can be had without making
    /// anything: from the clip itself if macOS plays it, or from a playable copy the editor made earlier.
    nonisolated static func footageFrame(of clip: String, at seconds: Double) async -> NSImage? {
        let copy = Editor.copyLocation(of: clip).movie
        for file in [URL(fileURLWithPath: clip), copy] where FileManager.default.fileExists(atPath: file.path) {
            let asset = AVURLAsset(url: file)
            guard (try? await asset.loadTracks(withMediaType: .video).first) != nil else { continue }
            let frames = AVAssetImageGenerator(asset: asset)
            frames.appliesPreferredTrackTransform = true
            frames.maximumSize = CGSize(width: 1280, height: 720)
            if let frame = try? await frames.image(at: CMTime(seconds: seconds, preferredTimescale: 600)).image {
                return NSImage(cgImage: frame, size: NSSize(width: frame.width, height: frame.height))
            }
        }
        return nil
    }

    private func toolArguments(_ track: String) -> [String] {
        let rate = state(track).mismatchFPS
        return rate.isEmpty ? [] : ["--mismatch-fps", rate]
    }

    func findClips(_ track: String) {
        let raw = folder(track, "Raw files")
        clips[track] = ((try? FileManager.default.contentsOfDirectory(atPath: raw.path)) ?? [])
            .filter { !$0.hasPrefix(".") && Self.videoExtensions.contains(($0 as NSString).pathExtension.lowercased()) }
            .sorted { $0.localizedStandardCompare($1) == .orderedAscending }
            .map { raw.appendingPathComponent($0).path }
    }

    func loadSummary(_ track: String) {
        findClips(track)
        let markers = folder(track, "csv markers")
        let exports = ((try? FileManager.default.contentsOfDirectory(atPath: markers.path)) ?? []).filter { $0.lowercased().hasSuffix(".csv") }
        guard toolFound, !exports.isEmpty else {
            summaries[track] = TrackSummary()
            return
        }
        let tool = tool, arguments = ["--markers", markers.path, "--json"] + toolArguments(track)
        Task.detached {
            let result = runTool(tool, arguments)
            let summary = try? JSONDecoder().decode(TrackSummary.self, from: Data(result.output.utf8))
            await MainActor.run {
                if let summary {
                    self.summaries[track] = summary
                } else {
                    self.summaries[track] = TrackSummary()
                    self.notice = result.error.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "Error: ", with: "")
                }
            }
        }
    }

    /// What can be made from a run.
    enum Output {
        /// A finished 16:9 video for YouTube.
        case landscape
        /// A finished 9:16 video for Shorts, TikTok and Reels.
        case upright
        /// A see-through timer clip to lay over the footage in Premiere.
        case overlay

        var title: String {
            switch self {
            case .landscape: return "16:9 video"
            case .upright: return "9:16 video"
            case .overlay: return "Premiere overlay"
            }
        }
        var arguments: [String] {
            switch self {
            case .landscape: return ["--landscape", "--no-overlay"]
            case .upright: return ["--upright", "--no-overlay"]
            case .overlay: return []
            }
        }
    }

    /// Songs are kept in one place, for every track of every event: this folder in the library.
    static let songsFolder = "Songs"
    var songLibrary: URL { root.appendingPathComponent(Self.songsFolder, isDirectory: true) }

    /// Where a song is: in the song library, or failing that in the track's own music folder, which
    /// is where songs were kept before there was a library.
    func songFile(_ name: String, track: String) -> URL {
        let shared = songLibrary.appendingPathComponent(name)
        return FileManager.default.fileExists(atPath: shared.path) ? shared : folder(track, "music").appendingPathComponent(name)
    }

    /// The pilot's marks in each song that has any.
    var songMarks: [String: [Double]] { (store.songs ?? [:]).compactMapValues { $0.marks } }

    /// Marks made before songs kept their own are in the runs they were made in. Each song with none
    /// of its own takes them from every run that used it, so they are there for the next run too.
    private func gatherSongMarks() {
        var found: [String: [Double]] = [:]
        for state in store.tracks.values {
            for edit in (state.edits ?? [:]).values {
                guard let song = edit.song, !song.isEmpty, store.songs?[song] == nil else { continue }
                for mark in edit.songMarks ?? [] where !(found[song] ?? []).contains(where: { abs($0 - mark) < 0.02 }) {
                    found[song, default: []].append(mark)
                }
            }
        }
        guard !found.isEmpty else { return }
        var all = store.songs ?? [:]
        for (song, marks) in found { all[song] = SongNotes(marks: marks.sorted()) }
        store.songs = all
    }

    /// The sound a run's finished videos get: the song chosen in the marker editor, or else the file
    /// named after the run in the music folder. Nil when they are silent.
    func music(for run: RunInfo, track: String) -> String? {
        if let song = state(track).edits?[run.name]?.song {
            return song.isEmpty ? nil : songFile(song, track: track).path
        }
        return (run.music ?? "").isEmpty ? nil : run.music
    }

    /// What the marker editor decided about a run's finished videos, as lap timer options.
    private func editArguments(_ run: RunInfo, track: String) -> [String] {
        guard let edit = state(track).edits?[run.name] else { return [] }
        var arguments: [String] = []
        if let start = edit.videoStart { arguments += ["--video-start", String(start)] }
        if let end = edit.videoEnd { arguments += ["--video-end", String(end)] }
        if let song = edit.song {
            if song.isEmpty {
                arguments.append("--no-music")
            } else {
                arguments += ["--music", songFile(song, track: track).path]
                if let start = edit.songStart { arguments += ["--music-start", String(start)] }
                if let comesIn = edit.musicIn { arguments += ["--music-in", String(comesIn)] }
                if let stops = edit.musicOut { arguments += ["--music-out", String(stops)] }
            }
        }
        return arguments
    }

    func make(_ run: RunInfo, track: String, output: Output) {
        guard job == nil else { return }
        if output != .overlay, let song = state(track).edits?[run.name]?.song, !song.isEmpty,
           !FileManager.default.fileExists(atPath: songFile(song, track: track).path) {
            notice = "\(song) isn't among your songs any more. Open Markers & music for \(run.name) and pick the song again."
            return
        }
        // Without an overlays folder the lap timer writes beside the marker files instead, and the finished videos follow it there.
        try? FileManager.default.createDirectory(at: folder(track, "overlays"), withIntermediateDirectories: true)
        job = Job(title: "Making the \(output.title) for \(run.name)", progress: 0)
        let already: Int
        switch output {
        case .landscape: already = (run.landscapes ?? []).count
        case .upright: already = run.uprights.count
        case .overlay: already = run.overlays.count
        }
        let tool = tool
        let arguments = ["--markers", run.markers] + output.arguments + pilotArguments(for: track) + toolArguments(track)
            + (output == .overlay ? [] : editArguments(run, track: track))
        Task.detached {
            let result = runTool(tool, arguments) { fraction in
                Task { @MainActor in if self.job != nil { self.job?.progress = fraction } }
            }
            await MainActor.run {
                self.job = nil
                if result.status == 0 {
                    // The tool rewrites its progress line in place, so split on returns as well as new lines.
                    let lines = result.output.components(separatedBy: CharacterSet(charactersIn: "\r\n"))
                    let file = lines.last { $0.hasPrefix("Wrote ") }.map { String($0.dropFirst(6)) }
                    let written = file.map { "Made \(URL(fileURLWithPath: $0).lastPathComponent)" }
                    // A finished video is something to look at straight away: ask.
                    if let file, output != .overlay { self.justMade = MadeVideo(path: file, title: output.title, run: run.name) }
                    let extra = lines.filter { $0.hasPrefix("Sound: ") || $0.hasPrefix("Note: ") }.map { $0.replacingOccurrences(of: "Note: ", with: "") }
                    var notes = [written ?? lines.last { $0.hasPrefix("No ") }].compactMap { $0 } + extra
                    if written != nil, already > 0 {
                        notes.append("There are now \(already + 1) versions of the \(output.title) for \(run.name). Open them and keep the right one.")
                        self.expanded.insert(run.id)
                    }
                    self.notice = notes.joined(separator: "\n")
                } else {
                    self.notice = result.error.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "Error: ", with: "")
                }
                self.loadSummary(track)
            }
        }
    }

    // MARK: Marker editor

    func edit(_ run: RunInfo, track: String) {
        open(EditTarget(track: track, name: run.name, clip: run.clip, crossings: run.crossings ?? []))
    }

    func mark(clip: String, track: String) {
        open(EditTarget(track: track, name: URL(fileURLWithPath: clip).deletingPathExtension().lastPathComponent, clip: clip))
    }

    private func open(_ target: EditTarget) {
        guard editor == nil else { return }
        guard toolFound else {
            notice = "The lap timer that belongs inside this app is missing, so the clip can't be opened. Download the app again."
            return
        }
        guard FileManager.default.fileExists(atPath: target.clip) else {
            notice = "\(URL(fileURLWithPath: target.clip).lastPathComponent) isn't there any more. Press Refresh."
            return
        }
        notice = nil
        let names = Set((clips[target.track] ?? []).map { URL(fileURLWithPath: $0).deletingPathExtension().lastPathComponent.lowercased() })
        editor = Editor(target: target, edit: state(target.track).edits?[target.name] ?? RunEdit(), window: summaries[target.track]?.window ?? 3,
                        tool: tool, musicFolder: folder(target.track, "music"), songLibrary: songLibrary, songMarks: songMarks,
                        clipNames: names.union([target.name.lowercased()]))
    }

    func closeEditor() {
        editor?.stop()
        editor = nil
    }

    /// The run a marker file is for: its name without ".csv", and without the clip's extension when
    /// Premiere named the export after the whole clip file ("hdz_0012.ts.csv").
    static func runName(ofMarkerFile file: String) -> String? {
        guard ["csv", "txt"].contains((file as NSString).pathExtension.lowercased()) else { return nil }
        let name = (file as NSString).deletingPathExtension
        return videoExtensions.contains((name as NSString).pathExtension.lowercased()) ? (name as NSString).deletingPathExtension : name
    }

    /// Saves what the marker editor holds: the markers as a file in the track's csv markers folder,
    /// the rest in dashboard.json. Returns what went wrong, or nil.
    func save(_ editor: Editor) -> String? {
        let target = editor.target
        var replaced: [String] = []
        if editor.markersChanged {
            guard editor.markers.count >= 2 else {
                return "Mark at least two gate crossings before saving: where lap 1 starts, then the end of each lap."
            }
            let markers = folder(target.track, "csv markers")
            let file = markers.appendingPathComponent(target.name + ".csv")
            do {
                try FileManager.default.createDirectory(at: markers, withIntermediateDirectories: true)
                // A second marker file for the same run would be timed as a second run. One exported from
                // Premiere goes to the Trash rather than being written over.
                for name in (try? FileManager.default.contentsOfDirectory(atPath: markers.path)) ?? []
                where Self.runName(ofMarkerFile: name)?.lowercased() == target.name.lowercased() {
                    let old = markers.appendingPathComponent(name)
                    let ours = (try? String(contentsOf: old, encoding: .utf8)).map(EditorFormat.wrote) ?? false
                    if ours && name.lowercased() == file.lastPathComponent.lowercased() { continue }
                    try FileManager.default.trashItem(at: old, resultingItemURL: nil)
                    replaced.append(name)
                }
                try Data(editor.markerFile().utf8).write(to: file, options: .atomic)
            } catch {
                return "The markers couldn't be saved: \(error.localizedDescription)"
            }
        }
        update(target.track) { state in
            var edits = state.edits ?? [:]
            edits[target.name] = editor.edit == RunEdit() ? nil : editor.edit
            state.edits = edits.isEmpty ? nil : edits
        }
        // A song's marks are kept with the song, for every run that uses it.
        var songs = store.songs ?? [:]
        for (song, marks) in editor.marksToKeep { songs[song] = SongNotes(marks: marks) }
        if songs != store.songs ?? [:] { store.songs = songs }
        editor.markSaved()
        if !replaced.isEmpty {
            editor.message = "Saved. \(replaced.joined(separator: ", ")) from Premiere went to the Trash, since these markers replace it."
        }
        loadSummary(target.track)
        return nil
    }

    func loadForm(_ track: String) {
        let address = state(track).formURL.trimmingCharacters(in: .whitespaces)
        guard forms[address] == nil, let url = URL(string: address), url.scheme == "https" else { return }
        formProblems[address] = nil
        Task {
            do {
                let (data, response) = try await URLSession.shared.data(from: url)
                if let form = FormDefinition.parse(html: String(decoding: data, as: UTF8.self)) {
                    forms[address] = form
                    // A short link (forms.gle) leads on to the form. Keep the form's own address: it is
                    // the one the form's page is opened with when the entry is filled in.
                    if let final = response.url, final.host == "docs.google.com", final.path.contains("/forms/"), url.host != final.host {
                        let own = "https://docs.google.com" + final.path
                        forms[own] = form
                        if state(track).formURL.trimmingCharacters(in: .whitespaces) == address { update(track) { $0.formURL = own } }
                    }
                } else {
                    formProblems[address] = "That page doesn't look like a Google Form."
                }
            } catch {
                formProblems[address] = error.localizedDescription
            }
        }
    }

    func form(_ track: String) -> FormDefinition? { forms[state(track).formURL.trimmingCharacters(in: .whitespaces)] }

    func recordSubmission(track: String, run: String, time: String, link: String) {
        update(track) { $0.submissions.append(Submission(run: run, time: time, link: link, date: Date())) }
    }

    // MARK: Deleting tracks and events

    /// The file tucked inside a track or event on its way to the Trash, holding what the app
    /// remembers about it. If the folder is put back, that comes back with it.
    static let keepsake = ".fpv-hangar.json"

    private func tuck<T: Encodable>(_ value: T?, into folder: URL) {
        guard let value else { return }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        if let data = try? encoder.encode(value) { try? data.write(to: folder.appendingPathComponent(Self.keepsake)) }
    }

    private func takeBack<T: Decodable>(_ type: T.Type, from folder: URL) -> T? {
        let file = folder.appendingPathComponent(Self.keepsake)
        guard let data = try? Data(contentsOf: file) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        try? FileManager.default.removeItem(at: file)
        return try? decoder.decode(type, from: data)
    }

    /// What some tracks hold, in words, for the question before they go.
    private func summary(of tracks: [String]) -> String {
        let manager = FileManager.default
        func count(_ track: String, _ part: String, _ kinds: Set<String>) -> Int {
            ((try? manager.contentsOfDirectory(atPath: folder(track, part).path)) ?? [])
                .filter { !$0.hasPrefix(".") && kinds.contains(($0 as NSString).pathExtension.lowercased()) }.count
        }
        var clips = 0, runs = 0, videos = 0
        var bytes: Int64 = 0
        for track in tracks {
            clips += count(track, "Raw files", Self.videoExtensions)
            runs += count(track, "csv markers", ["csv", "txt"])
            videos += count(track, "landscape", ["mp4"]) + count(track, "vertical", ["mp4"])
            let files = manager.enumerator(at: root.appendingPathComponent(track), includingPropertiesForKeys: [.fileSizeKey])
            while let file = files?.nextObject() as? URL { bytes += Int64((try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) }
        }
        func some(_ number: Int, _ one: String, _ many: String) -> String? { number == 0 ? nil : "\(number) \(number == 1 ? one : many)" }
        let parts = [some(clips, "clip", "clips"), some(runs, "marked run", "marked runs"), some(videos, "finished video", "finished videos")].compactMap { $0 }
        guard !parts.isEmpty else { return bytes > 0 ? "It has \(ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)) of files in it." : "It has files in it." }
        let list = parts.count > 1 ? parts.dropLast().joined(separator: ", ") + " and " + parts.last! : parts[0]
        return "\(tracks.count == 1 ? "It holds" : "They hold") \(list), \(ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)) in all."
    }

    /// Whether a folder has anything in it worth losing: any file at all, however deep, that isn't
    /// hidden. One file can be left out of the count, which is how an event's logo doesn't make its
    /// folder count as full.
    private func holdsAnything(_ folder: URL, besides spared: URL? = nil) -> Bool {
        let files = FileManager.default.enumerator(at: folder, includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey], options: [.skipsHiddenFiles])
        while let file = files?.nextObject() as? URL {
            let values = try? file.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            if let spared, file.standardizedFileURL == spared.standardizedFileURL { continue }
            if values?.isDirectory != true || values?.isSymbolicLink == true { return true }
        }
        return false
    }

    /// Deletes a track. An empty one goes to the Trash straight away. One with anything in it waits
    /// for its phrase to be typed.
    func askToDelete(track: String) {
        guard job == nil, editor == nil else { return }
        let pending = PendingRemoval(
            title: "Move \(Self.trackName(track)) to the Trash?",
            detail: summary(of: [track]) + " Everything in it goes too, your recordings included. You can put it back from the Trash.",
            tracks: [track], event: nil)
        if holdsAnything(root.appendingPathComponent(track)) {
            pendingRemoval = pending
        } else {
            remove(pending)
        }
    }

    /// Deletes an event, which has to be empty of tracks first. Like a track, it goes straight away
    /// unless something else is in its folder.
    func askToDelete(event folder: String) {
        guard job == nil, editor == nil, !folder.isEmpty, let event = events.first(where: { $0.folder == folder }) else { return }
        let name = details(ofEvent: folder).name
        guard event.tracks.isEmpty else {
            notice = "\(name) still has \(event.tracks.count == 1 ? "a track" : "\(event.tracks.count) tracks") in it. Delete \(event.tracks.count == 1 ? "that" : "those") first, then the event."
            return
        }
        let pending = PendingRemoval(
            title: "Move \(name) to the Trash?",
            detail: "It has no tracks, but there are other files in its folder, and they go too. You can put it back from the Trash.",
            tracks: [], event: folder)
        if holdsAnything(root.appendingPathComponent(folder), besides: logo(ofEvent: folder)) {
            pendingRemoval = pending
        } else {
            remove(pending)
        }
    }

    /// Deletes what is waiting, if the phrase has been typed. Returns whether it went ahead.
    @discardableResult
    func confirmRemoval(typed: String) -> Bool {
        guard let pending = pendingRemoval,
              typed.trimmingCharacters(in: .whitespacesAndNewlines).caseInsensitiveCompare(Self.removalPhrase) == .orderedSame else { return false }
        pendingRemoval = nil
        remove(pending)
        return true
    }

    /// Moves the track or event that was asked about to the Trash, with what the app remembers about
    /// it tucked inside in case it is ever put back.
    private func remove(_ pending: PendingRemoval) {
        guard job == nil, editor == nil else { return }
        let manager = FileManager.default
        var remembered = store
        var gone: [String] = [], stuck: [String] = []
        if let event = pending.event {
            // The whole event's folder goes in one piece.
            let place = root.appendingPathComponent(event)
            for track in pending.tracks { tuck(remembered.tracks[track], into: root.appendingPathComponent(track)) }
            tuck(remembered.events?[event], into: place)
            do {
                var landed: NSURL?
                if manager.fileExists(atPath: place.path) { try manager.trashItem(at: place, resultingItemURL: &landed) }
                if let landed { trashed.append(landed as URL) }
                for track in pending.tracks { remembered.tracks[track] = nil }
                remembered.events?[event] = nil
                gone.append(details(ofEvent: event).name)
            } catch {
                stuck.append("\(event): \(error.localizedDescription)")
            }
        } else {
            for track in pending.tracks {
                let place = root.appendingPathComponent(track)
                tuck(remembered.tracks[track], into: place)
                do {
                    var landed: NSURL?
                    let ofSeason = seasonTrack(for: track)
                    try manager.trashItem(at: place, resultingItemURL: &landed)
                    if let landed { trashed.append(landed as URL) }
                    remembered.tracks[track] = nil
                    // One of the season's tracks is not made again behind the pilot's back.
                    if let ofSeason {
                        let event = Self.eventFolder(of: track)
                        let already = remembered.events?[event]?.skipped ?? []
                        remembered.events?[event]?.skipped = Array(Set(already + [ofSeason.number])).sorted()
                    }
                    gone.append(Self.trackName(track))
                } catch {
                    try? manager.removeItem(at: place.appendingPathComponent(Self.keepsake))
                    stuck.append("\(Self.trackName(track)): \(error.localizedDescription)")
                }
            }
        }
        store = remembered
        for track in pending.tracks { summaries[track] = nil }
        var lines: [String] = []
        if !gone.isEmpty { lines.append("Moved \(gone.joined(separator: ", ")) to the Trash.") }
        if !stuck.isEmpty { lines.append("Couldn't move " + stuck.joined(separator: "; ")) }
        notice = lines.joined(separator: "\n")
        refresh()
    }

    // MARK: Adding clips

    /// Asks which recordings to add to a track.
    func chooseClips(for track: String) {
        /// Lets recordings and folders be picked and greys out the rest. It goes by the file's
        /// extension, because macOS takes a .ts recording for a TypeScript file when a code editor is installed.
        final class Chooser: NSObject, NSOpenSavePanelDelegate {
            func panel(_ sender: Any, shouldEnable url: URL) -> Bool {
                (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true || Model.videoExtensions.contains(url.pathExtension.lowercased())
            }
        }
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.prompt = "Add"
        panel.message = "Choose the recordings to add to \(Self.trackName(track)). They are copied in, and the originals stay where they are."
        let chooser = Chooser()
        panel.delegate = chooser
        let answer = withExtendedLifetime(chooser) { panel.runModal() }
        if answer == .OK { addClips(panel.urls, to: track) }
    }

    /// Copies recordings into a track's Raw files folder, which is where its clips are looked for. The
    /// originals are left alone. A folder stands for the recordings directly inside it.
    func addClips(_ picked: [URL], to track: String) {
        guard job == nil else {
            notice = "Wait for what is being made to finish, then add the clips."
            return
        }
        let manager = FileManager.default
        var files: [URL] = []
        for url in picked {
            if (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true {
                files += ((try? manager.contentsOfDirectory(at: url, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles])) ?? [])
                    .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }
            } else {
                files.append(url)
            }
        }
        let clips = files.filter { Self.videoExtensions.contains($0.pathExtension.lowercased()) }
        guard !clips.isEmpty else {
            notice = "None of those are video recordings."
            return
        }
        let destination = folder(track, "Raw files")
        func size(_ url: URL) -> Int64 { Int64((try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) }
        let total = clips.reduce(Int64(0)) { $0 + size($1) }
        try? manager.createDirectory(at: destination, withIntermediateDirectories: true)
        if let free = try? destination.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]).volumeAvailableCapacityForImportantUsage,
           free < total + 200_000_000 {
            let format = { (bytes: Int64) in ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file) }
            notice = "There isn't room for \(clips.count == 1 ? "that clip" : "those clips"): \(format(total)) is needed and \(format(free)) is free."
            return
        }
        let name = Self.trackName(track)
        let left = files.count - clips.count
        job = Job(title: clips.count == 1 ? "Adding \(clips[0].lastPathComponent) to \(name)" : "Adding \(clips.count) clips to \(name)", progress: 0)
        Task.detached {
            let result = Model.copy(clips, into: destination, total: total) { fraction in
                Task { @MainActor in if self.job != nil { self.job?.progress = fraction } }
            }
            await MainActor.run {
                self.job = nil
                var lines: [String] = []
                if !result.added.isEmpty {
                    lines.append(result.added.count == 1 ? "Added \(result.added[0]) to \(name)." : "Added \(result.added.count) clips to \(name).")
                }
                if !result.present.isEmpty {
                    lines.append("\(result.present.joined(separator: ", ")) \(result.present.count == 1 ? "was" : "were") already there.")
                }
                lines += result.failed
                if left > 0 { lines.append("\(left) other file\(left == 1 ? " isn't a video and was" : "s aren't videos and were") left out.") }
                self.notice = lines.joined(separator: "\n")
                self.loadSummary(track)
                // One recording added by itself goes straight to having its laps marked. Several are
                // left on the page, for the pilot to pick which to mark first.
                if clips.count == 1, let name = result.added.first ?? result.present.first {
                    self.openForMarking(destination.appendingPathComponent(name).path, track: track)
                }
            }
        }
    }

    /// Opens a clip in the marker editor: with its markers when it is already a timed run, and
    /// otherwise ready for its first one.
    func openForMarking(_ clip: String, track: String) {
        // A track's clips all sit in one folder, so the file's name is enough to tell which run it is.
        let name = URL(fileURLWithPath: clip).lastPathComponent
        if let run = summaries[track]?.runs.first(where: { URL(fileURLWithPath: $0.clip).lastPathComponent == name }) {
            edit(run, track: track)
        } else {
            mark(clip: clip, track: track)
        }
    }

    /// Copies files into a folder one after another, reporting how far along the whole lot is. A file
    /// that is already there, with the same name and size, is left; a different one with the same
    /// name is kept and the new one gets a number after its name, the way Finder does it.
    nonisolated static func copy(_ files: [URL], into folder: URL, total: Int64, progress: @Sendable (Double) -> Void)
        -> (added: [String], present: [String], failed: [String]) {
        let manager = FileManager.default
        var added: [String] = [], present: [String] = [], failed: [String] = []
        var done: Int64 = 0
        func size(_ url: URL) -> Int64 { Int64((try? manager.attributesOfItem(atPath: url.path)[.size] as? Int64) ?? 0) }
        for file in files {
            var target = folder.appendingPathComponent(file.lastPathComponent)
            if manager.fileExists(atPath: target.path) {
                if file.standardizedFileURL == target.standardizedFileURL || size(target) == size(file) {
                    present.append(file.lastPathComponent)
                    done += size(file)
                    progress(total > 0 ? Double(done) / Double(total) : 1)
                    continue
                }
                var number = 2
                repeat {
                    target = folder.appendingPathComponent("\(file.deletingPathExtension().lastPathComponent) \(number).\(file.pathExtension)")
                    number += 1
                } while manager.fileExists(atPath: target.path)
            }
            // Written under a hidden name first, so a half-copied clip is never taken for a whole one.
            let part = folder.appendingPathComponent("." + target.lastPathComponent + ".part")
            do {
                try? manager.removeItem(at: part)
                manager.createFile(atPath: part.path, contents: nil)
                let from = try FileHandle(forReadingFrom: file), to = try FileHandle(forWritingTo: part)
                defer {
                    try? from.close()
                    try? to.close()
                }
                while let chunk = try from.read(upToCount: 4 << 20), !chunk.isEmpty {
                    try to.write(contentsOf: chunk)
                    done += Int64(chunk.count)
                    progress(total > 0 ? Double(done) / Double(total) : 1)
                }
                try to.close()
                // Keep the recording's own date, which is when it was flown.
                if let date = try? manager.attributesOfItem(atPath: file.path)[.modificationDate] as? Date {
                    try? manager.setAttributes([.modificationDate: date], ofItemAtPath: part.path)
                }
                try manager.moveItem(at: part, to: target)
                added.append(target.lastPathComponent)
            } catch {
                try? manager.removeItem(at: part)
                failed.append("\(file.lastPathComponent) couldn't be added: \(error.localizedDescription)")
            }
        }
        return (added, present, failed)
    }

    /// Makes the next track in an event: "Track 3" after two.
    func newTrack(in event: String, now: Date = Date()) {
        // The season's tracks come from its schedule. Here the only ones to add are those that have
        // opened and aren't in the library: deleted earlier, or not made yet.
        if !event.isEmpty, event == seasonEvent, !season(of: event).isEmpty {
            let have = Set((events.first { $0.folder == event }?.tracks ?? []).compactMap { Self.number(inTrackName: Self.trackName($0)) })
            guard let one = season(of: event).filter({ $0.release <= now && !have.contains($0.number) }).min(by: { $0.number < $1.number }) else {
                if let next = nextSeasonTrack(in: event, now: now) {
                    notice = "\(next.name) opens on \(next.release.formatted(date: .complete, time: .omitted)). It will appear here by itself."
                } else {
                    notice = "Every track of \(details(ofEvent: event).name) is here already."
                }
                return
            }
            var all = store.events ?? [:]
            let stillSkipped = all[event]?.skipped?.filter { $0 != one.number }
            all[event]?.skipped = stillSkipped
            store.events = all
            applySeason(now: now)
            let track = event + "/" + one.name
            if tracks.contains(track) {
                page = .track(track)
                loadSummary(track)
            }
            return
        }
        let place = event.isEmpty ? root : root.appendingPathComponent(event)
        var number = (events.first { $0.folder == event }?.tracks.count ?? 0) + 1
        while FileManager.default.fileExists(atPath: place.appendingPathComponent("Track \(number)").path) { number += 1 }
        let track = (event.isEmpty ? "" : event + "/") + "Track \(number)"
        for part in ["Raw files", "csv markers", "music"] {
            try? FileManager.default.createDirectory(at: folder(track, part), withIntermediateDirectories: true)
        }
        findTracks()
        page = .track(track)
        loadSummary(track)
    }

    /// Whether a name will do for an event's folder. Returns what is wrong with it, or nil.
    private func problem(withEventName name: String) -> String? {
        if name.isEmpty { return "Give the event a name." }
        if name.contains("/") || name.contains(":") || name.hasPrefix(".") { return "An event's name can't have / or : in it, or start with a full stop." }
        return nil
    }

    /// Makes an event, with a first track in it. Returns what is wrong with the name, or nil.
    func newEvent(named raw: String) -> String? {
        let name = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if let problem = problem(withEventName: name) { return problem }
        if name.caseInsensitiveCompare(Self.songsFolder) == .orderedSame {
            return "\(Self.songsFolder) is the folder your song library is kept in. Give the event another name."
        }
        guard !FileManager.default.fileExists(atPath: root.appendingPathComponent(name).path) else {
            return "There is already a folder called \(name) in your library."
        }
        // Two events with one name would be two headings nobody can tell apart.
        if events.contains(where: { details(ofEvent: $0.folder).name.caseInsensitiveCompare(name) == .orderedSame }) {
            return "You already have an event called \(name). New track under it adds a track."
        }
        var all = store.events ?? [:]
        all[name] = EventState()
        store.events = all
        newTrack(in: name)
        return nil
    }

    /// Moves the tracks that sit loose in the library into a folder named after their event, so they
    /// are laid out like any other event. What the app remembers about them moves with them. Returns
    /// what went wrong, or nil.
    func gatherLooseTracks() -> String? {
        guard job == nil, editor == nil else { return "Let the video finish, or close the marker editor, first." }
        guard let loose = events.first(where: { $0.folder.isEmpty }), !loose.tracks.isEmpty else { return nil }
        let name = (settings.event ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if let problem = problem(withEventName: name) { return name.isEmpty ? "Give the event a name first: its folder is named after it." : problem }
        let manager = FileManager.default
        let place = root.appendingPathComponent(name, isDirectory: true)
        var isFolder: ObjCBool = false
        if manager.fileExists(atPath: place.path, isDirectory: &isFolder),
           !isFolder.boolValue || loose.tracks.contains(where: { manager.fileExists(atPath: place.appendingPathComponent($0).path) }) {
            return "Something called \(name) is already in your library and is in the way."
        }
        var remembered = store
        var failure: String?
        do {
            try manager.createDirectory(at: place, withIntermediateDirectories: true)
            for track in loose.tracks {
                try manager.moveItem(at: root.appendingPathComponent(track), to: place.appendingPathComponent(track))
                remembered.tracks[name + "/" + track] = remembered.tracks.removeValue(forKey: track)
                if page == .track(track) { page = .track(name + "/" + track) }
            }
        } catch {
            failure = "Not every track could be moved: \(error.localizedDescription)"
        }
        var all = remembered.events ?? [:]
        all[name] = EventState(id: settings.id.isEmpty ? nil : settings.id, idLabel: settings.idLabel)
        remembered.events = all
        store = remembered
        summaries = [:]
        expanded = []
        refresh()
        return failure
    }

    /// Asks before moving renders to the Trash, with a warning for any that Premiere is using.
    func askToTrash(_ files: [RunFile], track: String) {
        guard !files.isEmpty else { return }
        let inPremiere = Set(summaries[track]?.premiereMedia ?? [])
        let used = files.filter { inPremiere.contains($0.name.lowercased()) }.map(\.name)
        let warning = used.isEmpty ? nil
            : "\(used.joined(separator: " and ")) \(used.count == 1 ? "is" : "are") in your Premiere project, and will show as offline there."
        pendingTrash = PendingTrash(track: track, paths: files.map(\.path), warning: warning)
    }

    func confirmTrash() {
        guard let pending = pendingTrash else { return }
        pendingTrash = nil
        var moved: [String] = []
        var stuck: [String] = []
        for path in pending.paths {
            let file = URL(fileURLWithPath: path)
            do {
                try FileManager.default.trashItem(at: file, resultingItemURL: nil)
                moved.append(file.lastPathComponent)
            } catch {
                stuck.append(file.lastPathComponent)
            }
        }
        var lines: [String] = []
        if !moved.isEmpty { lines.append("Moved \(moved.joined(separator: ", ")) to the Trash.") }
        if !stuck.isEmpty { lines.append("Couldn't move \(stuck.joined(separator: ", ")).") }
        notice = lines.joined(separator: "\n")
        loadSummary(pending.track)
    }

    /// Plays a file in VLC, or in whatever opens it by default when VLC isn't installed.
    func play(_ path: String) {
        let file = URL(fileURLWithPath: path)
        guard FileManager.default.fileExists(atPath: path) else {
            notice = "\(file.lastPathComponent) isn't there any more. Press Refresh."
            return
        }
        if let vlc {
            NSWorkspace.shared.open([file], withApplicationAt: vlc, configuration: NSWorkspace.OpenConfiguration())
        } else {
            NSWorkspace.shared.open(file)
        }
    }

    func reveal(_ paths: [String]) {
        NSWorkspace.shared.activateFileViewerSelecting(paths.map { URL(fileURLWithPath: $0) })
    }
}

// MARK: - Shell

/// How wide things are allowed to get. On a wide screen the app keeps to the middle of its window
/// instead of spreading out or leaving everything on the left.
enum Layout {
    /// The whole of a screen: the Video Creator with its sidebar, or a page by itself.
    static let stage: CGFloat = 1420
    /// A page with no sidebar beside it.
    static let page: CGFloat = 1120
}

struct RootView: View {
    @EnvironmentObject var model: Model

    var body: some View {
        ZStack {
            ZStack(alignment: .bottom) {
                Group {
                    switch model.page {
                    case .home: HomeView()
                    case .track(let name): videoCreator { TrackView(track: name).id(name) }
                    case .tracks: videoCreator { NoTracksView() }
                    case .leaderboard: LeaderboardView()
                    case .settings: SettingsView()
                    case .guide: GuideView()
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .background(Theme.background)
                // The middle of a wide window is the app. What is left over on each side is darker.
                .frame(maxWidth: Layout.stage)
                .overlay(alignment: .leading) { Rectangle().fill(Theme.stroke).frame(width: 1) }
                .overlay(alignment: .trailing) { Rectangle().fill(Theme.stroke).frame(width: 1) }
                .frame(maxWidth: .infinity)
                .background(Theme.sidebar)
                .sheet(item: $model.pendingRemoval) { pending in
                    RemovalSheet(pending: pending).environmentObject(model)
                }
                StatusBar()
            }
            // Out of reach while the editor is up, so a text field under it can't keep the keyboard.
            .disabled(model.editor != nil)
            .accessibilityHidden(model.editor != nil)
            .sheet(item: $model.note) { note in
                if note == .setUp {
                    SetUpSheet().environmentObject(model)
                } else {
                    NoteSheet(note: note).environmentObject(model)
                }
            }
            // The marker editor takes over the whole window while a clip is open in it.
            if let editor = model.editor { EditorView(editor: editor) }
        }
        .preferredColorScheme(.dark)
        .sheet(item: $model.submitting) { target in
            SubmitSheet(target: target).environmentObject(model)
        }
        .alert("Move to the Trash?", isPresented: Binding(get: { model.pendingTrash != nil }, set: { if !$0 { model.pendingTrash = nil } }), presenting: model.pendingTrash) { _ in
            Button("Move to Trash", role: .destructive) { model.confirmTrash() }
            Button("Cancel", role: .cancel) { model.pendingTrash = nil }
        } message: { pending in
            Text(pending.paths.map { URL(fileURLWithPath: $0).lastPathComponent }.joined(separator: ", ")
                + (pending.warning.map { "\n\n" + $0 } ?? ""))
        }
        .alert("Your video is ready", isPresented: Binding(get: { model.justMade != nil }, set: { if !$0 { model.justMade = nil } }), presenting: model.justMade) { made in
            Button("Watch it now") { model.play(made.path) }
            Button("Not now", role: .cancel) {}
        } message: { made in
            Text("The \(made.title) of \(made.run) is made. Watch it now?")
        }
    }

    /// The Video Creator: its own sidebar of events and tracks, and one of its pages.
    private func videoCreator<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        HStack(spacing: 0) {
            Sidebar()
            content().frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .modifier(NewEventPrompt())
    }
}

/// Asks for a new event's name. Its buttons are in the Video Creator's sidebar and on its empty page.
struct NewEventPrompt: ViewModifier {
    @EnvironmentObject var model: Model
    @State private var name = ""

    func body(content: Content) -> some View {
        content.alert("New event", isPresented: $model.namingEvent) {
            TextField("Its name, such as RaceGOW7", text: $name)
            Button("Create") {
                if let problem = model.newEvent(named: name) { model.notice = problem }
                name = ""
            }
            Button("Cancel", role: .cancel) { name = "" }
        } message: {
            Text("An event is a race, a series, or just somewhere you fly. It gets its own folder in your library, with its own tracks, its own name on the timer and its own ID.")
        }
    }
}

// MARK: - Setting up

/// The questions a new pilot is asked after the welcome note: their pilot name, and whether they fly
/// this season of RaceGOW. A pilot who does is looked up on the series' own pilot list, by name or
/// by number, so their registration number doesn't have to be typed.
struct SetUpSheet: View {
    @EnvironmentObject var model: Model
    /// A pilot name to start on the second question with, already answered yes and looked up. Only
    /// the mode that draws pages uses it.
    var lookingUp: String?
    @State private var second = false
    @State private var pilot = ""
    /// Nil until the question has been answered.
    @State private var flies: Bool?
    @State private var asked = ""
    @State private var search = Search.idle
    /// The list, once it has been read, so a second try doesn't fetch it again.
    @State private var list: [PilotList.Pilot]?
    @State private var chosen: PilotList.Pilot?
    @State private var number = ""
    @FocusState private var typing: Bool

    enum Search: Equatable {
        case idle, reading
        case found([PilotList.Pilot])
        case failed(String)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 16) {
                Text(second ? "SETTING UP  ·  2 OF 2" : "SETTING UP  ·  1 OF 2").label()
                if second { series } else { name }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(26)
            Divider().overlay(Theme.stroke)
            HStack(spacing: 10) {
                if second {
                    Button("Back") { second = false }.buttonStyle(SecondaryButton())
                } else {
                    Button("Skip for now") { model.note = nil }.buttonStyle(SecondaryButton())
                        .help("Nothing is set. Pilot & settings has all of this, and can ask again.")
                }
                Spacer()
                if second {
                    Button("Finish") { finish() }.buttonStyle(PrimaryButton()).disabled(flies == nil || search == .reading).keyboardShortcut(.defaultAction)
                } else {
                    Button("Next") { second = true }.buttonStyle(PrimaryButton())
                        .disabled(pilot.trimmingCharacters(in: .whitespaces).isEmpty).keyboardShortcut(.defaultAction)
                }
            }
            .padding(18)
        }
        .frame(width: 600)
        .background(Theme.background)
        .preferredColorScheme(.dark)
        .onAppear {
            if pilot.isEmpty { pilot = model.settings.pilot }
            typing = true
            if let lookingUp {
                pilot = lookingUp
                asked = lookingUp
                second = true
                flies = true
                lookUp()
            }
        }
    }

    private func field(_ prompt: String, text: Binding<String>, large: Bool = false) -> some View {
        TextField(prompt, text: text)
            .textFieldStyle(.plain).font(.system(size: large ? 18 : 14, weight: large ? .bold : .regular))
            .padding(.horizontal, 13).padding(.vertical, large ? 12 : 9)
            .background(Theme.raised, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var name: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("What's your pilot name?").font(.system(size: 28, weight: .black))
            Text("It goes on every timer and finished video, and into race entry forms. Use the name you race under.")
                .font(.system(size: 13)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
            field("Pilot name", text: $pilot, large: true).focused($typing)
                .onSubmit { if !pilot.trimmingCharacters(in: .whitespaces).isEmpty { second = true } }
        }
    }

    private var series: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Are you flying \(PilotList.season)?").font(.system(size: 28, weight: .black))
            Text("\(PilotList.season) is this season of the RaceGOW whoop racing series. If you are registered, the app can find your registration number on the series' pilot list.")
                .font(.system(size: 13)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                answer("Yes, I'm in \(PilotList.season)", picked: flies == true) {
                    flies = true
                    if asked.isEmpty { asked = pilot }
                    if search == .idle { lookUp() }
                }
                answer("No", picked: flies == false) { flies = false }
            }
            if flies == true {
                HStack(spacing: 8) {
                    field("Pilot name or \(PilotList.idLabel)", text: $asked).onSubmit(lookUp)
                    Button("Look up") { lookUp() }.buttonStyle(SecondaryButton())
                        .disabled(asked.trimmingCharacters(in: .whitespaces).isEmpty || search == .reading)
                }
                .padding(.top, 4)
                results
            } else if flies == false {
                Text("That's fine. In the Video Creator, press New event and name it after whatever you fly: a race, a series, or just practice. Its name is what goes on your timer.")
                    .font(.system(size: 13)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true).padding(.top, 4)
            }
        }
    }

    private func answer(_ title: String, picked: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 7) {
                if picked { Image(systemName: "checkmark").font(.system(size: 11, weight: .black)) }
                Text(title)
            }
            .font(.system(size: 13, weight: .heavy)).foregroundStyle(picked ? Theme.onAccent : .white)
            .padding(.horizontal, 16).padding(.vertical, 10)
            .background(picked ? Theme.accent : Theme.raised, in: Capsule())
            .overlay(Capsule().strokeBorder(picked ? Color.clear : Theme.stroke))
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder private var results: some View {
        switch search {
        case .idle:
            EmptyView()
        case .reading:
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Reading the \(PilotList.season) pilot list…").font(.system(size: 13)).foregroundStyle(Theme.dim)
            }
        case .found(let pilots):
            if pilots.isEmpty {
                Text("Nobody on the \(PilotList.season) pilot list matches that. Try your registration number, or the name exactly as you registered it. You can also type your ID here and carry on.")
                    .font(.system(size: 13)).foregroundStyle(Theme.warn).fixedSize(horizontal: false, vertical: true)
                byHand
            } else {
                Text(pilots.count == 1 ? "Found on the \(PilotList.season) pilot list:" : "Which of these is you?")
                    .font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.dim)
                VStack(spacing: 4) {
                    ForEach(pilots) { one in
                        Button {
                            chosen = one
                            number = one.number
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: chosen == one ? "checkmark.circle.fill" : "circle").foregroundStyle(chosen == one ? Theme.good : Theme.faint)
                                Text(one.name).font(.system(size: 15, weight: .heavy))
                                Spacer()
                                Text("\(PilotList.idLabel) \(one.number)".uppercased()).font(.system(size: 11, weight: .heavy)).tracking(1.1).foregroundStyle(Theme.accent)
                            }
                            .padding(.horizontal, 12).padding(.vertical, 9)
                            .background(chosen == one ? Theme.good.opacity(0.12) : Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                if let chosen, chosen.name != pilot.trimmingCharacters(in: .whitespaces) {
                    Text("Your videos and entries will say \(chosen.name), the way the list spells it.")
                        .font(.system(size: 12)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
                }
            }
        case .failed(let reason):
            Text("The pilot list couldn't be read: \(reason). You can type your ID here, or leave it and add it later in Pilot & settings.")
                .font(.system(size: 13)).foregroundStyle(Theme.warn).fixedSize(horizontal: false, vertical: true)
            byHand
        }
    }

    /// The registration number typed by the pilot, for when the list can't supply it.
    private var byHand: some View {
        HStack(spacing: 10) {
            Text(PilotList.idLabel).font(.system(size: 13, weight: .semibold))
            field("Such as 042", text: $number).frame(width: 150)
        }
    }

    private func lookUp() {
        let query = asked
        guard !query.trimmingCharacters(in: .whitespaces).isEmpty, search != .reading else { return }
        chosen = nil
        number = ""
        func show(_ pilots: [PilotList.Pilot]) {
            let found = PilotList.find(query, in: pilots)
            search = .found(found)
            // Only one it could be: that one is taken, and can still be un-picked by looking again.
            if found.count == 1 {
                chosen = found[0]
                number = found[0].number
            }
        }
        if let list {
            show(list)
            return
        }
        search = .reading
        Task {
            do {
                let pilots = try await PilotList.read()
                list = pilots
                show(pilots)
            } catch {
                search = .failed(error.localizedDescription)
            }
        }
    }

    private func finish() {
        model.finishSetUp(pilot: flies == true ? (chosen?.name ?? pilot) : pilot, fliesRaceGOW: flies == true, number: chosen?.number ?? number)
    }
}

// MARK: - The first screen

/// The hangar: every tool as a tile, grouped by suite. A tool that isn't built yet says so.
struct HomeView: View {
    @EnvironmentObject var model: Model

    var body: some View {
        GeometryReader { window in
            ScrollView {
                VStack(alignment: .leading, spacing: 38) {
                    header
                    ForEach(Suite.allCases) { suite in section(suite) }
                    footer
                }
                .padding(.horizontal, 34).padding(.top, 52).padding(.bottom, 70)
                .frame(maxWidth: Layout.page, alignment: .leading)
                // In the middle of the window both ways, like the front of a kiosk, when there is room to spare.
                .frame(maxWidth: .infinity, minHeight: window.size.height)
            }
        }
    }

    private var header: some View {
        HStack(alignment: .bottom, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 0) {
                    Text("FPV").foregroundStyle(.white)
                    Text("HANGAR").foregroundStyle(Theme.accent)
                }
                .font(.system(size: 46, weight: .black)).tracking(1.5)
                Text("TOOLS FOR FPV PILOTS").label()
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 10) {
                if model.settings.pilot.isEmpty {
                    Button { model.open(.settings) } label: {
                        Label("Add your pilot name", systemImage: "person.crop.circle.badge.plus").font(.system(size: 13, weight: .heavy)).foregroundStyle(Theme.accent)
                    }
                    .buttonStyle(.plain).help("Your name goes on every timer and video. Pilot & settings is where it is typed.")
                } else {
                    Text(model.settings.pilot).font(.system(size: 17, weight: .heavy))
                }
                HStack(spacing: 8) {
                    Button { model.open(.guide) } label: { Label("How it works", systemImage: "book") }.buttonStyle(SecondaryButton()).probe("home guide")
                    Button { model.open(.settings) } label: { Label("Pilot & settings", systemImage: "gearshape") }.buttonStyle(SecondaryButton()).probe("home settings")
                }
            }
        }
    }

    private func section(_ suite: Suite) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(suite.title.uppercased()).font(.system(size: 22, weight: .black)).tracking(1.2)
                    Text(suite.summary).font(.system(size: 13)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 12)
                // The series' own site.
                HStack(spacing: 4) {
                    ForEach(suite.links, id: \.address) { link in
                        Button {
                            if let url = URL(string: link.address) { NSWorkspace.shared.open(url) }
                        } label: {
                            HStack(spacing: 4) {
                                Text(link.title).font(.system(size: 12, weight: .semibold))
                                Image(systemName: "arrow.up.right").font(.system(size: 8, weight: .heavy))
                            }
                            .foregroundStyle(Theme.dim).padding(.horizontal, 8).padding(.vertical, 5).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain).help("Opens \(link.address) in your browser")
                    }
                }
            }
            // Up to three tiles to a row, sharing its whole width.
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 16, alignment: .top), count: min(3, max(2, suite.tools.count))), alignment: .leading, spacing: 16) {
                ForEach(suite.tools) { tool in
                    ToolTile(tool: tool, status: status(of: tool), action: action(for: tool)).probe("tile \(tool.rawValue)")
                }
            }
        }
    }

    /// What opening a tool does. Nil for one that isn't there to open yet.
    private func action(for tool: Tool) -> (() -> Void)? {
        switch tool {
        case .videoCreator: return { model.openVideoCreator() }
        case .leaderboards: return { model.open(.leaderboard) }
        case .anyFootage, .upload: return nil
        }
    }

    /// A line about where a tool stands, for its tile.
    private func status(of tool: Tool) -> String? {
        switch tool {
        case .videoCreator:
            let tracks = model.tracks.count
            guard tracks > 0 else { return "No tracks yet" }
            // In the season, what matters most is the next deadline of a track that hasn't been sent in.
            let open = model.tracks.compactMap { track in model.seasonTrack(for: track).map { (track, $0) } }
                .filter { $0.1.deadline > Date() && model.state($0.0).submissions.isEmpty }.min { $0.1.deadline < $1.1.deadline }
            if let open {
                let days = Int(open.1.deadline.timeIntervalSinceNow / 86400)
                return "\(open.1.name) closes \(days >= 1 ? "in \(days) day\(days == 1 ? "" : "s")" : "today")"
            }
            let timed = model.tracks.filter { model.summaries[$0]?.best?.best != nil }.count
            return "\(tracks) track\(tracks == 1 ? "" : "s"), \(timed) with a time"
        case .leaderboards:
            let sent = model.tracks.filter { !model.state($0).submissions.isEmpty }.count
            return sent == 0 ? "Nothing submitted yet" : "\(sent) track\(sent == 1 ? "" : "s") submitted"
        case .anyFootage, .upload: return nil
        }
    }

    private var footer: some View {
        HStack(spacing: 10) {
            Text("FPV Hangar v\(AppVersion.current)").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.faint)
            if AppVersion.isTestCopy { TestCopyBadge() }
            if case .available(let release) = model.update { UpdatePill(version: release.version) }
            Spacer()
            Button("What's new") { model.note = .whatsNew(since: nil) }.buttonStyle(.plain)
                .font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.dim).help("What changed in each version")
        }
    }
}

/// One tool on the first screen. A tool with nothing to open yet is dimmed and can't be pressed.
struct ToolTile: View {
    let tool: Tool
    var status: String?
    var action: (() -> Void)?
    @State private var over = false

    var body: some View {
        Button { action?() } label: {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top) {
                    Image(systemName: tool.icon).font(.system(size: 20, weight: .bold))
                        .foregroundStyle(action == nil ? Theme.dim : Theme.onAccent)
                        .frame(width: 48, height: 48)
                        .background(action == nil ? Theme.raised : Theme.accent, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                    Spacer()
                    if tool.comingSoon != nil { ComingSoonBadge() }
                }
                Text(tool.title).font(.system(size: 21, weight: .black)).padding(.top, 4)
                Text(tool.summary).font(.system(size: 13)).foregroundStyle(Theme.dim)
                    .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 6)
                HStack {
                    if let status { Text(status).font(.system(size: 12, weight: .bold)).foregroundStyle(Theme.faint) }
                    Spacer()
                    if action != nil {
                        HStack(spacing: 5) {
                            Text("Open")
                            Image(systemName: "arrow.right")
                        }
                        .font(.system(size: 12, weight: .heavy)).foregroundStyle(over ? Theme.accent : .white)
                    }
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, minHeight: 208, alignment: .topLeading)
            .background(over && action != nil ? Theme.raised : Theme.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(over && action != nil ? Theme.accent.opacity(0.75) : Theme.stroke, lineWidth: over && action != nil ? 1.5 : 1))
            .opacity(action == nil ? 0.72 : 1)
            .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(action == nil)
        .onHover { over = $0 }
        .help(action == nil ? (tool.comingSoon?.detail ?? "") : "Open \(tool.title)")
        .accessibilityLabel(action == nil ? "\(tool.title), coming soon" : "Open \(tool.title)")
    }
}

/// Says a copy is one built to try changes in.
struct TestCopyBadge: View {
    var body: some View {
        Text("TEST COPY").font(.system(size: 10, weight: .heavy)).tracking(1.1).foregroundStyle(Theme.onAccent)
            .padding(.horizontal, 7).padding(.vertical, 3).background(Theme.warn, in: Capsule())
            .help("A copy for trying changes before they are released. It doesn't update itself.")
    }
}

/// Says a newer version is ready. Pressing it goes to where it is installed.
struct UpdatePill: View {
    @EnvironmentObject var model: Model
    let version: String

    var body: some View {
        Button { model.open(.settings) } label: {
            Text("UPDATE TO V\(version)").font(.system(size: 10, weight: .heavy)).tracking(1.1).foregroundStyle(Theme.onAccent)
                .padding(.horizontal, 9).padding(.vertical, 5).background(Theme.accent, in: Capsule())
        }
        .buttonStyle(.plain).help("A newer version is ready. Open Pilot & settings to install it.")
    }
}

/// The way back from a page that was opened from somewhere: to the hangar, or to the Video Creator.
struct BackLink: View {
    @EnvironmentObject var model: Model

    var body: some View {
        Button { model.goBack() } label: { Label(model.backTitle, systemImage: "chevron.left") }
            .buttonStyle(SecondaryButton()).help("Back to \(model.backTitle == "Hangar" ? "all the tools" : "the Video Creator")").probe("back")
    }
}

/// The Video Creator before it has a track: with no event yet, or an event with nothing in it.
struct NoTracksView: View {
    @EnvironmentObject var model: Model

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            Text("VIDEO CREATOR").font(.system(size: 40, weight: .black)).tracking(0.5)
            VStack(alignment: .leading, spacing: 10) {
                if model.events.isEmpty {
                    Text("No events yet").font(.system(size: 18, weight: .heavy))
                    Text("An event is a race, a series, or just somewhere you fly. It has its own tracks, and its name goes on the timer of every video you make in it.")
                        .font(.system(size: 13)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 10) {
                        Button("New event") { model.namingEvent = true }.buttonStyle(PrimaryButton()).probe("new event")
                        Button("I fly \(PilotList.season)") { model.note = .setUp }.buttonStyle(SecondaryButton())
                            .help("Answer the setup questions: the app makes the \(PilotList.season) event and looks up your registration number.")
                    }
                } else {
                    Text("No tracks yet").font(.system(size: 18, weight: .heavy))
                    Text("A track is one course you fly in an event. Make one, add your recordings to it, and mark the laps on them.")
                        .font(.system(size: 13)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
                    Button("New track") { model.newTrack(in: model.events.first?.folder ?? "") }.buttonStyle(PrimaryButton()).probe("new track")
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card(padding: 22)
        }
        .padding(.horizontal, 34).padding(.top, 40)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The question before a track or event with something in it goes to the Trash. The button only
/// works once the phrase has been typed, so it can't be done by a stray click.
struct RemovalSheet: View {
    @EnvironmentObject var model: Model
    let pending: Model.PendingRemoval
    @State private var typed = ""
    @FocusState private var typing: Bool

    private var ready: Bool {
        typed.trimmingCharacters(in: .whitespacesAndNewlines).caseInsensitiveCompare(Model.removalPhrase) == .orderedSame
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label(pending.title, systemImage: "trash.fill").font(.system(size: 19, weight: .black)).foregroundStyle(Theme.warn)
            Text(pending.detail).font(.system(size: 13)).foregroundStyle(.white.opacity(0.88)).fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 7) {
                (Text("To go ahead, type ") + Text(Model.removalPhrase).fontWeight(.heavy).foregroundColor(Theme.accent) + Text(" below."))
                    .font(.system(size: 13)).foregroundStyle(Theme.dim)
                TextField("", text: $typed)
                    .textFieldStyle(.plain).font(.system(size: 14, weight: .semibold))
                    .padding(.horizontal, 12).padding(.vertical, 9)
                    .background(Theme.raised, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                    .focused($typing)
                    .onSubmit { model.confirmRemoval(typed: typed) }
            }
            HStack {
                Spacer()
                Button("Cancel") { model.pendingRemoval = nil }.buttonStyle(SecondaryButton()).keyboardShortcut(.cancelAction)
                Button("Move to Trash") { model.confirmRemoval(typed: typed) }.buttonStyle(PrimaryButton()).disabled(!ready)
            }
        }
        .padding(24)
        .frame(width: 500)
        .background(Theme.background)
        .preferredColorScheme(.dark)
        .onAppear { typing = true }
    }
}

struct Sidebar: View {
    @EnvironmentObject var model: Model

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 14) {
                Button { model.page = .home } label: { Label("Hangar", systemImage: "chevron.left") }
                    .buttonStyle(SecondaryButton()).help("Back to all the tools").probe("tool hangar")
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 0) {
                        Text("VIDEO").foregroundStyle(.white)
                        Text("CREATOR").foregroundStyle(Theme.accent)
                    }
                    .font(.system(size: 21, weight: .black)).tracking(1)
                    Text("RACEGOW").label()
                }
            }
            .padding(.horizontal, 20).padding(.top, 40).padding(.bottom, 24)

            // Events and their tracks can outgrow the window, so this part scrolls.
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(model.events) { event in
                        let title = model.details(ofEvent: event.folder).name
                        Text((title.isEmpty ? "Tracks" : title).uppercased()).label().lineLimit(1)
                            .padding(.horizontal, 20).padding(.top, event.id == model.events.first?.id ? 0 : 20).padding(.bottom, 8)
                            .frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                            .contextMenu {
                                Button("New track") { model.newTrack(in: event.folder) }
                                // Only an event with a folder of its own can go, and only once its tracks have.
                                if !event.folder.isEmpty {
                                    Button(event.tracks.isEmpty ? "Move this event to the Trash" : "Delete its tracks first to delete this event") {
                                        model.askToDelete(event: event.folder)
                                    }
                                    .disabled(!event.tracks.isEmpty)
                                }
                            }
                        ForEach(event.tracks, id: \.self) { track in
                            SidebarRow(title: Model.trackName(track), detail: model.summaries[track]?.best?.best?.seconds, selected: model.page == .track(track)) {
                                model.page = .track(track)
                            }
                            .contextMenu {
                                Button("Move \(Model.trackName(track)) to the Trash") { model.askToDelete(track: track) }
                            }
                        }
                        if let next = model.nextSeasonTrack(in: event.folder) {
                            // The season's next track: it becomes a track of its own on the day it opens.
                            HStack {
                                RoundedRectangle(cornerRadius: 2).fill(.clear).frame(width: 3, height: 18)
                                Text(next.name).font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.faint)
                                Spacer()
                                Text("OPENS " + next.release.formatted(.dateTime.month(.abbreviated).day()).uppercased())
                                    .font(.system(size: 9, weight: .heavy)).tracking(0.8).foregroundStyle(Theme.faint)
                            }
                            .padding(.leading, 8).padding(.trailing, 16).padding(.vertical, 9)
                            .help("\(next.name) opens on \(next.release.formatted(date: .complete, time: .shortened)) and its entries close on \(next.deadline.formatted(date: .complete, time: .shortened)). It will appear here by itself.")
                        } else if event.folder != model.seasonEvent || model.season(of: event.folder).isEmpty {
                        Button { model.newTrack(in: event.folder) } label: {
                            Label("New track", systemImage: "plus").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.dim)
                        }
                        .buttonStyle(.plain).padding(.horizontal, 20).padding(.top, 10)
                        }
                    }
                    Button { model.namingEvent = true } label: {
                        Label("New event", systemImage: "folder.badge.plus").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.dim)
                    }
                    .buttonStyle(.plain).padding(.horizontal, 20).padding(.top, 20)
                    .help("Another race or series, with its own tracks, its own name on the timer and its own ID.")

                }
                .padding(.bottom, 12)
            }

            Spacer()
            SidebarRow(title: "Pilot & settings", detail: nil, selected: false) { model.open(.settings) }.probe("tool settings")
            SidebarRow(title: "How it works", detail: nil, selected: false) { model.open(.guide) }.probe("tool guide")
            VStack(alignment: .leading, spacing: 3) {
                if case .available(let release) = model.update { UpdatePill(version: release.version).padding(.bottom, 8) }
                if model.settings.pilot.isEmpty {
                    Button("Add your pilot name") { model.open(.settings) }.buttonStyle(.plain)
                        .font(.system(size: 15, weight: .heavy)).foregroundStyle(Theme.accent)
                } else {
                    Text(model.settings.pilot).font(.system(size: 15, weight: .heavy)).foregroundStyle(.white)
                }
                // The ID is the event's: the one for the track that is showing.
                let event = model.details(ofEvent: model.currentEvent)
                if !event.id.isEmpty {
                    Text("\(event.idLabel) \(event.id)".uppercased())
                        .font(.system(size: 10, weight: .heavy)).tracking(1.3).foregroundStyle(Theme.accent)
                }
                Text("FPV Hangar v\(AppVersion.current)").font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.faint).padding(.top, 4)
                if AppVersion.isTestCopy { TestCopyBadge().padding(.top, 3) }
            }
            .padding(20)
        }
        .frame(width: 228)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Theme.sidebar)
    }
}

struct SidebarRow: View {
    let title: String
    let detail: String?
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                RoundedRectangle(cornerRadius: 2).fill(selected ? Theme.accent : .clear).frame(width: 3, height: 18)
                Text(title).font(.system(size: 14, weight: selected ? .heavy : .semibold)).foregroundStyle(selected ? .white : Theme.dim)
                Spacer()
                if let detail {
                    Text(detail).font(.system(size: 12, weight: .bold).monospacedDigit()).foregroundStyle(selected ? Theme.accent : Theme.faint)
                }
            }
            .padding(.leading, 8).padding(.trailing, 16).padding(.vertical, 9)
            .background(selected ? Color.white.opacity(0.06) : .clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Shows what is rendering, or the last thing that happened.
struct StatusBar: View {
    @EnvironmentObject var model: Model

    var body: some View {
        if let job = model.job {
            HStack(spacing: 14) {
                Text(job.title).font(.system(size: 13, weight: .bold))
                ProgressView(value: job.progress).tint(Theme.accent).frame(maxWidth: 260)
                Text("\(Int(job.progress * 100))%").font(.system(size: 13, weight: .heavy).monospacedDigit()).foregroundStyle(Theme.accent)
            }
            .padding(.horizontal, 20).padding(.vertical, 13)
            .background(Theme.raised, in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.stroke))
            .padding(.bottom, 22)
        } else if let notice = model.notice {
            HStack(spacing: 12) {
                Text(notice).font(.system(size: 13, weight: .semibold)).lineLimit(8).fixedSize(horizontal: false, vertical: true)
                Button { model.notice = nil } label: { Image(systemName: "xmark").font(.system(size: 10, weight: .heavy)) }
                    .buttonStyle(.plain).foregroundStyle(Theme.dim)
            }
            .padding(.horizontal, 20).padding(.vertical, 13)
            .background(Theme.raised, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Theme.stroke))
            .frame(maxWidth: 680)
            .padding(.bottom, 22)
        }
    }
}

// MARK: - Track page

struct TrackView: View {
    @EnvironmentObject var model: Model
    let track: String
    /// True while recordings are being dragged over the page.
    @State private var dropping = false

    private var summary: TrackSummary { model.summaries[track] ?? TrackSummary() }
    private var state: TrackState { model.state(track) }
    private var form: FormDefinition? { model.form(track) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 8) {
                    header
                    if let season = model.seasonTrack(for: track) { seasonLine(season) }
                }
                stats
                FormLinkCard(track: track)
                if !summary.undecided.isEmpty { undecidedCard }
                runs
                clips
                if !summary.skipped.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("LEFT OUT").label()
                        ForEach(summary.skipped, id: \.file) { item in
                            Text("\(item.file): \(item.reason)").font(.system(size: 12)).foregroundStyle(Theme.dim)
                        }
                    }
                }
            }
            .padding(.horizontal, 34).padding(.top, 40).padding(.bottom, 90)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear {
            model.loadSummary(track)
            model.loadForm(track)
        }
        // Recordings dropped anywhere on the page are added to the track.
        .dropDestination(for: URL.self) { dropped, _ in
            model.addClips(dropped, to: track)
            return true
        } isTargeted: { dropping = $0 }
        .overlay {
            if dropping {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(Theme.background.opacity(0.82))
                    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Theme.accent, style: StrokeStyle(lineWidth: 3, dash: [12, 7])))
                    .overlay(Label("Drop to add to \(Model.trackName(track))", systemImage: "square.and.arrow.down").font(.system(size: 20, weight: .heavy)).foregroundStyle(Theme.accent))
                    .padding(14)
                    .allowsHitTesting(false)
            }
        }
    }

    private var header: some View {
        HStack(alignment: .lastTextBaseline, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                let event = model.details(ofEvent: Model.eventFolder(of: track)).name
                if !event.isEmpty { Text(event.uppercased()).label() }
                Text(Model.trackName(track).uppercased()).font(.system(size: 40, weight: .black)).tracking(0.5)
            }
            if let deadline = form?.deadline ?? model.seasonTrack(for: track)?.deadline { DeadlinePill(deadline: deadline) }
            Spacer()
            Button("Add clips…") { model.chooseClips(for: track) }.buttonStyle(SecondaryButton()).disabled(model.job != nil)
                .help("Copy recordings into this track. You can also drop them onto this page.")
            Button("Refresh") { model.refresh() }.buttonStyle(SecondaryButton())
            Button("Open folder") { NSWorkspace.shared.open(model.root.appendingPathComponent(track)) }.buttonStyle(SecondaryButton())
            Button { model.askToDelete(track: track) } label: { Image(systemName: "trash") }
                .buttonStyle(SecondaryButton()).disabled(model.job != nil).accessibilityLabel("Move this track to the Trash")
                .help("Move this track to the Trash. If there is anything in it, you are asked to type \(Model.removalPhrase) first.")
        }
    }

    /// What the series' schedule says about one of the season's tracks.
    private func seasonLine(_ season: SeasonTrack) -> some View {
        var parts: [String] = []
        if let sponsor = season.sponsor { parts.append("Sponsored by \(sponsor)") }
        if let designer = season.designer { parts.append("designed by \(designer)") }
        // The deadline the way the series writes it, on the Pacific coast, and in the pilot's own time when that differs.
        var pacific = Date.FormatStyle.dateTime.weekday(.wide).month(.wide).day().hour().minute()
        pacific.timeZone = SeasonSchedule.zone
        var closes = "entries close \(season.deadline.formatted(pacific)) Pacific"
        if TimeZone.current.secondsFromGMT(for: season.deadline) != SeasonSchedule.zone.secondsFromGMT(for: season.deadline) {
            closes += " (\(season.deadline.formatted(.dateTime.weekday(.abbreviated).hour().minute())) your time)"
        }
        parts.append(closes)
        var day = Date.FormatStyle.dateTime.weekday(.wide).month(.wide).day()
        day.timeZone = SeasonSchedule.zone
        if let stream = season.livestream { parts.append("results stream \(stream.formatted(day))") }
        return Text(parts.joined(separator: "  ·  ")).font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.dim)
            .fixedSize(horizontal: false, vertical: true)
            .help("From the series' schedule on racegow.com.")
    }

    private var stats: some View {
        HStack(spacing: 14) {
            StatCard(title: "BEST \(summary.window) LAPS IN A ROW", value: summary.best?.best?.seconds ?? "–",
                     detail: summary.best.map { "\($0.name), laps \($0.best!.firstLap)–\($0.best!.lastLap)" } ?? "No timed runs yet", highlight: true)
            StatCard(title: "BEST LAP", value: summary.runs.map(\.bestLap).min { (Double($0) ?? .infinity) < (Double($1) ?? .infinity) } ?? "–",
                     detail: "\(summary.runs.count) run\(summary.runs.count == 1 ? "" : "s") marked")
            StatCard(title: "SUBMITTED", value: state.submissions.last?.time ?? "–",
                     detail: state.submissions.last.map { "\($0.run), \($0.date.formatted(date: .abbreviated, time: .shortened))" } ?? "Nothing sent yet")
        }
    }

    private var undecidedCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Check the frame rate for \(summary.undecided.map(\.name).joined(separator: ", "))", systemImage: "exclamationmark.triangle.fill")
                .font(.system(size: 14, weight: .heavy)).foregroundStyle(Theme.warn)
            if let first = summary.undecided.first {
                Text("These clips record \(first.actual) frames a second but their header says \(first.claimed), and Premiere goes by the header. Look at Sequence > Sequence Settings > Timebase in Premiere and pick what it says, so the lap times come out right.")
                    .font(.system(size: 13)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 10) {
                    ForEach([first.claimed, first.actual], id: \.self) { rate in
                        Button("\(rate) fps") {
                            model.update(track) { $0.mismatchFPS = rate }
                            model.loadSummary(track)
                        }
                        .buttonStyle(SecondaryButton())
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    @ViewBuilder private var runs: some View {
        if summary.runs.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text("No runs yet").font(.system(size: 18, weight: .heavy))
                Text((model.clips[track] ?? []).isEmpty
                     ? "Add your recordings: press Add clips, or drop them onto this page. Each one then gets a Mark laps button."
                     : "Press Mark laps on a clip below, step to each start/finish gate crossing and press M. Press Done, and the run shows up here, ranked.")
                    .font(.system(size: 13)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
                if (model.clips[track] ?? []).isEmpty {
                    Button("Add clips…") { model.chooseClips(for: track) }.buttonStyle(PrimaryButton()).disabled(model.job != nil)
                }
                if !model.toolFound {
                    Text("The lap timer that belongs inside this app is missing, so nothing can be timed. Download the app again.")
                        .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.warn)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card(padding: 22)
        } else {
            VStack(alignment: .leading, spacing: 10) {
                Text("RUNS, FASTEST FIRST").label()
                ForEach(Array(summary.runs.enumerated()), id: \.element.id) { index, run in
                    RunCard(track: track, run: run, rank: run.best == nil ? nil : index + 1, window: summary.window,
                            submitted: state.submissions.last { $0.run == run.name })
                }
            }
        }
    }
}

extension TrackView {
    /// Clips in Raw files that have no timed run yet.
    private var unmarked: [String] {
        let timed = Set(summary.runs.map { $0.name.lowercased() })
        return (model.clips[track] ?? []).filter { !timed.contains(URL(fileURLWithPath: $0).deletingPathExtension().lastPathComponent.lowercased()) }
    }

    @ViewBuilder fileprivate var clips: some View {
        let clips = unmarked
        if !clips.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text("CLIPS NOT MARKED YET").label()
                VStack(spacing: 0) {
                    ForEach(Array(clips.enumerated()), id: \.element) { index, clip in
                        let file = RunFile(path: clip, kind: "Race clip", icon: "film")
                        if index > 0 { Divider().overlay(Theme.stroke) }
                        HStack(spacing: 10) {
                            Image(systemName: file.icon).font(.system(size: 14)).foregroundStyle(Theme.dim).frame(width: 22)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(file.name).font(.system(size: 13, weight: .bold))
                                Text(file.detail).font(.system(size: 11, weight: .medium)).foregroundStyle(Theme.faint)
                            }
                            Spacer()
                            Button(model.vlc == nil ? "Open" : "Open in VLC") { model.play(clip) }.buttonStyle(SecondaryButton())
                            Button("Mark laps") { model.mark(clip: clip, track: track) }.buttonStyle(SecondaryButton())
                                .help("Step through this clip and mark each start/finish gate crossing.")
                            // A clip added by mistake, or not worth marking, can go from here.
                            Button { model.askToTrash([file], track: track) } label: { Image(systemName: "trash") }
                                .buttonStyle(SecondaryButton()).help("Move this clip to the Trash. It asks first.")
                                .accessibilityLabel("Move \(file.name) to the Trash")
                        }
                        .padding(.vertical, 8)
                    }
                }
                .card(padding: 14)
            }
        }
    }
}

struct DeadlinePill: View {
    let deadline: Date

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            let left = deadline.timeIntervalSince(context.date)
            let text: String = {
                if left <= 0 { return "SUBMISSIONS CLOSED" }
                let days = Int(left) / 86400, hours = Int(left) % 86400 / 3600, minutes = Int(left) % 3600 / 60
                return days > 0 ? "\(days)D \(hours)H LEFT TO SUBMIT" : "\(hours)H \(minutes)M LEFT TO SUBMIT"
            }()
            Text(text)
                .font(.system(size: 11, weight: .heavy)).tracking(1.2)
                .foregroundStyle(left < 86400 ? Theme.onAccent : Theme.accent)
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(left < 86400 ? Theme.warn : Theme.accent.opacity(0.14), in: Capsule())
                .help(deadline.formatted(date: .complete, time: .shortened))
        }
    }
}

struct StatCard: View {
    let title: String
    let value: String
    let detail: String
    var highlight = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).label()
            Text(value)
                .font(.system(size: highlight ? 46 : 34, weight: .black).monospacedDigit())
                .foregroundStyle(highlight ? Theme.accent : .white)
                .minimumScaleFactor(0.6).lineLimit(1)
            Text(detail).font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.dim).lineLimit(1)
        }
        .frame(maxWidth: .infinity, minHeight: 104, alignment: .topLeading)
        .card()
    }
}

struct FormLinkCard: View {
    @EnvironmentObject var model: Model
    let track: String
    @State private var address = ""

    var body: some View {
        let saved = model.state(track).formURL
        VStack(alignment: .leading, spacing: 8) {
            Text("SUBMISSION FORM").label()
            HStack(spacing: 10) {
                TextField("Paste this track's Google Form link", text: $address)
                    .textFieldStyle(.plain).font(.system(size: 13))
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(Theme.raised, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                    .onSubmit(save)
                Button("Use this form", action: save).buttonStyle(SecondaryButton()).disabled(address == saved)
            }
            if let form = model.form(track) {
                Label("\(form.title): \(form.questions.count) questions", systemImage: "checkmark.circle.fill")
                    .font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.good)
            } else if let problem = model.formProblems[saved.trimmingCharacters(in: .whitespaces)] {
                Label(problem, systemImage: "exclamationmark.triangle.fill").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.warn)
            } else if saved.isEmpty {
                Text(model.seasonTrack(for: track) == nil ? "Each track has its own form. Paste the link once and Submit fills it in for you."
                     : "Each track has its own form. The series posts it on racegow.com when the track opens, and it is filled in here by itself. If it hasn't been yet, paste the link.")
                    .font(.system(size: 12)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
        .onAppear { address = saved }
        // The link can arrive by itself: from the series' site, or as the form's own address in place of a short link.
        .onChange(of: saved) { _, now in
            address = now
            model.loadForm(track)
        }
    }

    private func save() {
        model.update(track) { $0.formURL = address.trimmingCharacters(in: .whitespaces) }
        model.loadForm(track)
    }
}

struct RunCard: View {
    @EnvironmentObject var model: Model
    let track: String
    let run: RunInfo
    let rank: Int?
    let window: Int
    let submitted: Submission?

    private var open: Bool { model.expanded.contains(run.id) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 18) {
                // Clicking anywhere on the run itself shows or hides its files.
                HStack(alignment: .center, spacing: 18) {
                    Text(rank.map(String.init) ?? "–")
                        .font(.system(size: 22, weight: .black).monospacedDigit())
                        .foregroundStyle(rank == 1 ? Theme.onAccent : .white)
                        .frame(width: 42, height: 42)
                        .background(rank == 1 ? Theme.accent : Theme.raised, in: RoundedRectangle(cornerRadius: 11, style: .continuous))

                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 10) {
                            Text(run.name).font(.system(size: 17, weight: .heavy)).lineLimit(1).fixedSize()
                            Image(systemName: "chevron.right").font(.system(size: 11, weight: .heavy)).foregroundStyle(Theme.dim)
                                .rotationEffect(.degrees(open ? 90 : 0))
                            Text(verbatim: "\(run.width)×\(run.height) · \(run.fps) fps").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.faint).fixedSize()
                        }
                        HStack(spacing: 6) {
                            // Room for eight laps; with more, show the stretch around the best ones.
                            let first = max(0, min((run.best?.firstLap ?? 1) - 3, run.laps.count - 8))
                            if first > 0 { Text("+\(first)").font(.system(size: 12, weight: .bold)).foregroundStyle(Theme.faint).fixedSize() }
                            ForEach(Array(run.laps.enumerated()).dropFirst(first).prefix(8), id: \.offset) { index, lap in
                                let inBest = run.best.map { index + 1 >= $0.firstLap && index + 1 <= $0.lastLap } ?? false
                                Text(lap)
                                    .font(.system(size: 13, weight: .bold).monospacedDigit())
                                    .foregroundStyle(inBest ? Theme.accent : Theme.dim)
                                    .lineLimit(1).fixedSize()
                                    .padding(.horizontal, 9).padding(.vertical, 4)
                                    .background(inBest ? Theme.accent.opacity(0.12) : Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                            }
                            if run.laps.count > first + 8 {
                                Text("+\(run.laps.count - first - 8)").font(.system(size: 12, weight: .bold)).foregroundStyle(Theme.faint).fixedSize()
                            }
                        }
                        let music = model.music(for: run, track: track)
                        if run.coarseStep > 0 || music != nil || submitted != nil {
                            HStack(spacing: 14) {
                                if let music {
                                    Label(URL(fileURLWithPath: music).lastPathComponent, systemImage: "music.note")
                                        .font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.accent).fixedSize()
                                        .help(music == run.music
                                              ? "The finished videos use this as their sound, lined up the way it sits on the run's Premiere timeline."
                                              : "The finished videos use this as their sound, placed where you put it in Markers & music.")
                                }
                                if run.coarseStep > 0 {
                                    Label("markers not on exact frames", systemImage: "exclamationmark.triangle.fill")
                                        .font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.warn).fixedSize()
                                        .help("Every marker sits on a \(run.coarseStep)-frame step, so these times are approximate. Open Markers & music and move each one onto the exact frame of its gate crossing.")
                                }
                                if let submitted {
                                    Label("submitted \(submitted.time)", systemImage: "checkmark.seal.fill")
                                        .font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.good).fixedSize()
                                }
                            }
                        }
                    }
                    Spacer(minLength: 12)

                    VStack(alignment: .trailing, spacing: 2) {
                        Text(run.best?.seconds ?? "–").font(.system(size: 30, weight: .black).monospacedDigit()).foregroundStyle(rank == 1 ? Theme.accent : .white)
                        Text(run.best == nil ? "needs \(window) laps" : "best \(window) in a row").font(.system(size: 10, weight: .heavy)).tracking(1).foregroundStyle(Theme.faint)
                    }
                }
                .contentShape(Rectangle())
                .onTapGesture {
                    if open { model.expanded.remove(run.id) } else { model.expanded.insert(run.id) }
                }
                .help(open ? "Hide this run's files" : "Show this run's files")

                VStack(alignment: .trailing, spacing: 7) {
                    Button("Markers & music") { model.edit(run, track: track) }
                        .buttonStyle(SecondaryButton()).disabled(run.clip.isEmpty)
                        .help(run.clip.isEmpty ? "There's no race clip with this run's name to open." : "Move the lap markers, choose the stretch the videos show, and place a song.")
                    HStack(spacing: 7) {
                        FileButton(output: .landscape, files: run.landscapes ?? []) { model.make(run, track: track, output: .landscape) }
                        FileButton(output: .upright, files: run.uprights) { model.make(run, track: track, output: .upright) }
                    }
                    .disabled(run.clip.isEmpty)
                    .help(run.clip.isEmpty ? "There's no race clip with this run's name to make a video from." : "A finished video with the timer drawn in, ready to upload.")
                    Button("Submit this run") { model.submitting = SubmitTarget(track: track, run: run) }
                        .buttonStyle(PrimaryButton())
                        .disabled(run.best == nil)
                }
                .disabled(model.job != nil)
            }
            if open { RunFiles(track: track, run: run) }
        }
        .card(padding: 16)
    }
}

/// One of a run's files on disk.
struct RunFile: Identifiable {
    let path: String
    let kind: String
    let icon: String
    /// Which render this is. Nil for the race clip and the music, which are never offered for deletion.
    var output: Model.Output?
    var id: String { path }
    var name: String { URL(fileURLWithPath: path).lastPathComponent }

    /// Kind, size and when it was made, such as "Upright video · 74 MB · Today at 4:53 PM".
    var detail: String {
        let attributes = try? FileManager.default.attributesOfItem(atPath: path)
        var parts = [kind]
        if let size = attributes?[.size] as? Int64 { parts.append(ByteCountFormatter.string(fromByteCount: size, countStyle: .file)) }
        if let date = attributes?[.modificationDate] as? Date {
            let formatter = DateFormatter()
            formatter.dateStyle = .medium
            formatter.timeStyle = .short
            formatter.doesRelativeDateFormatting = true
            parts.append(formatter.string(from: date))
        }
        return parts.joined(separator: " · ")
    }
}

extension RunInfo {
    /// Finished videos first, newest on top, then what they were made from. `music` is the sound they get.
    func files(music: String?) -> [RunFile] {
        var list = (landscapes ?? []).reversed().map { RunFile(path: $0, kind: "16:9 video", icon: "rectangle.fill", output: .landscape) }
        list += uprights.reversed().map { RunFile(path: $0, kind: "9:16 video", icon: "rectangle.portrait.fill", output: .upright) }
        list += overlays.reversed().map { RunFile(path: $0, kind: "Timer overlay for Premiere", icon: "timer", output: .overlay) }
        if !clip.isEmpty { list.append(RunFile(path: clip, kind: "Race clip", icon: "film")) }
        if let music { list.append(RunFile(path: music, kind: "Music", icon: "music.note")) }
        return list
    }
}

/// The files behind a run, each with a way to play it. Renders can be thinned down to the right one.
struct RunFiles: View {
    @EnvironmentObject var model: Model
    let track: String
    let run: RunInfo

    var body: some View {
        let files = run.files(music: model.music(for: run, track: track))
        let inPremiere = Set(model.summaries[track]?.premiereMedia ?? [])
        // Renders that exist in more than one version.
        let crowded = [Model.Output.landscape, .upright, .overlay].filter { output in files.filter { $0.output == output }.count > 1 }
        VStack(alignment: .leading, spacing: 4) {
            Divider().overlay(Theme.stroke).padding(.vertical, 12)
            if !crowded.isEmpty {
                Label("More than one version of the \(crowded.map(\.title).joined(separator: " and the ")). Open each, then keep the right one.",
                      systemImage: "square.on.square")
                    .font(.system(size: 12, weight: .bold)).foregroundStyle(Theme.warn).padding(.bottom, 6)
            }
            ForEach(files) { file in
                let versions = files.filter { $0.output != nil && $0.output == file.output }
                let used = inPremiere.contains(file.name.lowercased())
                HStack(spacing: 10) {
                    Image(systemName: file.icon).font(.system(size: 14)).foregroundStyle(Theme.dim).frame(width: 22)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(file.name).font(.system(size: 13, weight: .bold))
                        (Text(file.detail).foregroundColor(Theme.faint)
                            + Text(used && file.output != nil ? "  ·  in your Premiere project" : "").foregroundColor(Theme.accent))
                            .font(.system(size: 11, weight: .medium))
                    }
                    Spacer()
                    if versions.count > 1 {
                        Button("Keep only this one") { model.askToTrash(versions.filter { $0.id != file.id }, track: track) }
                            .buttonStyle(SecondaryButton())
                            .help("Moves the other version\(versions.count > 2 ? "s" : "") of the \(file.output?.title ?? "file") to the Trash.")
                    }
                    Button(model.vlc == nil ? "Open" : "Open in VLC") { model.play(file.path) }.buttonStyle(SecondaryButton())
                    Button("Show in Finder") { model.reveal([file.path]) }.buttonStyle(SecondaryButton())
                    if file.output != nil {
                        Button { model.askToTrash([file], track: track) } label: { Image(systemName: "trash") }
                            .buttonStyle(SecondaryButton()).help("Move to the Trash")
                    }
                }
                .padding(.vertical, 4)
            }
            if files.isEmpty {
                Text("No files for this run yet.").font(.system(size: 12)).foregroundStyle(Theme.dim)
            }
            HStack(spacing: 10) {
                Image(systemName: ComingSoon.upload.icon).font(.system(size: 14)).foregroundStyle(Theme.faint).frame(width: 22)
                Text(ComingSoon.upload.title).font(.system(size: 13, weight: .bold)).foregroundStyle(Theme.dim)
                ComingSoonBadge()
                Spacer()
            }
            .padding(.vertical, 4)
            .help(ComingSoon.upload.detail)
        }
    }
}

/// Makes a file, or offers the ones already made.
struct FileButton: View {
    @EnvironmentObject var model: Model
    let output: Model.Output
    let files: [String]
    let make: () -> Void

    var body: some View {
        if files.isEmpty {
            Button("Make \(output.title)", action: make).buttonStyle(SecondaryButton())
        } else {
            Menu {
                Button(model.vlc == nil ? "Open the newest" : "Open the newest in VLC") { model.play(files.last!) }
                Button("Show in Finder") { model.reveal([files.last!]) }
                Button(files.count == 1 ? "Make a new version" : "Make another version") { make() }
            } label: {
                Label(files.count == 1 ? output.title : "\(output.title) ×\(files.count)", systemImage: files.count == 1 ? "checkmark" : "square.on.square")
                    .font(.system(size: 12, weight: .bold)).foregroundStyle(files.count == 1 ? Theme.good : Theme.warn)
            }
            .menuStyle(.borderlessButton).fixedSize()
            .padding(.horizontal, 11).padding(.vertical, 7)
            .background(Theme.raised, in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.stroke))
        }
    }
}

// MARK: - Submitting

struct SubmitSheet: View {
    @EnvironmentObject var model: Model
    @Environment(\.dismiss) private var dismiss
    let target: SubmitTarget

    @State private var answers: [String: [String]] = [:]
    @State private var email = ""
    @State private var showingForm = false
    @State private var sent = false
    /// The questions with no answer kept from an earlier entry: new on this form, or never answered.
    @State private var fresh: Set<String> = []
    /// The question that is opened up to be answered or changed. One at a time.
    @State private var open: String?
    /// Whether the answers the app fills in are opened up to be changed.
    @State private var changingKnown = false
    /// No email was kept when the window opened, so it is asked for in a place of its own. It stays
    /// there while it is typed: a field must not fold away after its first letter.
    @State private var askingEmail = false
    /// Something the app fills in was empty when the window opened, so those answers are opened up.
    @State private var knownOpened = false

    private var form: FormDefinition? { model.form(target.track) }
    private var time: String { target.run.best?.seconds ?? "" }
    private var missing: [FormQuestion] {
        (form?.questions ?? []).filter { $0.required && $0.kind != .other && (answers[$0.id] ?? []).allSatisfy { $0.trimmingCharacters(in: .whitespaces).isEmpty } }
    }

    /// The form's question that asks for the video's link, if it has one.
    private var linkQuestion: FormQuestion? { form?.questions.first { $0.role == .link } }

    /// The link as typed so far. It is kept while it is typed, so closing the sheet doesn't lose it.
    private var link: Binding<String> {
        Binding(get: { linkQuestion.flatMap { answers[$0.id]?.first } ?? "" }, set: { value in
            guard let question = linkQuestion else { return }
            answers[question.id] = [value]
            model.update(target.track) { $0.links[target.run.name] = value.trimmingCharacters(in: .whitespacesAndNewlines) }
        })
    }

    /// Something@something.something, with no spaces. Enough to catch a slip, not to judge an address.
    static func looksLikeEmail(_ text: String) -> Bool {
        let typed = text.trimmingCharacters(in: .whitespaces)
        let parts = typed.split(separator: "@", omittingEmptySubsequences: false)
        guard parts.count == 2, !parts[0].isEmpty, !typed.contains(" "), let dot = parts[1].lastIndex(of: ".") else { return false }
        return dot != parts[1].startIndex && parts[1].index(after: dot) != parts[1].endIndex
    }

    /// The email is asked for by itself the first time an entry is made: the form won't take one without it.
    private var emailCard: some View {
        let typed = email.trimmingCharacters(in: .whitespaces)
        return VStack(alignment: .leading, spacing: 9) {
            Text("YOUR EMAIL").label()
            Text("The entry form asks for an email address. Type yours once and it is kept for every track after this.")
                .font(.system(size: 12)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
            TextField("Your email address", text: $email)
                .textFieldStyle(.plain).font(.system(size: 14))
                .padding(.horizontal, 12).padding(.vertical, 9)
                .background(Theme.raised, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            if typed.isEmpty {
                Text("The form can't be filled in without it.").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.warn)
            } else if !Self.looksLikeEmail(typed) {
                Label("That isn't a whole email address yet.", systemImage: "exclamationmark.triangle.fill")
                    .font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.warn)
            } else {
                Label("That goes on the form, and is kept for next time.", systemImage: "checkmark.circle.fill")
                    .font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.good)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 16)
    }

    static func looksLikeYouTube(_ text: String) -> Bool {
        guard let host = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines))?.host?.lowercased() else { return false }
        return host == "youtu.be" || host == "youtube.com" || host.hasSuffix(".youtube.com")
    }

    /// The link gets a place of its own, because the form can't be sent until the video is online.
    private func linkCard(_ question: FormQuestion) -> some View {
        let typed = link.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let video = target.run.landscapes?.last
        return VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 8) {
                Text("YOUR VIDEO'S LINK").label()
                Spacer()
                ComingSoonBadge().help("Uploading the video to YouTube from here, with the link filled in for you.")
            }
            HStack(spacing: 8) {
                TextField("Paste the YouTube link to your 16:9 video", text: link)
                    .textFieldStyle(.plain).font(.system(size: 14))
                    .padding(.horizontal, 12).padding(.vertical, 9)
                    .background(Theme.raised, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                Button("Paste") {
                    if let copied = NSPasteboard.general.string(forType: .string) { link.wrappedValue = copied.trimmingCharacters(in: .whitespacesAndNewlines) }
                }
                .buttonStyle(SecondaryButton()).help("Paste the link you copied from YouTube.")
            }
            .help(question.title)
            HStack(spacing: 8) {
                if typed.isEmpty {
                    Text("The form needs it, so the video has to be on YouTube first.").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.warn)
                } else if Self.looksLikeYouTube(typed) {
                    Label("That is a YouTube link.", systemImage: "checkmark.circle.fill").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.good)
                } else {
                    Label("That doesn't look like a YouTube link.", systemImage: "exclamationmark.triangle.fill")
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.warn)
                }
                Spacer(minLength: 8)
                Button("YouTube's upload page") {
                    if let page = URL(string: "https://www.youtube.com/upload") { NSWorkspace.shared.open(page) }
                }
                .buttonStyle(SecondaryButton())
                if let video {
                    Button("Show the video") { model.reveal([video]) }.buttonStyle(SecondaryButton()).help("Show this run's 16:9 video in Finder, to upload it.")
                }
            }
            if video == nil {
                Text("There is no 16:9 video of this run yet. Make it on the track page.").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.warn)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 16)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("SUBMIT \(Model.trackName(target.track).uppercased())").label()
                    Text(sent ? "Sent" : showingForm ? "Check it and press Submit" : "Check your answers").font(.system(size: 24, weight: .black))
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 0) {
                    Text(time).font(.system(size: 30, weight: .black).monospacedDigit()).foregroundStyle(Theme.accent)
                    Text(target.run.name).font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.dim)
                }
            }
            .padding(24)
            Divider().overlay(Theme.stroke)

            if let form {
                if sent {
                    VStack(spacing: 14) {
                        Image(systemName: "checkmark.seal.fill").font(.system(size: 60)).foregroundStyle(Theme.good)
                        Text("Google has your \(time) for \(Model.trackName(target.track)).").font(.system(size: 17, weight: .heavy))
                        Text("It's logged on the track page too.").font(.system(size: 13)).foregroundStyle(Theme.dim)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if showingForm, let url = URL(string: model.state(target.track).formURL) {
                    FormWebView(url: url, script: fillScript(answers: answers, email: email)) {
                        model.recordSubmission(track: target.track, run: target.run.name, time: time,
                                               link: form.questions.first { $0.role == .link }.flatMap { answers[$0.id]?.first } ?? "")
                        sent = true
                    }
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 12) {
                            if let question = linkQuestion { linkCard(question) }
                            if askingEmail { emailCard }
                            yours(form)
                            filledIn(form)
                        }
                        .padding(20)
                    }
                }
            } else {
                VStack(spacing: 10) {
                    Text("No form yet").font(.system(size: 18, weight: .heavy))
                    Text("Paste this track's Google Form link into the Submission form box on the track page first.")
                        .font(.system(size: 13)).foregroundStyle(Theme.dim)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }

            Divider().overlay(Theme.stroke)
            HStack {
                if sent {
                    Spacer()
                    Button("Done") { dismiss() }.buttonStyle(PrimaryButton())
                } else if showingForm {
                    Button("Back to answers") { showingForm = false }.buttonStyle(SecondaryButton())
                    Spacer()
                    Text("Nothing is sent until you press Submit at the bottom of the form.").font(.system(size: 12)).foregroundStyle(Theme.dim)
                    Button("Close") { dismiss() }.buttonStyle(SecondaryButton())
                } else {
                    Button("Cancel") { dismiss() }.buttonStyle(SecondaryButton())
                    Spacer()
                    if form != nil, let waiting = inTheWay {
                        Text(waiting).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.warn)
                    }
                    Button("Fill in the form") {
                        remember()
                        showingForm = true
                    }
                    .buttonStyle(PrimaryButton())
                    .disabled(form == nil || inTheWay != nil)
                }
            }
            .padding(18)
        }
        // The check is a small window. The form itself needs room.
        .frame(width: showingForm && !sent ? 780 : 680, height: showingForm && !sent ? 760 : 700)
        .background(Theme.background)
        .preferredColorScheme(.dark)
        .onAppear(perform: prepare)
        // The form can arrive after the window opens.
        .onChange(of: form) { _, _ in prepare() }
    }

    /// What still has to be given before the form can be filled in, in a line. Nil when nothing does.
    private var inTheWay: String? {
        var waiting: [String] = []
        if !missing.isEmpty { waiting.append("\(missing.count) required answer\(missing.count == 1 ? "" : "s") still empty") }
        let typed = email.trimmingCharacters(in: .whitespaces)
        if typed.isEmpty {
            waiting.append("your email is still empty")
        } else if !Self.looksLikeEmail(typed) {
            waiting.append("your email isn't a whole address yet")
        }
        guard let first = waiting.first else { return nil }
        return ([first.prefix(1).uppercased() + first.dropFirst()] + waiting.dropFirst()).joined(separator: ", and ")
    }

    /// What the app answers by itself, in a line. It opens up when one of them needs changing or is missing.
    private func filledIn(_ form: FormDefinition) -> some View {
        let known = form.questions.filter { $0.role == .handle || $0.role == .number || $0.role == .time }
        func name(_ question: FormQuestion) -> String {
            question.role == .handle ? "Pilot handle" : question.role == .number ? "Registration number" : "Fastest three laps in a row"
        }
        let empty = known.contains { $0.required && (answers[$0.id]?.first ?? "").trimmingCharacters(in: .whitespaces).isEmpty }
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("FILLED IN FOR YOU").label()
                Spacer()
                if !empty, !knownOpened {
                    Button(changingKnown ? "Done" : "Change") { changingKnown.toggle() }.buttonStyle(.plain)
                        .font(.system(size: 11, weight: .heavy)).foregroundStyle(Theme.accent)
                }
            }
            if changingKnown || knownOpened || empty {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], alignment: .leading, spacing: 10) {
                    ForEach(known) { question in
                        AnswerField(title: name(question), required: question.required, text: Binding(get: { answers[question.id]?.first ?? "" }, set: { answers[question.id] = [$0] }))
                            .help(question.title)
                    }
                    // Asked for in its own place above when there was none to begin with.
                    if !askingEmail { AnswerField(title: "Your email", required: true, text: $email) }
                }
                if empty {
                    Text("Something here is empty. Your name and ID come from Pilot & settings.")
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.warn).fixedSize(horizontal: false, vertical: true)
                }
            } else {
                // Each on its own line: what it is, and what goes in.
                VStack(alignment: .leading, spacing: 5) {
                    ForEach(known) { question in
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Text(name(question)).font(.system(size: 12)).foregroundStyle(Theme.dim).frame(width: 190, alignment: .leading)
                            Text(answers[question.id]?.first ?? "").font(.system(size: 13, weight: .bold).monospacedDigit())
                        }
                    }
                    if !askingEmail {
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Text("Your email").font(.system(size: 12)).foregroundStyle(Theme.dim).frame(width: 190, alignment: .leading)
                            Text(email).font(.system(size: 13, weight: .bold))
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 16)
    }

    /// An answer in a few words, for a question that isn't opened up.
    private func summary(_ question: FormQuestion) -> String? {
        let given = (answers[question.id] ?? []).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        return given.isEmpty ? nil : given.joined(separator: ", ")
    }

    /// The questions only the pilot can answer, in the order they are gone through: the ones with
    /// no answer kept from an earlier entry first.
    private func mine(_ form: FormDefinition) -> [FormQuestion] {
        let all = form.questions.filter { $0.role == nil }
        return all.filter { fresh.contains($0.id) } + all.filter { !fresh.contains($0.id) }
    }

    /// The next question after one that still has no answer and needs one.
    private func nextUnanswered(after question: FormQuestion, in form: FormDefinition) -> String? {
        let list = mine(form)
        guard let place = list.firstIndex(of: question) else { return nil }
        return (list[(place + 1)...] + list[..<place]).first { $0.kind != .other && $0.required && summary($0) == nil }?.id
    }

    /// The questions the app can't answer: one line each, with the answer that will go in. A
    /// question with no answer says so. One at a time opens up to be answered or changed, and
    /// choosing an answer moves on to the next one that needs it.
    private func yours(_ form: FormDefinition) -> some View {
        let list = mine(form)
        let waiting = list.filter { $0.kind != .other && $0.required && summary($0) == nil }.count
        let kept = list.filter { !fresh.contains($0.id) }.count
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text("YOURS TO CHECK").label()
                Spacer()
                Text(waiting == 0 ? "All answered" : "\(waiting) need\(waiting == 1 ? "s" : "") an answer")
                    .font(.system(size: 11, weight: .heavy)).foregroundStyle(waiting == 0 ? Theme.good : Theme.warn)
            }
            Text(kept == 0 ? "The app can't know these. Answer them once and they are kept for your next entry."
                 : "The app can't know these, so it uses what you answered last time. Look them over before they go in: some change from track to track.")
                .font(.system(size: 12)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true).padding(.bottom, 2)
            ForEach(list) { question in
                let opened = open == question.id
                let answer = summary(question)
                VStack(alignment: .leading, spacing: 9) {
                    Button {
                        open = opened ? nil : question.id
                    } label: {
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: answer == nil ? (question.required ? "circle.dashed" : "circle") : "checkmark.circle.fill")
                                .font(.system(size: 13)).foregroundStyle(answer == nil ? (question.required ? Theme.warn : Theme.faint) : Theme.good).padding(.top, 1)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(question.title).font(.system(size: 12)).foregroundStyle(opened ? .white : Theme.dim)
                                    .lineLimit(opened ? nil : 2).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                                if !opened {
                                    Text(answer ?? (question.kind == .other ? "Answered on the form itself" : question.required ? "Needs your answer" : "Left empty"))
                                        .font(.system(size: 13, weight: .bold)).lineLimit(2).multilineTextAlignment(.leading)
                                        .foregroundStyle(answer != nil ? .white : question.required && question.kind != .other ? Theme.warn : Theme.faint)
                                }
                            }
                            Spacer(minLength: 10)
                            Text(opened ? "Done" : answer == nil ? "Answer" : "Change").font(.system(size: 11, weight: .heavy)).foregroundStyle(Theme.accent)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain).help(question.title)
                    if opened {
                        QuestionRow(question: question, bare: true, values: Binding(get: { answers[question.id] ?? [] }, set: { chosen in
                            answers[question.id] = chosen
                            // One answer is all a choice takes: on to the next that needs one.
                            if question.kind == .choice, !chosen.isEmpty { open = nextUnanswered(after: question, in: form) }
                        }))
                        .padding(.leading, 23)
                    }
                }
                .padding(.horizontal, 12).padding(.vertical, 9)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(opened ? Theme.accent.opacity(0.07) : Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(opened ? Theme.accent.opacity(0.3) : Color.clear))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 16)
    }

    /// Starts from what's known: the pilot, the time, and whatever was answered last time.
    private func prepare() {
        email = email.isEmpty ? model.store.email : email
        if email.trimmingCharacters(in: .whitespaces).isEmpty { askingEmail = true }
        guard let form else { return }
        var unknown: Set<String> = []
        for question in form.questions where answers[question.id] == nil {
            switch question.role {
            case .handle: answers[question.id] = [model.settings.pilot]
            case .number: answers[question.id] = [model.details(ofEvent: Model.eventFolder(of: target.track)).id]
            case .time: answers[question.id] = [time]
            case .link: answers[question.id] = [model.state(target.track).links[target.run.name] ?? ""]
            case nil:
                var kept = model.store.answers[question.title] ?? []
                // An answer from an earlier form only counts if this form still offers it.
                if question.kind == .choice || question.kind == .checkboxes { kept = kept.filter(question.options.contains) }
                answers[question.id] = kept
                if kept.allSatisfy({ $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) { unknown.insert(question.id) }
            }
        }
        fresh.formUnion(unknown)
        if open == nil { open = mine(form).first { $0.kind != .other && $0.required && summary($0) == nil }?.id }
        // The pilot's name, number or time missing: open those up, and leave them open while they are typed.
        let filled: [FormQuestion.Role] = [.handle, .number, .time]
        if form.questions.contains(where: { question in
            guard let role = question.role, filled.contains(role), question.required else { return false }
            return (answers[question.id]?.first ?? "").trimmingCharacters(in: .whitespaces).isEmpty
        }) { knownOpened = true }
    }

    private func remember() {
        guard let form else { return }
        model.store.email = email.trimmingCharacters(in: .whitespaces)
        for question in form.questions {
            let values = answers[question.id] ?? []
            switch question.role {
            case .link: model.update(target.track) { $0.links[target.run.name] = values.first ?? "" }
            case nil: model.store.answers[question.title] = values
            default: break
            }
        }
    }
}

struct AnswerField: View {
    let title: String
    let required: Bool
    @Binding var text: String
    var tall = false

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            QuestionTitle(title: title, required: required)
            TextField("", text: $text, axis: tall ? .vertical : .horizontal)
                .lineLimit(tall ? 3...6 : 1...1)
                .textFieldStyle(.plain).font(.system(size: 14))
                .padding(.horizontal, 12).padding(.vertical, 9)
                .background(Theme.raised, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        }
    }
}

struct QuestionTitle: View {
    let title: String
    let required: Bool

    var body: some View {
        (Text(title).foregroundColor(.white) + Text(required ? "  required" : "").foregroundColor(Theme.warn))
            .font(.system(size: 13, weight: .semibold)).fixedSize(horizontal: false, vertical: true)
    }
}

struct QuestionRow: View {
    let question: FormQuestion
    /// True when the question's words are already shown above: only the answering is drawn.
    var bare = false
    @Binding var values: [String]

    var body: some View {
        switch question.kind {
        case .text, .paragraph:
            if bare {
                TextField("Your answer", text: Binding(get: { values.first ?? "" }, set: { values = [$0] }), axis: question.kind == .paragraph ? .vertical : .horizontal)
                    .lineLimit(question.kind == .paragraph ? 2...6 : 1...1)
                    .textFieldStyle(.plain).font(.system(size: 14))
                    .padding(.horizontal, 12).padding(.vertical, 9)
                    .background(Theme.raised, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            } else {
                AnswerField(title: question.title, required: question.required,
                            text: Binding(get: { values.first ?? "" }, set: { values = [$0] }), tall: question.kind == .paragraph)
            }
        case .choice, .checkboxes:
            VStack(alignment: .leading, spacing: 7) {
                if !bare { QuestionTitle(title: question.title, required: question.required) }
                ForEach(question.options, id: \.self) { option in
                    let chosen = values.contains(option)
                    Button {
                        if question.kind == .choice {
                            values = chosen ? [] : [option]
                        } else if chosen {
                            values.removeAll { $0 == option }
                        } else {
                            values.append(option)
                        }
                    } label: {
                        HStack(alignment: .top, spacing: 9) {
                            Image(systemName: question.kind == .choice ? (chosen ? "largecircle.fill.circle" : "circle") : (chosen ? "checkmark.square.fill" : "square"))
                                .foregroundStyle(chosen ? Theme.accent : Theme.faint)
                            Text(option).font(.system(size: 13)).foregroundStyle(chosen ? .white : Theme.dim)
                                .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        case .other:
            VStack(alignment: .leading, spacing: 4) {
                if !bare { QuestionTitle(title: question.title, required: question.required) }
                Text("Answer this one in the form itself on the next step.").font(.system(size: 12)).foregroundStyle(Theme.dim)
            }
        }
    }
}

/// The real Google Form. It is filled in when it loads; sending it is left to the Submit button on the page.
struct FormWebView: NSViewRepresentable {
    let url: URL
    let script: String
    let submitted: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(script: script, submitted: submitted) }

    func makeNSView(context: Context) -> WKWebView {
        let view = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        view.navigationDelegate = context.coordinator
        view.load(URLRequest(url: url))
        return view
    }

    func updateNSView(_ view: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        let script: String
        let submitted: () -> Void
        private var reported = false

        init(script: String, submitted: @escaping () -> Void) {
            self.script = script
            self.submitted = submitted
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard let path = webView.url?.path else { return }
            if path.hasSuffix("/formResponse") {
                // Google only moves to this page once it has accepted the answers.
                if !reported {
                    reported = true
                    submitted()
                }
            } else if path.hasSuffix("/viewform") {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [script] in
                    webView.evaluateJavaScript(script, completionHandler: nil)
                }
            }
        }
    }
}

// MARK: - Marking laps and placing music

/// A clip opened in the marker editor.
struct EditTarget: Equatable {
    let track: String
    /// The run's name: the clip's file name without its extension.
    let name: String
    let clip: String
    /// The gate crossings already marked for it, in seconds from the start of the clip.
    var crossings: [Double] = []
}

/// What the lap timer reports about a clip's playable copy.
struct PreviewInfo: Codable {
    let file: String
    let fps: String
    let num: Int
    let den: Int
}

/// A moment in a song where it suddenly gets bigger, such as a drop: something to put on a gate.
struct SongSpot: Codable, Equatable {
    /// Seconds into the song.
    let time: Double
    /// How much it stands out, from 0 to 1. The biggest in the song is 1.
    let strength: Double
}

/// What the lap timer hears in a song.
struct SongAnalysis: Codable, Equatable {
    var length = 0.0
    /// Beats a minute, when the song has a pulse.
    var tempo: Double?
    /// Where the beat falls, when it keeps steady time all the way through: the first beat, and the
    /// gap from each one to the next, in seconds.
    var firstBeat: Double?
    var beatLength: Double?
    var spots: [SongSpot] = []

    /// The beat nearest a time in the song, when the song keeps steady time.
    func beat(nearest time: Double) -> Double? {
        guard let firstBeat, let beatLength, beatLength > 0 else { return nil }
        return firstBeat + max(0, ((time - firstBeat) / beatLength).rounded()) * beatLength
    }

    /// The tempo the way it is said: "174 BPM", or "127.3 BPM" for one that isn't a round number.
    var tempoLabel: String? {
        guard let tempo else { return nil }
        let rounded = (tempo * 10).rounded() / 10
        return rounded == rounded.rounded() ? "\(Int(rounded)) BPM" : String(format: "%.1f BPM", rounded)
    }
}

/// A song's sound wave, for drawing. A song mastered loud is one solid block from top to bottom as a
/// plain wave, so this keeps three things for each short stretch: the highest the sound gets, how
/// loud it is, and how loud its bass is. A drop shows in the last two. It is kept twice, finely for
/// looking closely and coarsely for the whole song at once.
struct SongWave {
    static let fine = 1000.0, coarse = 50.0

    struct Readings {
        /// The highest the sound gets in each stretch, from 0 to 1.
        var peak: [Float] = []
        /// The power of the whole sound in each stretch, and of its bass alone.
        var power: [Float] = []
        var bassPower: [Float] = []
    }
    var close = Readings(), far = Readings()
    /// What loudness is multiplied by for drawing, so the song's loud passages come out nearly full height.
    var gain: Float = 1

    var isEmpty: Bool { close.peak.isEmpty }
    /// How much of the song has been read, in seconds.
    var length: Double { Double(close.peak.count) / Self.fine }

    /// Between two times in the song: the highest the sound gets, how loud it is and how loud its
    /// bass is, each from 0 to 1 and each no more than the one before.
    func levels(from start: Double, to end: Double) -> (peak: Float, body: Float, bass: Float)? {
        // A stretch of more than a few hundredths of a second is read from the coarse copy.
        let broad = (end - start) * Self.fine >= 60
        let rate = broad ? Self.coarse : Self.fine
        let readings = broad ? far : close
        let first = max(0, Int(start * rate)), last = min(readings.peak.count, max(Int(start * rate) + 1, Int((end * rate).rounded(.up))))
        guard first < last else { return nil }
        var peak: Float = 0, power: Float = 0, bassPower: Float = 0
        for index in first..<last {
            peak = max(peak, readings.peak[index])
            power += readings.power[index]
            bassPower += readings.bassPower[index]
        }
        let body = min(peak, (power / Float(last - first)).squareRoot() * gain)
        return (peak, body, min(body, (bassPower / Float(last - first)).squareRoot() * gain))
    }
}

enum EditorFormat {
    /// The first line of a marker file saved here. The lap timer takes "clip time" in it to mean the
    /// markers never went through a Premiere sequence.
    static let tag = "# FPV Hangar markers, in clip time"

    /// Whether a marker file was saved here rather than exported from Premiere, whatever the app was called at the time.
    static func wrote(_ text: String) -> Bool {
        let first = text.prefix { !$0.isNewline }
        return first.hasPrefix("#") && first.lowercased().contains("clip time")
    }
    /// The lap timer's own lead-in and hold: how long before lap 1 and after the finish a finished
    /// video runs when the stretch is left to it.
    static let leadIn = 3.0
    static let hold = 8.0

    /// A clip time such as `1:17.417`.
    static func clock(_ seconds: Double) -> String {
        let milliseconds = Int((max(0, seconds) * 1000).rounded())
        return String(format: "%d:%02d.%03d", milliseconds / 60000, milliseconds / 1000 % 60, milliseconds % 1000)
    }

    /// A lap time such as `9.300`, in plain seconds the way the form wants it.
    static func lap(_ milliseconds: Int) -> String {
        String(format: "%d.%03d", milliseconds / 1000, milliseconds % 1000)
    }

    static func span(_ seconds: Double) -> String { String(format: "%.1f s", abs(seconds)) }

    /// A time into a song such as `0:44.16`.
    static func songClock(_ seconds: Double) -> String {
        let hundredths = Int((max(0, seconds) * 100).rounded())
        return String(format: "%d:%02d.%02d", hundredths / 6000, hundredths / 100 % 60, hundredths % 100)
    }
}

/// One clip being marked: the player, the markers, and how its finished videos are cut and scored.
@MainActor
final class Editor: ObservableObject {
    enum Phase: Equatable { case loading, failed(String), ready }

    let target: EditTarget
    /// How many laps in a row are judged.
    let window: Int
    let player = AVPlayer()
    private let tool: URL
    /// The track's own music folder: where Premiere's exports are, and songs from before the song library.
    private let musicFolder: URL
    /// The library's Songs folder, where songs are kept for every track.
    private let songLibrary: URL
    /// The pilot's marks in each song, as they were when the editor opened and as they are changed
    /// here. The chosen song's are worked on in `edit.songMarks`.
    private var marksBySong: [String: [Double]]
    /// Lower-case names of the track's clips. A sound file named after one is a Premiere export, not a song.
    private let clipNames: Set<String>

    @Published var phase = Phase.loading
    /// The playhead, as a frame of the clip.
    @Published var frame = 0
    @Published var playing = false
    @Published var speed: Float = 1 { didSet { if playing { player.rate = speed } } }
    /// Gate crossings as frames of the clip, in order. The first starts lap 1.
    @Published var markers: [Int] = []
    @Published var edit: RunEdit
    /// The songs to choose from: the library's, and any that are only in the track's music folder.
    @Published var songs: [String] = []
    /// The sound exported from the run's Premiere sequence, if the music folder has one.
    @Published var premiereMusic: String?
    @Published var songLength = 0.0
    /// The chosen song's sound wave, for the timeline and the sound wave window.
    @Published var wave = SongWave()
    /// What the lap timer hears in the chosen song: its tempo, its beat and its drops. Nil until it has listened.
    @Published var analysis: SongAnalysis?
    /// True while the lap timer is listening to the chosen song.
    @Published var listening = false
    /// The sound wave window, while it is open.
    @Published var soundWave: SoundWave?
    /// Whether the playhead and the marks in the sound wave window catch on the beat.
    @Published var snapToBeat = UserDefaults.standard.object(forKey: "snapToBeat") as? Bool ?? true {
        didSet { UserDefaults.standard.set(snapToBeat, forKey: "snapToBeat") }
    }
    /// Whether the lap timer is drawn over the picture, as the 16:9 video will have it.
    @Published var showsTimer = UserDefaults.standard.object(forKey: "showsTimer") as? Bool ?? true {
        didSet { UserDefaults.standard.set(showsTimer, forKey: "showsTimer") }
    }
    /// The stretch of the clip the timeline is showing, in seconds.
    @Published var visible = 0.0...1.0
    @Published var message: String?
    @Published var saved = false

    private(set) var fpsLabel = "60"
    private(set) var num = 60
    private(set) var den = 1
    private(set) var frameCount = 1
    private var video: AVURLAsset?
    private var song: AVURLAsset?
    private var savedMarkers: [Int] = []
    private var savedEdit: RunEdit
    private var history: [(markers: [Int], edit: RunEdit)] = []
    private var seeking = false
    private var wanted: Int?
    private var generation = 0
    private var observer: Any?

    init(target: EditTarget, edit: RunEdit, window: Int, tool: URL, musicFolder: URL, songLibrary: URL, songMarks: [String: [Double]], clipNames: Set<String>) {
        self.target = target
        self.window = max(1, window)
        self.tool = tool
        self.musicFolder = musicFolder
        self.songLibrary = songLibrary
        marksBySong = songMarks
        self.clipNames = clipNames
        // The song's own marks are the ones that count: they may have been changed in another run since this one was saved.
        var opened = edit
        if let song = edit.song, !song.isEmpty, let kept = songMarks[song] { opened.songMarks = kept.isEmpty ? nil : kept }
        self.edit = opened
        savedEdit = opened
        Task { await load() }
    }

    /// Where a song is: in the library, or failing that in the track's own music folder.
    private func songFile(_ name: String) -> URL {
        let shared = songLibrary.appendingPathComponent(name)
        return FileManager.default.fileExists(atPath: shared.path) ? shared : musicFolder.appendingPathComponent(name)
    }

    /// The marks to keep with each song when this is saved: the chosen song's as they are now, and
    /// those of any song marked earlier in this sitting.
    var marksToKeep: [String: [Double]] {
        var all = touched
        if let song = edit.song, !song.isEmpty, songMarks != (marksBySong[song] ?? []) || touched[song] != nil { all[song] = songMarks }
        return all
    }
    /// Songs whose marks were changed here and then left for another song.
    private var touched: [String: [Double]] = [:]

    func revealSongs() {
        try? FileManager.default.createDirectory(at: songLibrary, withIntermediateDirectories: true)
        NSWorkspace.shared.open(songLibrary)
    }

    var fps: Double { Double(num) / Double(den) }
    var duration: Double { Double(frameCount) / fps }
    func seconds(_ frame: Int) -> Double { Double(frame) / fps }
    func frameIndex(at seconds: Double) -> Int { min(max(Int(seconds * fps + 0.001), 0), frameCount - 1) }

    var markersChanged: Bool { markers != savedMarkers }
    var dirty: Bool { markersChanged || edit != savedEdit }
    /// True once a seek has landed and nothing is waiting behind it.
    var settled: Bool { !seeking && wanted == nil }

    /// Marker times in milliseconds, worked out the way the lap timer reads them back from the file.
    var bounds: [Int] { markers.map { Int((Double($0) * Double(den) / Double(num) * 1000).rounded()) } }
    var laps: [Int] {
        let bounds = bounds
        return zip(bounds, bounds.dropFirst()).map { $1 - $0 }
    }
    /// The fastest `window` laps in a row: the first of them, counting from 0, and their total.
    var best: (first: Int, total: Int)? {
        let bounds = bounds
        guard bounds.count > window else { return nil }
        var result: (first: Int, total: Int)?
        for first in 0..<(bounds.count - window) {
            let total = bounds[first + window] - bounds[first]
            if result == nil || total < result!.total { result = (first, total) }
        }
        return result
    }

    /// Where a finished video starts and ends when it is left to the lap timer.
    var automaticStretch: ClosedRange<Double>? {
        guard markers.count >= 2, let first = markers.first, let last = markers.last else { return nil }
        return max(0, seconds(first) - EditorFormat.leadIn)...(seconds(last) + EditorFormat.hold)
    }
    /// The stretch of the clip the finished videos will cover.
    var stretch: ClosedRange<Double>? {
        let automatic = automaticStretch
        guard let start = edit.videoStart ?? automatic?.lowerBound, let end = edit.videoEnd ?? automatic?.upperBound else { return nil }
        let upper = min(end, duration)
        return upper > start ? start...upper : nil
    }
    /// Where the chosen song lies against the clip.
    var songSpan: ClosedRange<Double>? {
        guard song != nil, songLength > 0, let start = edit.songStart else { return nil }
        return start...(start + songLength)
    }

    /// The part of the clip the music is heard over: where the song lies, cut to the finished video and
    /// to the start and end set for the music, if any.
    var musicHeard: ClosedRange<Double>? {
        guard let span = songSpan else { return nil }
        var lower = max(span.lowerBound, 0), upper = min(span.upperBound, duration)
        if let stretch {
            lower = max(lower, stretch.lowerBound)
            upper = min(upper, stretch.upperBound)
        }
        if let comesIn = edit.musicIn { lower = max(lower, comesIn) }
        if let stops = edit.musicOut { upper = min(upper, stops) }
        return upper > lower ? lower...upper : nil
    }

    /// The marks in the song, as times into it.
    var songMarks: [Double] { edit.songMarks ?? [] }

    /// The moments the lap timer heard the song get suddenly bigger, such as its drops.
    var spots: [SongSpot] { analysis?.spots ?? [] }

    /// The time into the song that plays at a clip time, as the song lies now.
    func songTime(at clipTime: Double) -> Double? {
        guard let span = songSpan else { return nil }
        return clipTime - span.lowerBound
    }

    /// The gate a moment in the song falls on as the song lies now, counting the start gate as 0.
    func gate(under songTime: Double) -> Int? {
        guard let span = songSpan else { return nil }
        return markers.firstIndex { abs(seconds($0) - (span.lowerBound + songTime)) < 0.5 / fps }
    }

    /// What a finished video would be missing with a moment in the song put on the start gate: nil
    /// when the song would still cover all of it.
    func shortfall(withStartGateAt songTime: Double) -> String? {
        guard let first = markers.first, let stretch else { return nil }
        let start = seconds(first) - songTime
        if start > stretch.lowerBound + 0.05 {
            return "The song would only come in \(EditorFormat.span(start - stretch.lowerBound)) after the video starts."
        }
        if start + songLength < stretch.upperBound - 0.05 {
            return "The song would run out \(EditorFormat.span(stretch.upperBound - start - songLength)) before the video ends."
        }
        return nil
    }

    // MARK: Opening the clip

    private func load() async {
        let tool = tool, clip = target.clip
        let prepared = await Task.detached { Editor.playableCopy(of: clip, tool: tool) }.value
        guard let info = prepared.info else {
            phase = .failed(prepared.problem)
            return
        }
        let asset = AVURLAsset(url: URL(fileURLWithPath: info.file))
        guard let track = try? await asset.loadTracks(withMediaType: .video).first,
              let range = try? await track.load(.timeRange), range.end.seconds > 0 else {
            phase = .failed("\(URL(fileURLWithPath: clip).lastPathComponent) can't be played.")
            return
        }
        video = asset
        fpsLabel = info.fps
        num = max(1, info.num)
        den = max(1, info.den)
        frameCount = max(1, Int((range.end.seconds * fps).rounded()))
        markers = Array(Set(target.crossings.map { min(max(Int(($0 * fps).rounded()), 0), frameCount - 1) })).sorted()
        savedMarkers = markers
        visible = 0...duration
        frame = markers.first.map { max(0, $0 - Int(2 * fps)) } ?? 0
        findSongs()
        await loadSong()
        await rebuild()
        showRun()
        observer = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 30), queue: .main) { [weak self] time in
            MainActor.assumeIsolated { self?.tick(time.seconds) }
        }
        phase = .ready
    }

    /// A copy of the clip that macOS can play, made by the lap timer and kept in the Caches folder.
    /// A clip macOS already plays is used as it is.
    /// Where a clip's playable copy is kept. The name carries the clip's size and date, so a clip that
    /// has changed gets a new copy.
    nonisolated static func copyLocation(of clip: String) -> (folder: URL, movie: URL, note: URL, size: Int64) {
        let folder = Model.caches.appendingPathComponent("Clip previews", isDirectory: true)
        let attributes = try? FileManager.default.attributesOfItem(atPath: clip)
        let size = (attributes?[.size] as? Int64) ?? 0
        let changed = Int((attributes?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0)
        let base = "\(URL(fileURLWithPath: clip).deletingPathExtension().lastPathComponent)-\(size)-\(changed)"
        return (folder, folder.appendingPathComponent(base + ".mov"), folder.appendingPathComponent(base + ".json"), size)
    }

    nonisolated static func playableCopy(of clip: String, tool: URL) -> (info: PreviewInfo?, problem: String) {
        let manager = FileManager.default
        let (folder, movie, note, size) = copyLocation(of: clip)
        if manager.fileExists(atPath: movie.path), let data = try? Data(contentsOf: note), let info = try? JSONDecoder().decode(PreviewInfo.self, from: data) {
            try? manager.setAttributes([.modificationDate: Date()], ofItemAtPath: movie.path)
            return (info, "")
        }
        // The copy is as big as the clip.
        try? manager.createDirectory(at: folder, withIntermediateDirectories: true)
        if let free = try? folder.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]).volumeAvailableCapacityForImportantUsage,
           free < size + size / 5 {
            let needed = ByteCountFormatter.string(fromByteCount: size, countStyle: .file)
            return (nil, "There isn't enough free disk space to open this clip. It needs about \(needed).")
        }
        let result = runTool(tool, ["--preview", clip, "-o", movie.path])
        guard result.status == 0, let info = try? JSONDecoder().decode(PreviewInfo.self, from: Data(result.output.utf8)) else {
            let reason = result.error.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "Error: ", with: "")
            return (nil, reason.isEmpty ? "\(URL(fileURLWithPath: clip).lastPathComponent) couldn't be opened." : reason)
        }
        if info.file == movie.path {
            try? Data(result.output.utf8).write(to: note)
            // Keep the three used most recently.
            func used(_ url: URL) -> Date { (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast }
            let copies = ((try? manager.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.contentModificationDateKey])) ?? [])
                .filter { $0.pathExtension == "mov" }.sorted { used($0) > used($1) }
            for old in copies.dropFirst(3) {
                try? manager.removeItem(at: old)
                try? manager.removeItem(at: old.deletingPathExtension().appendingPathExtension("json"))
            }
        }
        return (info, "")
    }

    /// Puts the picture and the chosen song, where it has been placed, into the player.
    private func rebuild() async {
        generation += 1
        let mine = generation
        guard let video, let source = try? await video.loadTracks(withMediaType: .video).first,
              let range = try? await source.load(.timeRange) else { return }
        let composition = AVMutableComposition()
        guard let picture = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else { return }
        try? picture.insertTimeRange(range, of: source, at: range.start)
        if let song, let start = edit.songStart, let sound = try? await song.loadTracks(withMediaType: .audio).first {
            func clock(_ seconds: Double) -> CMTime { CMTime(seconds: seconds, preferredTimescale: 48000) }
            // A song that starts before the clip does is already that far in when the clip begins, and
            // one told to come in late or stop early is only heard in between.
            let from = max(0, start, edit.musicIn ?? -.infinity)
            let until = min(start + songLength, range.end.seconds, edit.musicOut ?? .infinity)
            if until - from > 0.05, let music = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
                try? music.insertTimeRange(CMTimeRange(start: clock(from - start), duration: clock(until - from)), of: sound, at: clock(from))
            }
        }
        guard mine == generation else { return }
        player.replaceCurrentItem(with: AVPlayerItem(asset: composition))
        seeking = false
        wanted = nil
        show(frame, follow: false)
    }

    func stop() {
        closeSoundWave()
        player.pause()
        if let observer { player.removeTimeObserver(observer) }
        observer = nil
        player.replaceCurrentItem(with: nil)
    }

    // MARK: Moving around

    /// Moves the playhead to a frame and shows exactly that frame.
    func show(_ index: Int, follow: Bool = true) {
        let index = min(max(index, 0), frameCount - 1)
        frame = index
        if follow { keepInView(paging: false) }
        // Holding an arrow key asks faster than the player can seek: remember the latest and go there next.
        guard !seeking else {
            wanted = index
            return
        }
        seeking = true
        // Aim at the middle of the frame, so a timestamp a hair off the grid can't land on its neighbour.
        let time = CMTime(seconds: (Double(index) + 0.5) / fps, preferredTimescale: 90000)
        player.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.seeking = false
                if let next = self.wanted {
                    self.wanted = nil
                    if next != index { self.show(next, follow: false) }
                }
            }
        }
    }

    func step(_ frames: Int) {
        guard phase == .ready else { return }
        pause()
        show(frame + frames)
    }

    /// To the marker before or after the playhead.
    func jump(_ direction: Int) {
        guard phase == .ready else { return }
        pause()
        if let next = direction < 0 ? markers.last(where: { $0 < frame }) : markers.first(where: { $0 > frame }) { show(next) }
    }

    func togglePlay() {
        guard phase == .ready else { return }
        if playing {
            pause()
            return
        }
        if frame >= frameCount - 1 { show(0) }
        playing = true
        player.rate = speed
    }

    func pause() {
        guard playing else { return }
        playing = false
        player.pause()
        // Park on the frame that is showing.
        show(frameIndex(at: player.currentTime().seconds))
    }

    private func tick(_ seconds: Double) {
        guard playing else { return }
        if player.timeControlStatus == .paused {
            // It ran off the end of the clip.
            playing = false
            show(frameIndex(at: seconds))
            return
        }
        let now = frameIndex(at: seconds)
        if now != frame {
            frame = now
            keepInView(paging: true)
        }
    }

    private func keepInView(paging: Bool) {
        let now = seconds(frame), span = visible.upperBound - visible.lowerBound
        guard now < visible.lowerBound || now > visible.upperBound else { return }
        let lower = min(max(0, paging ? now - span * 0.05 : now - span / 2), max(0, duration - span))
        visible = lower...(lower + span)
    }

    func zoom(by factor: Double) {
        let span = min(duration, max(0.5, (visible.upperBound - visible.lowerBound) * factor))
        let lower = min(max(0, seconds(frame) - span / 2), max(0, duration - span))
        visible = lower...(lower + span)
    }

    func showAll() { visible = 0...duration }

    /// Fits the timeline to the stretch the finished videos cover.
    func showRun() {
        guard let stretch else { return }
        let margin = (stretch.upperBound - stretch.lowerBound) * 0.06
        let lower = max(0, stretch.lowerBound - margin)
        visible = lower...max(min(duration, stretch.upperBound + margin), lower + 0.5)
    }

    // MARK: Changing things

    /// Notes how things stand, for Undo, before something changes.
    func remember() {
        history.append((markers, edit))
        if history.count > 200 { history.removeFirst() }
        message = nil
        saved = false
    }

    func undo() {
        guard let last = history.popLast() else { return }
        let songChanged = last.edit.song != edit.song
        let songMoved = last.edit.songStart != edit.songStart || last.edit.musicIn != edit.musicIn || last.edit.musicOut != edit.musicOut
        markers = last.markers
        edit = last.edit
        if songChanged {
            Task {
                await loadSong()
                await rebuild()
            }
        } else if songMoved {
            Task { await rebuild() }
        }
    }

    /// Marks a gate crossing on the frame that is showing. Pressed during playback, it takes the frame of that moment.
    func addMarker() {
        guard phase == .ready else { return }
        let here = playing ? frameIndex(at: player.currentTime().seconds) : frame
        guard !markers.contains(here) else { return }
        remember()
        markers = (markers + [here]).sorted()
    }

    /// Removes a marker: the one given, or the one under the playhead.
    func removeMarker(_ marker: Int? = nil) {
        let which = marker ?? frame
        guard markers.contains(which) else { return }
        remember()
        markers.removeAll { $0 == which }
    }

    /// Removes every marker. Undo brings them back.
    func removeAllMarkers() {
        guard phase == .ready, !markers.isEmpty else { return }
        remember()
        markers = []
    }

    /// Moves the marker under the playhead one frame, taking the playhead with it.
    func nudgeMarker(by step: Int) {
        guard !playing, let index = markers.firstIndex(of: frame) else { return }
        let moved = frame + step
        guard moved >= 0, moved < frameCount, !markers.contains(moved) else { return }
        remember()
        markers[index] = moved
        markers.sort()
        show(moved)
    }

    func setVideoStart() {
        let now = seconds(frame)
        if let end = edit.videoEnd ?? automaticStretch?.upperBound, now >= end {
            NSSound.beep()
            return
        }
        remember()
        edit.videoStart = now
    }

    func setVideoEnd() {
        // Up to the end of the frame that is showing.
        let now = seconds(frame + 1)
        if let start = edit.videoStart ?? automaticStretch?.lowerBound, now <= start {
            NSSound.beep()
            return
        }
        remember()
        edit.videoEnd = now
    }

    func automaticVideo() {
        guard edit.videoStart != nil || edit.videoEnd != nil else { return }
        remember()
        edit.videoStart = nil
        edit.videoEnd = nil
    }

    /// While an end of the stretch is being dragged along the timeline.
    func dragVideoStart(to time: Double) {
        let latest = (edit.videoEnd ?? automaticStretch?.upperBound ?? duration) - 0.5
        edit.videoStart = min(max(0, seconds(frameIndex(at: time))), max(0, latest))
    }

    func dragVideoEnd(to time: Double) {
        let earliest = (edit.videoStart ?? automaticStretch?.lowerBound ?? 0) + 0.5
        edit.videoEnd = max(min(duration, seconds(frameIndex(at: time))), earliest)
    }

    // MARK: Music

    private func findSongs() {
        func sounds(in folder: URL) -> [String] {
            ((try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? [])
                .filter { !$0.hasPrefix(".") && Model.audioExtensions.contains(($0 as NSString).pathExtension.lowercased()) }
        }
        let own = sounds(in: musicFolder)
        premiereMusic = own.sorted { $0.localizedStandardCompare($1) == .orderedAscending }
            .first { ($0 as NSString).deletingPathExtension.lowercased() == target.name.lowercased() }
        // The library's songs, and any still only in this track's folder. A sound file named after a clip is Premiere's, not a song.
        let kept = sounds(in: songLibrary)
        let onlyHere = own.filter { !clipNames.contains(($0 as NSString).deletingPathExtension.lowercased()) && !kept.contains($0) }
        songs = (kept + onlyHere).sorted { $0.localizedStandardCompare($1) == .orderedAscending }
    }

    /// `nil` is the sound from Premiere when there is some, an empty name is silence, anything else is a song in the music folder.
    func choose(song name: String?) {
        guard name != edit.song else { return }
        pause()
        remember()
        // Marks belong to the song they were made in: this song's are put by, and the new one's brought out.
        if let old = edit.song, !old.isEmpty, songMarks != (marksBySong[old] ?? []) || touched[old] != nil { touched[old] = songMarks }
        edit.song = name
        let kept = name.flatMap { touched[$0] ?? marksBySong[$0] } ?? []
        edit.songMarks = kept.isEmpty ? nil : kept
        // A song that hasn't been placed yet starts with the video.
        if let name, !name.isEmpty, edit.songStart == nil { edit.songStart = stretch?.lowerBound ?? 0 }
        Task {
            await loadSong()
            await rebuild()
        }
    }

    /// Puts the start of the song at a clip time.
    func placeSong(at start: Double) {
        guard song != nil else { return }
        pause()
        remember()
        edit.songStart = start
        Task { await rebuild() }
    }

    /// After the song, or an end of the music, has been dragged along the timeline.
    func songMoved() {
        Task { await rebuild() }
    }

    /// Starts the music at a clip time, or at the playhead: before that the video is silent.
    func setMusicIn(at time: Double? = nil) {
        guard song != nil else { return }
        let now = time ?? seconds(frame)
        if let stops = edit.musicOut, now >= stops {
            NSSound.beep()
            return
        }
        pause()
        remember()
        edit.musicIn = now
        Task { await rebuild() }
    }

    /// Stops the music at a clip time, or at the end of the frame that is showing.
    func setMusicOut(at time: Double? = nil) {
        guard song != nil else { return }
        let now = time ?? seconds(frame + 1)
        if let comesIn = edit.musicIn, now <= comesIn {
            NSSound.beep()
            return
        }
        pause()
        remember()
        edit.musicOut = now
        Task { await rebuild() }
    }

    /// Lets the music run for the whole video again.
    func wholeMusic() {
        guard edit.musicIn != nil || edit.musicOut != nil else { return }
        pause()
        remember()
        edit.musicIn = nil
        edit.musicOut = nil
        Task { await rebuild() }
    }

    /// While an end of the music is being dragged along the timeline.
    func dragMusicIn(to time: Double) {
        edit.musicIn = min(max(0, seconds(frameIndex(at: time))), (edit.musicOut ?? duration) - 0.5)
    }

    func dragMusicOut(to time: Double) {
        edit.musicOut = max(min(duration, seconds(frameIndex(at: time))), (edit.musicIn ?? 0) + 0.5)
    }

    /// Marks a point in the song, such as a drop: the one playing at a clip time, or at the playhead.
    func addSongMark(at time: Double? = nil) {
        guard let span = songSpan else { return }
        addSongMark(inSong: (time ?? seconds(frame)) - span.lowerBound)
    }

    /// Marks a point in the song, given as a time into it. Returns the mark, or nil when there is one there already.
    @discardableResult
    func addSongMark(inSong time: Double) -> Double? {
        let mark = (time * 1000).rounded() / 1000
        guard song != nil, mark >= 0, mark <= songLength, !songMarks.contains(where: { abs($0 - mark) < 0.02 }) else {
            NSSound.beep()
            return nil
        }
        remember()
        edit.songMarks = (songMarks + [mark]).sorted()
        return mark
    }

    /// The mark at a time in the song, to within a thousandth of a second or so.
    func songMark(at time: Double) -> Double? {
        songMarks.first { abs($0 - time) < 0.0015 }
    }

    /// While a mark is being dragged along the sound wave: moves it and returns where it now is.
    /// It stays clear of the other marks.
    func dragSongMark(_ mark: Double, to time: Double) -> Double {
        let moved = (min(max(0, time), songLength) * 1000).rounded() / 1000
        guard moved != mark, songMarks.contains(mark), !songMarks.contains(where: { $0 != mark && abs($0 - moved) < 0.02 }) else { return mark }
        edit.songMarks = songMarks.map { $0 == mark ? moved : $0 }.sorted()
        return moved
    }

    /// A time in the song, moved onto a mark or a drop that is within reach of it, or onto a beat when
    /// catching on the beat is switched on. `except` is a mark to leave out: the one being moved.
    func caught(_ time: Double, within reach: Double, except: Double? = nil) -> Double {
        var best = time, nearest = reach
        for point in songMarks.filter({ $0 != except }) + spots.map(\.time) where abs(point - time) < nearest {
            nearest = abs(point - time)
            best = point
        }
        if best == time, snapToBeat, let beat = analysis?.beat(nearest: time), abs(beat - time) < reach { best = beat }
        return min(max(0, best), songLength)
    }

    /// Slides the song so a moment in it falls on a gate crossing, and parks the playhead a few
    /// seconds before the gate, ready to hear how it lands. Gate 0 is the start gate.
    func put(songTime: Double, onGate gate: Int = 0) {
        guard song != nil, markers.indices.contains(gate) else {
            NSSound.beep()
            return
        }
        let crossing = seconds(markers[gate])
        lineUp(songMark: songTime, with: crossing)
        show(frameIndex(at: max(stretch?.lowerBound ?? 0, crossing - EditorFormat.leadIn)))
    }

    func removeSongMark(_ mark: Double) {
        guard songMarks.contains(mark) else { return }
        remember()
        let left = songMarks.filter { $0 != mark }
        edit.songMarks = left.isEmpty ? nil : left
    }

    func removeAllSongMarks() {
        guard !songMarks.isEmpty else { return }
        remember()
        edit.songMarks = nil
    }

    /// Slides the song so that one of its marks falls on a clip time.
    func lineUp(songMark mark: Double, with time: Double) {
        placeSong(at: ((time - mark) * 1000).rounded() / 1000)
    }

    /// Asks for an audio file and adds it to the song library.
    func importSong() {
        pause()
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.audio]
        panel.message = "Choose a song. A copy goes into your song library, where every track can use it."
        guard panel.runModal() == .OK, let picked = panel.url else { return }
        importSong(from: picked)
    }

    /// Copies an audio file into the song library and makes it the run's song.
    func importSong(from picked: URL) {
        let name = picked.lastPathComponent
        if let problem = keep(picked, as: name) {
            message = "\(name) couldn't be added to your songs: \(problem)"
            return
        }
        findSongs()
        choose(song: name)
    }

    /// Puts a copy of a sound file in the song library, unless one of that name is there. Returns what went wrong, or nil.
    private func keep(_ file: URL, as name: String) -> String? {
        let destination = songLibrary.appendingPathComponent(name)
        guard file.standardizedFileURL.path != destination.standardizedFileURL.path, !FileManager.default.fileExists(atPath: destination.path) else { return nil }
        do {
            try FileManager.default.createDirectory(at: songLibrary, withIntermediateDirectories: true)
            try FileManager.default.copyItem(at: file, to: destination)
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    private func loadSong() async {
        closeSoundWave()
        song = nil
        songLength = 0
        wave = SongWave()
        analysis = nil
        listening = false
        guard let name = edit.song, !name.isEmpty else { return }
        // A song that is only in this track's folder, from before there was a library, joins the
        // library when it is used, so the next track has it too. The track's copy is left where it is.
        let own = musicFolder.appendingPathComponent(name)
        if FileManager.default.fileExists(atPath: own.path), keep(own, as: name) == nil { findSongs() }
        let url = songFile(name)
        // Exact timing, so the song plays and is cut exactly where its sound wave shows it.
        let asset = AVURLAsset(url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
        guard let length = try? await asset.load(.duration), length.seconds > 0,
              (try? await asset.loadTracks(withMediaType: .audio).first) != nil else {
            message = "\(name) isn't among your songs any more, or can't be read."
            return
        }
        guard edit.song == name else { return }
        song = asset
        songLength = length.seconds
        listening = true
        let tool = tool
        Task {
            let drawn = await Editor.soundWave(of: url)
            if self.edit.song == name { self.wave = drawn }
        }
        Task {
            let heard = await Task.detached { Editor.analysis(of: url, tool: tool) }.value
            if self.edit.song == name {
                self.analysis = heard
                self.listening = false
            }
        }
    }

    /// A sound file's wave, for drawing it.
    nonisolated static func soundWave(of url: URL) async -> SongWave {
        let asset = AVURLAsset(url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
        guard let track = try? await asset.loadTracks(withMediaType: .audio).first, let reader = try? AVAssetReader(asset: asset) else { return SongWave() }
        let rate = 16000.0
        let output = AVAssetReaderAudioMixOutput(audioTracks: [track], audioSettings: [
            AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false, AVLinearPCMIsNonInterleaved: false, AVSampleRateKey: rate, AVNumberOfChannelsKey: 1,
        ])
        guard reader.canAdd(output) else { return SongWave() }
        reader.add(output)
        guard reader.startReading() else { return SongWave() }
        let stretch = Int(rate / SongWave.fine)
        var close = SongWave.Readings()
        var highest: Float = 0, power: Float = 0, filled = 0
        // The bass is what is left below 150 Hz or so. Filtering it out makes it a moment late, so its
        // readings start that much later into the sound and line up again.
        let ease = Float(1 - exp(-2 * Double.pi * 200 / rate))
        var once: Float = 0, twice: Float = 0, bassPower: Float = 0, bassFilled = 0
        var late = Int((2 * (1 - Double(ease)) / Double(ease)).rounded())
        var started = false
        while let buffer = output.copyNextSampleBuffer() {
            guard let block = CMSampleBufferGetDataBuffer(buffer) else { continue }
            if !started {
                started = true
                // Keep to the file's own clock: anything before the first sound it hands over is silence.
                let lead = CMSampleBufferGetPresentationTimeStamp(buffer).seconds
                if lead > 0, lead < 10 {
                    let silent = [Float](repeating: 0, count: Int((lead * SongWave.fine).rounded()))
                    close.peak += silent
                    close.power += silent
                    close.bassPower += silent
                }
            }
            var samples = [Int16](repeating: 0, count: CMBlockBufferGetDataLength(block) / 2)
            let copied = samples.withUnsafeMutableBytes { CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: $0.count, destination: $0.baseAddress!) }
            guard copied == noErr else { continue }
            for sample in samples {
                let value = Float(sample) / 32768
                highest = max(highest, abs(value))
                power += value * value
                filled += 1
                if filled == stretch {
                    close.peak.append(highest)
                    close.power.append(power / Float(stretch))
                    highest = 0
                    power = 0
                    filled = 0
                }
                once += ease * (value - once)
                twice += ease * (once - twice)
                if late > 0 {
                    late -= 1
                } else {
                    bassPower += twice * twice
                    bassFilled += 1
                    if bassFilled == stretch {
                        close.bassPower.append(bassPower / Float(stretch))
                        bassPower = 0
                        bassFilled = 0
                    }
                }
            }
        }
        close.bassPower += [Float](repeating: 0, count: max(0, close.peak.count - close.bassPower.count))
        // The loudest moment fills the height.
        if let top = close.peak.max(), top > 0 {
            close.peak = close.peak.map { $0 / top }
            close.power = close.power.map { $0 / (top * top) }
            close.bassPower = close.bassPower.map { $0 / (top * top) }
        }
        var wave = SongWave()
        wave.close = close
        let wide = Int(SongWave.fine / SongWave.coarse)
        func gathered(_ values: [Float], _ gather: (ArraySlice<Float>) -> Float) -> [Float] {
            stride(from: 0, to: values.count, by: wide).map { gather(values[$0..<min(values.count, $0 + wide)]) }
        }
        wave.far.peak = gathered(close.peak) { $0.max() ?? 0 }
        wave.far.power = gathered(close.power) { $0.reduce(0, +) / Float($0.count) }
        wave.far.bassPower = gathered(close.bassPower) { $0.reduce(0, +) / Float($0.count) }
        // The song's loud passages are drawn at nine tenths of the height.
        let loudness = wave.far.power.map { $0.squareRoot() }.sorted()
        if let loud = loudness.isEmpty ? nil : loudness[Int(Double(loudness.count - 1) * 0.95)], loud > 0 { wave.gain = 0.9 / loud }
        return wave
    }

    /// What the lap timer hears in a song: its tempo, where its beat falls, and its drops. The answer
    /// is kept in the Caches folder, so a song is only listened to once.
    nonisolated static func analysis(of url: URL, tool: URL) -> SongAnalysis? {
        let manager = FileManager.default
        let folder = Model.caches.appendingPathComponent("Songs", isDirectory: true)
        let attributes = try? manager.attributesOfItem(atPath: url.path)
        let size = (attributes?[.size] as? Int64) ?? 0
        let changed = Int((attributes?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0)
        // The number at the end is the way of listening. A version that hears songs differently changes it and starts again.
        let note = folder.appendingPathComponent("\(url.deletingPathExtension().lastPathComponent)-\(size)-\(changed)-1.json")
        if let data = try? Data(contentsOf: note), let kept = try? JSONDecoder().decode(SongAnalysis.self, from: data) { return kept }
        let result = runTool(tool, ["--song", url.path])
        guard result.status == 0, let heard = try? JSONDecoder().decode(SongAnalysis.self, from: Data(result.output.utf8)) else { return nil }
        try? manager.createDirectory(at: folder, withIntermediateDirectories: true)
        try? Data(result.output.utf8).write(to: note)
        return heard
    }

    // MARK: The sound wave window

    /// Opens the sound wave window on a moment of the song: the one under the timeline's playhead
    /// when none is given, or the song's biggest drop when the playhead is not over the song.
    func openSoundWave(at time: Double? = nil) {
        guard let song, songLength > 0, soundWave == nil else { return }
        pause()
        let under = songTime(at: seconds(frame)) ?? -1
        let start = time ?? ((0...songLength).contains(under) ? under : spots.max { $0.strength < $1.strength }?.time ?? 0)
        soundWave = SoundWave(song: song, length: songLength, at: min(max(0, start), songLength))
    }

    func closeSoundWave() {
        soundWave?.stop()
        soundWave = nil
    }

    /// Marks the song where the sound wave's playhead is: during playback, the moment it was pressed,
    /// on the beat when catching on the beat is switched on.
    func markSongAtWavePlayhead() {
        guard let soundWave else { return }
        var time = soundWave.now
        if soundWave.playing, snapToBeat, let beat = analysis?.beat(nearest: time) { time = beat }
        if let mark = addSongMark(inSong: time), !soundWave.playing { soundWave.go(to: mark) }
    }

    /// Removes the mark the sound wave's playhead is on.
    func removeSongMarkAtWavePlayhead() {
        guard let soundWave, let mark = songMark(at: soundWave.now) else { return }
        removeSongMark(mark)
    }

    // The marker commands, from the keys and from the Markers menu. While the song's sound wave is
    // open they are about the marks in the song. Otherwise they are about the clip's gate crossings.

    func mark() {
        if soundWave != nil { markSongAtWavePlayhead() } else { addMarker() }
    }

    func goToMark(_ direction: Int) {
        if soundWave != nil { jumpInSong(direction) } else { jump(direction) }
    }

    func clearMark() {
        if soundWave != nil { removeSongMarkAtWavePlayhead() } else { removeMarker() }
    }

    func clearAllMarks() {
        if soundWave != nil { removeAllSongMarks() } else { removeAllMarkers() }
    }

    /// Moves the mark under the sound wave's playhead a little, taking the playhead with it.
    func nudgeSongMark(by seconds: Double) {
        guard let soundWave, !soundWave.playing, let mark = songMark(at: soundWave.now) else { return }
        let moved = ((mark + seconds) * 1000).rounded() / 1000
        guard moved >= 0, moved <= songLength, !songMarks.contains(where: { $0 != mark && abs($0 - moved) < 0.02 }) else { return }
        remember()
        edit.songMarks = songMarks.map { $0 == mark ? moved : $0 }.sorted()
        soundWave.go(to: moved)
    }

    /// To the mark or drop before or after the sound wave's playhead.
    func jumpInSong(_ direction: Int) {
        guard let soundWave else { return }
        let points = (songMarks + spots.map(\.time)).sorted()
        let now = soundWave.now
        if let next = direction < 0 ? points.last(where: { $0 < now - 0.002 }) : points.first(where: { $0 > now + 0.002 }) {
            soundWave.pause()
            soundWave.go(to: next)
        }
    }

    /// A key pressed while the sound wave window is open.
    private func handle(_ event: NSEvent, in soundWave: SoundWave) -> Bool {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        let command = flags.contains(.command)
        switch event.keyCode {
        case 49: soundWave.togglePlay()
        case 123, 124:
            let direction = event.keyCode == 123 ? -1.0 : 1.0
            if command {
                nudgeSongMark(by: direction * (flags.contains(.shift) ? 0.01 : 0.001))
            } else {
                // A frame of the video at a time, as on the timeline.
                soundWave.pause()
                soundWave.go(to: soundWave.now + direction * (flags.contains(.option) ? 1 : flags.contains(.shift) ? 10 / fps : 1 / fps))
            }
        case 126: jumpInSong(-1)
        case 125: jumpInSong(1)
        case 51, 117: removeSongMarkAtWavePlayhead()
        default:
            let key = (event.charactersIgnoringModifiers ?? "").lowercased()
            if key == "m" {
                // The same keys as for the clip's markers, here for the marks in the song.
                switch (command, flags.contains(.option), flags.contains(.shift)) {
                case (false, false, false): markSongAtWavePlayhead()
                case (false, false, true): jumpInSong(1)
                case (true, false, true): jumpInSong(-1)
                case (false, true, false): removeSongMarkAtWavePlayhead()
                case (true, true, false): removeAllSongMarks()
                default: return false
                }
                return true
            }
            switch (key, command) {
            case ("b", false): markSongAtWavePlayhead()
            case ("z", true): undo()
            default: return false
            }
        }
        return true
    }

    // MARK: Saving

    /// The markers as a file the lap timer reads, laid out like Premiere's marker export.
    func markerFile() -> String {
        let timebase = Int(fps.rounded())
        var lines = ["\(EditorFormat.tag), \(fpsLabel) frames a second", "Marker Name,Description,In,Out,Duration,Marker Type"]
        for (index, marker) in markers.enumerated() {
            let whole = marker / timebase
            let code = String(format: "%02d:%02d:%02d:%02d", whole / 3600, whole / 60 % 60, whole % 60, marker % timebase)
            lines.append("\(index == 0 ? "Lap 1 starts" : "Lap \(index) ends"),,\(code),\(code),00:00:00:00,Comment")
        }
        return lines.joined(separator: "\n") + "\n"
    }

    func markSaved() {
        for (song, marks) in marksToKeep { marksBySong[song] = marks }
        touched = [:]
        savedMarkers = markers
        savedEdit = edit
        saved = true
    }

    /// Handles a key press. False leaves it for whoever else wants it.
    func handle(_ event: NSEvent) -> Bool {
        guard phase == .ready else { return false }
        if let soundWave { return handle(event, in: soundWave) }
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        let command = flags.contains(.command)
        switch event.keyCode {
        case 49: togglePlay()
        case 123, 124:
            let direction = event.keyCode == 123 ? -1 : 1
            if command {
                nudgeMarker(by: direction)
            } else {
                step(direction * (flags.contains(.option) ? Int(fps.rounded()) : flags.contains(.shift) ? 10 : 1))
            }
        case 126: jump(-1)
        case 125: jump(1)
        case 51, 117: removeMarker()
        default:
            let key = (event.charactersIgnoringModifiers ?? "").lowercased()
            if key == "m" {
                // The marker keys are Premiere's: M adds, Shift-M and Shift-Command-M go to the next and
                // the previous, Option-M clears the one here, Option-Command-M clears them all.
                switch (command, flags.contains(.option), flags.contains(.shift)) {
                case (false, false, false): addMarker()
                case (false, false, true): jump(1)
                case (true, false, true): jump(-1)
                case (false, true, false): removeMarker()
                case (true, true, false): removeAllMarkers()
                default: return false
                }
                return true
            }
            switch (key, command) {
            case ("b", false): addSongMark()
            case ("i", false): setVideoStart()
            case ("o", false): setVideoEnd()
            case ("z", true): undo()
            default: return false
            }
        }
        return true
    }
}

/// The sound wave window's own state: the chosen song by itself, with a playhead that runs in song
/// time and playback of just the song. The marks made in it are the editor's.
@MainActor
final class SoundWave: ObservableObject {
    let length: Double
    private let player: AVPlayer
    /// The playhead, in seconds into the song.
    @Published var now: Double
    @Published var playing = false
    /// The stretch of the song on show.
    @Published var visible: ClosedRange<Double>
    private var observer: Any?
    private var seeking = false
    private var wanted: Double?

    /// The shortest stretch the window zooms in to.
    static let closest = 0.25
    /// Set by the checks that work the window themselves, so the song isn't heard while they do.
    static var muted = false

    init(song: AVURLAsset, length: Double, at time: Double) {
        self.length = length
        now = time
        visible = 0...max(length, Self.closest)
        player = AVPlayer(playerItem: AVPlayerItem(asset: song))
        player.actionAtItemEnd = .pause
        player.isMuted = Self.muted
        observer = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 60), queue: .main) { [weak self] time in
            MainActor.assumeIsolated { self?.tick(time.seconds) }
        }
        seek(to: time)
    }

    func stop() {
        player.pause()
        if let observer { player.removeTimeObserver(observer) }
        observer = nil
        player.replaceCurrentItem(with: nil)
        playing = false
    }

    private func seek(to time: Double) {
        // Dragging asks faster than the player can seek: remember the latest and go there next.
        guard !seeking else {
            wanted = time
            return
        }
        seeking = true
        player.seek(to: CMTime(seconds: time, preferredTimescale: 48000), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.seeking = false
                if let next = self.wanted {
                    self.wanted = nil
                    if next != time { self.seek(to: next) }
                }
            }
        }
    }

    /// Moves the playhead. Playback carries on from there.
    func go(to time: Double, follow: Bool = true) {
        now = min(max(0, time), length)
        if follow { keepInView(paging: false) }
        seek(to: now)
    }

    func togglePlay() {
        if playing {
            pause()
            return
        }
        if now >= length - 0.05 { go(to: 0) }
        playing = true
        player.play()
    }

    func pause() {
        guard playing else { return }
        playing = false
        player.pause()
        now = min(max(0, player.currentTime().seconds), length)
    }

    private func tick(_ seconds: Double) {
        guard playing, !seeking else { return }
        now = min(max(0, seconds), length)
        if player.timeControlStatus == .paused {
            // It ran off the end of the song.
            playing = false
            return
        }
        keepInView(paging: true)
    }

    private func keepInView(paging: Bool) {
        let span = visible.upperBound - visible.lowerBound
        guard now < visible.lowerBound || now > visible.upperBound else { return }
        show(from: paging ? now - span * 0.05 : now - span / 2, span: span)
    }

    /// Shows a stretch of the song, kept inside it.
    private func show(from start: Double, span: Double) {
        let span = min(max(span, Self.closest), max(length, Self.closest))
        let lower = min(max(0, start), max(0, length - span))
        visible = lower...(lower + span)
    }

    /// Zooms in or out, keeping the moment at `anchor` where it is on screen. Without one, the playhead stays put.
    func zoom(by factor: Double, around anchor: Double? = nil) {
        let span = visible.upperBound - visible.lowerBound
        let inView = (visible.lowerBound...visible.upperBound).contains(now)
        let pivot = anchor ?? (inView ? now : visible.lowerBound + span / 2)
        let wider = min(max(span * factor, Self.closest), max(length, Self.closest))
        show(from: pivot - (pivot - visible.lowerBound) / span * wider, span: wider)
    }

    func pan(by seconds: Double) {
        show(from: visible.lowerBound + seconds, span: visible.upperBound - visible.lowerBound)
    }

    func showAll() { visible = 0...max(length, Self.closest) }

    /// Shows a few seconds either side of a moment.
    func showClosely(around time: Double, span: Double = 8) {
        show(from: time - span / 2, span: span)
    }
}

/// Draws the lap timer for the marker editor with the lap timer's own code, which is compiled into
/// the app for this: what shows over the picture here is what the 16:9 video gets. It keeps one
/// box and draws it again for each frame, and makes a new one only when the laps, the size or the
/// pilot's details change.
@MainActor
final class TimerDrawer {
    private var panel: Panel?
    private var made = ""

    /// The timer as it reads `seconds` into the clip, and where its top-left corner goes in a frame
    /// of that many pixels. Nil while there are fewer than two gates, when there is no lap to time.
    func picture(crossings: [Double], at seconds: Double, options: Options, frame: CGSize) -> (image: CGImage, origin: CGPoint)? {
        // The video's frame is 1080 high, and the box is drawn for that. Here the frame is whatever size the picture is.
        let scale = frame.height / 1080 * CGFloat(options.userScale)
        // The event's logo is part of the box. A different picture, or the same file changed, is a different box.
        let logoChanged = options.logoPath.flatMap { try? FileManager.default.attributesOfItem(atPath: $0)[.modificationDate] as? Date }
        let wanted = "\(crossings) \(scale) \(options.title ?? "") \(options.badge ?? "") \(options.event ?? "") \(options.trackName ?? "") "
            + "\(options.accent) \(options.maxRows) \(options.window) \(options.decimals) \(options.logoPath ?? "") \(logoChanged?.timeIntervalSince1970 ?? 0)"
        if wanted != made {
            made = wanted
            panel = nil
            if scale > 0.1, let race = try? makeRace(crossings: crossings, options: options), let accent = parseHexColor(options.accent) {
                panel = Panel(race: race, scale: scale, accent: accent, title: options.title, badge: options.badge,
                              event: options.event, track: options.trackName, maxRows: options.maxRows, logo: loadPicture(options.logoPath))
            }
        }
        guard let panel else { return nil }
        panel.draw(at: seconds)
        let inset = Int((CGFloat(options.margin) * panel.scale).rounded())
        let spot = corner(options.position, boxWidth: panel.pixelWidth, boxHeight: panel.pixelHeight,
                          frameWidth: Int(frame.width), frameHeight: Int(frame.height), inset: inset)
            ?? (x: Int(frame.width) - panel.pixelWidth - inset, y: inset)
        return (panel.image(), CGPoint(x: spot.x, y: spot.y))
    }

    /// The same, written as a picture of the whole frame with the rest of it see-through, the way the
    /// lap timer writes a still. For checking one against the other.
    func still(crossings: [Double], at seconds: Double, options: Options, frame: CGSize, to file: URL) -> Bool {
        guard let drawn = picture(crossings: crossings, at: seconds, options: options, frame: frame), let panel else { return false }
        writeStill(to: file, panel: panel, placement: Placement(frameWidth: Int(frame.width), frameHeight: Int(frame.height), x: Int(drawn.origin.x), y: Int(drawn.origin.y)),
                   seconds: seconds, background: nil)
        return true
    }
}

/// The lap timer over the picture in the marker editor: where the 16:9 video will have it, reading
/// what it will read on the frame that is showing. Each marker added, moved or removed changes it
/// at once, so a run can be checked before a video is made of it.
struct TimerOverlay: View {
    @ObservedObject var editor: Editor
    let options: Options
    @State private var drawer = TimerDrawer()
    @Environment(\.displayScale) private var displayScale

    /// The corner of the frame the box sits in, for the note that stands in for it.
    private var alignment: Alignment {
        switch options.position.trimmed.lowercased().replacingOccurrences(of: " ", with: "-") {
        case "tl", "top-left": return .topLeading
        case "bl", "bottom-left": return .bottomLeading
        case "br", "bottom-right": return .bottomTrailing
        case "tc", "top-center": return .top
        case "bc", "bottom-center": return .bottom
        default: return .topTrailing
        }
    }

    var body: some View {
        GeometryReader { space in
            // The finished video's frame as it sits here: 16:9, as big as fits, in the middle. A 16:9
            // recording fills exactly that.
            let width = min(space.size.width, space.size.height * 16 / 9), height = width * 9 / 16
            let left = (space.size.width - width) / 2, top = (space.size.height - height) / 2
            let pixels = CGSize(width: (width * displayScale).rounded(), height: (height * displayScale).rounded())
            if let timer = drawer.picture(crossings: editor.markers.map(editor.seconds), at: editor.seconds(editor.frame), options: options, frame: pixels) {
                Image(decorative: timer.image, scale: displayScale)
                    .offset(x: left + timer.origin.x / displayScale, y: top + timer.origin.y / displayScale)
            } else {
                Text(editor.markers.isEmpty ? "The lap timer shows here once you mark the start gate and the end of a lap."
                     : "Mark the end of lap 1 and the lap timer shows here.")
                    .font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(0.85)).multilineTextAlignment(.leading)
                    .padding(.horizontal, 10).padding(.vertical, 7).frame(maxWidth: 220, alignment: .leading)
                    .background(Color.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .padding(max(8, 54 * height / 1080))
                    .frame(width: width, height: height, alignment: alignment)
                    .offset(x: left, y: top)
            }
        }
        .allowsHitTesting(false)
    }
}

/// The clip's picture.
struct PlayerView: NSViewRepresentable {
    let player: AVPlayer

    final class Surface: NSView {
        override func makeBackingLayer() -> CALayer {
            let layer = AVPlayerLayer()
            layer.videoGravity = .resizeAspect
            layer.backgroundColor = .black
            return layer
        }
    }

    func makeNSView(context: Context) -> Surface {
        let view = Surface()
        view.wantsLayer = true
        (view.layer as? AVPlayerLayer)?.player = player
        return view
    }

    func updateNSView(_ view: Surface, context: Context) {
        if let layer = view.layer as? AVPlayerLayer, layer.player !== player { layer.player = player }
    }
}

struct EditorView: View {
    @EnvironmentObject var model: Model
    @ObservedObject var editor: Editor
    @State private var monitor: Any?
    /// Asking whether to throw the changes away.
    @State private var discarding = false
    /// Why the work can't be saved as it stands, while the pilot is asked whether to stay or leave without it.
    @State private var unsavable: String?

    /// How wide the editor gets in a window of a given height. The picture can only grow as tall as
    /// the window lets it, so past the width that picture needs, more width would only put black bars
    /// beside it. On a wide screen the editor stays that wide and sits in the middle.
    static func widest(inWindowOfHeight height: CGFloat) -> CGFloat {
        // What the header, the transport and the timeline take up, and the column beside the picture.
        let picture = max(0, height - 394) * 16 / 9
        return max(1600, picture + 382)
    }

    var body: some View {
        GeometryReader { window in
            let widest = Self.widest(inWindowOfHeight: window.size.height)
            VStack(spacing: 0) {
                header
                switch editor.phase {
                case .loading:
                    VStack(spacing: 14) {
                        ProgressView().controlSize(.large)
                        Text("Opening \(URL(fileURLWithPath: editor.target.clip).lastPathComponent)").font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.dim)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                case .failed(let reason):
                    Label(reason, systemImage: "exclamationmark.triangle.fill")
                        .font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.warn)
                        .frame(maxWidth: 560).frame(maxWidth: .infinity, maxHeight: .infinity)
                case .ready:
                    workspace
                }
            }
            .frame(maxWidth: widest, maxHeight: .infinity)
            .frame(width: window.size.width, height: window.size.height)
            .overlay {
                // The sound wave window sits over the editor, which is dimmed and out of reach behind it.
                if let wave = editor.soundWave {
                    ZStack(alignment: .bottom) {
                        Color.black.opacity(0.6).contentShape(Rectangle()).onTapGesture { editor.closeSoundWave() }
                        SoundWaveView(editor: editor, wave: wave).padding(.horizontal, 24).padding(.bottom, 18).frame(maxWidth: widest)
                    }
                }
            }
        }
        .background(Theme.background)
        .onAppear(perform: watchKeys)
        .onDisappear {
            if let monitor { NSEvent.removeMonitor(monitor) }
            monitor = nil
        }
        .confirmationDialog("Throw away the changes to \(editor.target.name)?", isPresented: $discarding) {
            Button("Throw them away", role: .destructive) { model.closeEditor() }
            Button("Keep working", role: .cancel) {}
        } message: {
            Text("Its markers and music go back to how they were when they were last saved.")
        }
        .confirmationDialog("\(editor.target.name) can't be saved yet", isPresented: Binding(get: { unsavable != nil }, set: { if !$0 { unsavable = nil } }), presenting: unsavable) { _ in
            Button("Leave without saving", role: .destructive) { model.closeEditor() }
            Button("Keep working", role: .cancel) {}
        } message: { reason in
            Text(reason)
        }
    }

    private func watchKeys() {
        guard monitor == nil else { return }
        // A text field on the page underneath may still be holding the keyboard: M would be typed into it.
        for window in NSApp.windows where window.firstResponder is NSTextView { window.makeFirstResponder(nil) }
        let editor = editor
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            // Leave typing, and anything aimed at a dialog, alone.
            let window = event.window ?? NSApp.mainWindow
            if discarding || unsavable != nil || NSApp.modalWindow != nil || window?.attachedSheet != nil || window?.firstResponder is NSTextView { return event }
            let command = event.modifierFlags.contains(.command)
            if command, event.charactersIgnoringModifiers?.lowercased() == "s" {
                _ = save()
                return nil
            }
            if event.keyCode == 53 {
                // Esc closes the sound wave window first, when it is open.
                if editor.soundWave != nil { editor.closeSoundWave() } else { done() }
                return nil
            }
            return editor.handle(event) ? nil : event
        }
    }

    @discardableResult
    private func save() -> Bool {
        guard editor.dirty else { return true }
        if let problem = model.save(editor) {
            editor.message = problem
            return false
        }
        return true
    }

    /// Done keeps the work and goes back: there is nothing to answer first. Only when it can't be
    /// saved as it stands, with fewer than two gates marked say, is the pilot asked what to do.
    private func done() {
        guard editor.dirty else {
            model.closeEditor()
            return
        }
        editor.pause()
        if let problem = model.save(editor) {
            unsavable = problem
        } else {
            model.closeEditor()
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 14) {
            Button(action: done) { Label(Model.trackName(editor.target.track), systemImage: "chevron.left") }.buttonStyle(SecondaryButton())
            VStack(alignment: .leading, spacing: 1) {
                Text(editor.target.name).font(.system(size: 24, weight: .black))
                Text("MARKERS & MUSIC").label()
            }
            Spacer()
            Group {
                if let message = editor.message {
                    Text(message).foregroundStyle(Theme.warn)
                } else if editor.dirty {
                    Text("Not saved yet. Done saves it.").foregroundStyle(Theme.dim)
                } else if editor.saved {
                    Label("Saved", systemImage: "checkmark.circle.fill").foregroundStyle(Theme.good)
                }
            }
            .font(.system(size: 12, weight: .semibold)).multilineTextAlignment(.trailing).frame(maxWidth: 460, alignment: .trailing)
            // One button finishes: it saves and goes back. Leaving without saving is the other choice,
            // and only there while there is something to lose.
            if editor.dirty {
                Button("Discard changes") {
                    editor.pause()
                    discarding = true
                }
                .buttonStyle(SecondaryButton()).help("Go back without keeping what you changed since it was last saved.")
            }
            Button("Done", action: done).buttonStyle(PrimaryButton())
                .help(editor.dirty ? "Save, and go back to \(Model.trackName(editor.target.track)) (Esc). To save and stay here, press ⌘S."
                      : "Back to \(Model.trackName(editor.target.track)) (Esc)")
        }
        .padding(.horizontal, 24).padding(.top, 38).padding(.bottom, 14)
    }

    private var workspace: some View {
        VStack(spacing: 12) {
            HStack(alignment: .top, spacing: 14) {
                VStack(spacing: 10) {
                    PlayerView(player: editor.player)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Color.black)
                        .overlay {
                            if editor.showsTimer { TimerOverlay(editor: editor, options: model.timerOptions(for: editor.target.track)) }
                        }
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(Color.clear.contentShape(Rectangle()).onTapGesture { editor.togglePlay() })
                    transport
                }
                ScrollView {
                    VStack(spacing: 12) {
                        laps
                        videoCard
                        musicCard
                    }
                }
                .frame(width: 320)
            }
            timeline
        }
        .padding(.horizontal, 24).padding(.bottom, 18)
    }

    private func transportButton(_ symbol: String, _ help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: symbol).frame(width: 18, height: 14) }.buttonStyle(SecondaryButton()).help(help).accessibilityLabel(help)
    }

    private var transport: some View {
        HStack(spacing: 7) {
            VStack(alignment: .leading, spacing: 1) {
                Text(EditorFormat.clock(editor.seconds(editor.frame))).font(.system(size: 22, weight: .black).monospacedDigit())
                Text("FRAME \(editor.frame) OF \(editor.frameCount - 1)").font(.system(size: 10, weight: .heavy)).tracking(1.1).foregroundStyle(Theme.faint)
            }
            .frame(width: 170, alignment: .leading)
            Spacer(minLength: 0)
            transportButton("backward.end.fill", "Previous marker (↑)") { editor.jump(-1) }
            Button("−1 s") { editor.step(-Int(editor.fps.rounded())) }.buttonStyle(SecondaryButton()).help("Back one second (⌥←)")
            transportButton("backward.frame.fill", "Back one frame (←). With Shift, ten frames.") { editor.step(-1) }
            Button { editor.togglePlay() } label: { Image(systemName: editor.playing ? "pause.fill" : "play.fill").frame(width: 22, height: 14) }
                .buttonStyle(PrimaryButton()).help("Play or pause (Space)").accessibilityLabel(editor.playing ? "Pause" : "Play")
            transportButton("forward.frame.fill", "Forward one frame (→). With Shift, ten frames.") { editor.step(1) }
            Button("+1 s") { editor.step(Int(editor.fps.rounded())) }.buttonStyle(SecondaryButton()).help("Forward one second (⌥→)")
            transportButton("forward.end.fill", "Next marker (↓)") { editor.jump(1) }
            Spacer(minLength: 0)
            Menu {
                ForEach([Float(0.25), 0.5, 1], id: \.self) { speed in
                    Button(speed == 1 ? "Normal speed" : speed == 0.5 ? "Half speed" : "Quarter speed") { editor.speed = speed }
                }
            } label: {
                Text(editor.speed == 1 ? "1×" : editor.speed == 0.5 ? "½×" : "¼×").font(.system(size: 12, weight: .bold))
            }
            .menuStyle(.borderlessButton).fixedSize()
            .padding(.horizontal, 10).padding(.vertical, 7)
            .background(Theme.raised, in: Capsule()).overlay(Capsule().strokeBorder(Theme.stroke))
            .help("Playback speed")
            Button { editor.showsTimer.toggle() } label: {
                Image(systemName: "timer").frame(width: 18, height: 14).foregroundStyle(editor.showsTimer ? Theme.accent : .white.opacity(0.92))
            }
            .buttonStyle(SecondaryButton())
            .help(editor.showsTimer ? "Hide the lap timer on the picture" : "Show the lap timer on the picture, as the 16:9 video will have it")
            .accessibilityLabel(editor.showsTimer ? "Hide the lap timer" : "Show the lap timer")
            if editor.markers.contains(editor.frame) && !editor.playing {
                Button("Remove marker") { editor.removeMarker() }.buttonStyle(SecondaryButton()).help("Remove the marker on this frame (⌫)")
            } else {
                Button { editor.addMarker() } label: {
                    HStack(spacing: 7) {
                        Text("Mark crossing")
                        // The key that does the same, as in Premiere.
                        Text("M").font(.system(size: 11, weight: .black)).padding(.horizontal, 5).padding(.vertical, 1)
                            .background(Theme.onAccent.opacity(0.18), in: RoundedRectangle(cornerRadius: 4, style: .continuous))
                    }
                }
                .buttonStyle(PrimaryButton()).help("Mark a gate crossing on this frame (M)")
            }
        }
    }

    private var laps: some View {
        let times = editor.laps, best = editor.best
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text("LAPS").label()
                Spacer()
                Text(best.map { EditorFormat.lap($0.total) } ?? "–")
                    .font(.system(size: 26, weight: .black).monospacedDigit()).foregroundStyle(best == nil ? Theme.faint : Theme.accent)
            }
            Text(best.map { "Best \(editor.window) in a row: laps \($0.first + 1)–\($0.first + editor.window)" } ?? "Needs \(editor.window) laps for a time to submit")
                .font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.dim)
            if editor.markers.isEmpty {
                Text("Step to the frame where you cross the start/finish gate and press M. The first marker starts lap 1, and each one after it ends a lap.")
                    .font(.system(size: 12)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true).padding(.top, 4)
            } else {
                VStack(spacing: 3) {
                        ForEach(Array(editor.markers.enumerated()), id: \.element) { index, marker in
                            let inBest = best.map { index - 1 >= $0.first && index - 1 < $0.first + editor.window } ?? false
                            HStack(spacing: 8) {
                                Text(index == 0 ? "START" : "LAP \(index)").font(.system(size: 10, weight: .heavy)).tracking(1)
                                    .foregroundStyle(Theme.dim).frame(width: 48, alignment: .leading)
                                Text(EditorFormat.clock(editor.seconds(marker))).font(.system(size: 12, weight: .semibold).monospacedDigit()).foregroundStyle(Theme.faint)
                                Spacer(minLength: 4)
                                if index > 0, index - 1 < times.count {
                                    Text(EditorFormat.lap(times[index - 1])).font(.system(size: 15, weight: .heavy).monospacedDigit())
                                        .foregroundStyle(inBest ? Theme.accent : .white)
                                }
                                Button { editor.removeMarker(marker) } label: { Image(systemName: "xmark").font(.system(size: 9, weight: .heavy)).frame(width: 16, height: 16) }
                                    .buttonStyle(.plain).foregroundStyle(Theme.faint).help("Remove this marker").accessibilityLabel("Remove this marker")
                            }
                            .padding(.horizontal, 9).padding(.vertical, 6)
                            .background(marker == editor.frame ? Theme.accent.opacity(0.16) : Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                            .contentShape(Rectangle())
                            .onTapGesture {
                                editor.pause()
                                editor.show(marker)
                            }
                            .help("Go to this marker. Right-click to delete it.")
                            .contextMenu {
                                Button("Go to This Marker") {
                                    editor.pause()
                                    editor.show(marker)
                                }
                                Button("Delete This Marker") { editor.removeMarker(marker) }
                                Divider()
                                Button("Delete All Markers") { editor.removeAllMarkers() }
                            }
                        }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .card(padding: 14)
    }

    private var videoCard: some View {
        let custom = editor.edit.videoStart != nil || editor.edit.videoEnd != nil
        return VStack(alignment: .leading, spacing: 7) {
            Text("FINISHED VIDEO").label()
            if let stretch = editor.stretch {
                Text("\(EditorFormat.clock(stretch.lowerBound)) to \(EditorFormat.clock(stretch.upperBound))  ·  \(EditorFormat.span(stretch.upperBound - stretch.lowerBound))")
                    .font(.system(size: 13, weight: .bold).monospacedDigit())
                Text(custom ? "Starts and ends where you set it." : "Automatic: from 3 seconds before lap 1 to 8 seconds after the finish.")
                    .font(.system(size: 11)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
            } else {
                Text("Mark the laps and it runs from 3 seconds before lap 1 to 8 seconds after the finish.")
                    .font(.system(size: 11)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 6) {
                Button("Start here") { editor.setVideoStart() }.buttonStyle(SecondaryButton()).help("Start the finished videos on this frame (I)")
                Button("End here") { editor.setVideoEnd() }.buttonStyle(SecondaryButton()).help("End the finished videos on this frame (O)")
                Button("Automatic") { editor.automaticVideo() }.buttonStyle(SecondaryButton()).disabled(!custom)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 14)
    }

    private var musicCard: some View {
        let chosen = editor.edit.song
        let title = (chosen ?? editor.premiereMusic).flatMap { $0.isEmpty ? nil : $0 } ?? "No music"
        return VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline) {
                Text("MUSIC").label()
                Spacer()
                if let heard = editor.analysis, let tempo = heard.tempoLabel {
                    Text(heard.beatLength == nil ? "About \(tempo)" : tempo).font(.system(size: 12, weight: .heavy).monospacedDigit()).foregroundStyle(Theme.dim)
                        .help(heard.beatLength == nil ? "The song's tempo, roughly. Its beat doesn't keep steady enough time to draw."
                              : "The song's tempo. It can read as double or half what you would call it.")
                }
            }
            Menu {
                // With nothing from Premiere to fall back on, leaving it alone is already silence.
                Button("No music") { editor.choose(song: editor.premiereMusic == nil ? nil : "") }
                if let premiere = editor.premiereMusic {
                    Button("\(premiere), as it sits in Premiere") { editor.choose(song: nil) }
                }
                if !editor.songs.isEmpty {
                    Divider()
                    ForEach(editor.songs, id: \.self) { name in Button(name) { editor.choose(song: name) } }
                }
                Divider()
                Button("Add a song…") { editor.importSong() }
                Button("Show my songs in Finder") { editor.revealSongs() }
            } label: {
                Label(title, systemImage: "music.note").font(.system(size: 12, weight: .bold)).lineLimit(1)
            }
            .menuStyle(.borderlessButton)
            .padding(.horizontal, 11).padding(.vertical, 7)
            .background(Theme.raised, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(Theme.stroke))
            .help("Your songs. A song you add is kept in your library for every track, and so are the marks you put in it.")
            if let span = editor.songSpan {
                songFindings
                Text(songPlacement(span.lowerBound))
                    .font(.system(size: 11)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 6) {
                    Button("Start it here") { editor.placeSong(at: editor.seconds(editor.frame)) }.buttonStyle(SecondaryButton())
                        .help("Put the start of the song on this frame. Or drag the song along the timeline.")
                    Button("Start it with the video") { editor.placeSong(at: editor.stretch?.lowerBound ?? 0) }.buttonStyle(SecondaryButton())
                        .disabled(editor.stretch == nil)
                }
                Text(musicHeard).font(.system(size: 11)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 6) {
                    Button("Music in") { editor.setMusicIn() }.buttonStyle(SecondaryButton()).help("Bring the music in on this frame. Before it, the video is silent.")
                    Button("Music out") { editor.setMusicOut() }.buttonStyle(SecondaryButton()).help("Stop the music on this frame.")
                    Button("Whole video") { editor.wholeMusic() }.buttonStyle(SecondaryButton())
                        .disabled(editor.edit.musicIn == nil && editor.edit.musicOut == nil)
                }
                HStack(spacing: 6) {
                    Button("Mark the music here") { editor.addSongMark() }.buttonStyle(SecondaryButton())
                        .help("Mark this point in the song, such as a drop (B). Drag the song and the mark catches on a lap marker.")
                    Button("Sound wave") { editor.openSoundWave() }.buttonStyle(SecondaryButton())
                        .help("Open the song's sound wave, big enough to mark it by eye. Double-clicking the song on the timeline does the same.")
                    if !editor.songMarks.isEmpty {
                        // In the colour the pilot's own marks are drawn in.
                        HStack(spacing: 4) {
                            Image(systemName: "diamond.fill").font(.system(size: 8))
                            Text("\(editor.songMarks.count) of yours").font(.system(size: 11, weight: .bold))
                        }
                        .foregroundStyle(Theme.mark)
                        .help("Your own marks in this song. They are drawn in this colour, and the drops the app found in blue.")
                    }
                }
            } else if chosen == nil, editor.premiereMusic != nil {
                Text("Lined up from your saved Premiere project when a video is made. Pick a song instead to place it here.")
                    .font(.system(size: 11)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
            } else if title == "No music" {
                Text(editor.songs.isEmpty ? "Add a song and drag it along the timeline to line it up. It is kept in your song library, with any marks you put in it, for your other clips."
                     : "Pick a song and drag it along the timeline to line it up.")
                    .font(.system(size: 11)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 14)
    }

    /// The drops the lap timer heard in the song, to put on the start gate.
    @ViewBuilder
    private var songFindings: some View {
        if editor.listening {
            HStack(spacing: 7) {
                ProgressView().controlSize(.small)
                Text("Listening for the tempo and the drops…").font(.system(size: 11)).foregroundStyle(Theme.dim)
            }
            .padding(.vertical, 3)
        } else if let heard = editor.analysis {
            HStack(spacing: 6) {
                // The colour the drops are drawn in on the timeline and the sound wave.
                Image(systemName: "arrowtriangle.up.fill").font(.system(size: 8)).foregroundStyle(Theme.drop)
                Text("DROPS THE APP FOUND").label()
            }
            .padding(.top, 5)
            if heard.spots.isEmpty {
                Text("Nothing in this song stands out as a drop. Open its sound wave to pick a moment yourself.")
                    .font(.system(size: 11)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
            } else {
                Text(editor.markers.isEmpty ? "Where the song suddenly gets bigger. Mark the start gate, and one of these can be put on it."
                     : "Where the song suddenly gets bigger. Put one on the start gate, then press Space to hear it land.")
                    .font(.system(size: 11)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
                VStack(spacing: 3) {
                    ForEach(heard.spots, id: \.time) { spot in dropRow(spot) }
                }
            }
            Rectangle().fill(Theme.stroke).frame(height: 1).padding(.vertical, 5)
        }
    }

    private func dropRow(_ spot: SongSpot) -> some View {
        let gate = editor.gate(under: spot.time)
        let problem = gate == 0 ? nil : editor.shortfall(withStartGateAt: spot.time)
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Button { editor.openSoundWave(at: spot.time) } label: {
                    Text(EditorFormat.songClock(spot.time)).font(.system(size: 13, weight: .heavy).monospacedDigit()).foregroundStyle(.white)
                }
                .buttonStyle(.plain).help("\(EditorFormat.songClock(spot.time)) into the song. Click to see it in the sound wave.")
                // How much it stands out.
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.1)).frame(width: 40, height: 5)
                    Capsule().fill(Theme.drop).frame(width: max(5, 40 * spot.strength), height: 5)
                }
                .help(spot.strength >= 0.995 ? "The biggest in the song" : "How much it stands out, next to the biggest in the song")
                Spacer(minLength: 4)
                if gate == 0 {
                    Label("On the start gate", systemImage: "checkmark.circle.fill").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.good)
                        .padding(.vertical, 7)
                } else {
                    Button("On the start gate") { editor.put(songTime: spot.time) }.buttonStyle(SecondaryButton()).disabled(editor.markers.isEmpty)
                        .help("Slide the song so this lands as you cross the start gate. Right-click for the other gates.")
                }
            }
            if let gate, gate > 0 {
                Text("It is on the gate that ends lap \(gate).").font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.good)
            }
            if let problem {
                Text(problem).font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.warn).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.leading, 9).padding(.trailing, 5).padding(.vertical, 4)
        .background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
        .contextMenu {
            ForEach(Array(editor.markers.indices), id: \.self) { index in
                Button(index == 0 ? "Put It on the Start Gate" : "Put It on the Gate That Ends Lap \(index)") { editor.put(songTime: spot.time, onGate: index) }
            }
            if !editor.markers.isEmpty { Divider() }
            Button("Mark It in the Song") { editor.addSongMark(inSong: spot.time) }
            Button("See It in the Sound Wave") { editor.openSoundWave(at: spot.time) }
        }
    }

    /// Says in words when the music is heard.
    private var musicHeard: String {
        guard let heard = editor.musicHeard else { return "The music isn't heard anywhere in the video as it stands." }
        let whole = editor.edit.musicIn == nil && editor.edit.musicOut == nil
        return "\(whole ? "The music plays" : "You set the music to play") from \(EditorFormat.clock(heard.lowerBound)) to \(EditorFormat.clock(heard.upperBound)) in the clip, and fades out at the end."
    }

    /// Says in words where the song sits against the video.
    private func songPlacement(_ start: Double) -> String {
        guard let stretch = editor.stretch else { return "The song starts at \(EditorFormat.clock(start)) in the clip." }
        let lead = start - stretch.lowerBound
        if abs(lead) < 0.05 { return "The song starts with the video." }
        return lead < 0 ? "The video starts \(EditorFormat.span(lead)) into the song." : "The song comes in \(EditorFormat.span(lead)) after the video starts."
    }

    private var timeline: some View {
        VStack(alignment: .leading, spacing: 7) {
            EditorOverview(editor: editor).frame(height: 12).padding(.leading, 52)
            HStack(alignment: .top, spacing: 8) {
                ZStack(alignment: .topLeading) {
                    Text("LAPS").offset(y: EditorTimeline.lapsTop + 9)
                    Text("VIDEO").offset(y: EditorTimeline.videoTop + 3)
                    Text("MUSIC").offset(y: EditorTimeline.musicTop + 15)
                }
                .font(.system(size: 9, weight: .heavy)).tracking(1).foregroundStyle(Theme.faint)
                .frame(width: 44, height: EditorTimeline.height, alignment: .topLeading)
                EditorTimeline(editor: editor)
            }
            HStack(spacing: 6) {
                Text("Space play  ·  ← → one frame  ·  M mark  ·  ⌫ remove  ·  ⌘← ⌘→ move marker  ·  ↑ ↓ markers  ·  I O video start, end  ·  B mark the music  ·  double-click the music for its sound wave  ·  right-click for more")
                    .font(.system(size: 11, weight: .medium)).foregroundStyle(Theme.faint).lineLimit(1).minimumScaleFactor(0.7)
                Spacer(minLength: 8)
                Button("Whole clip") { editor.showAll() }.buttonStyle(SecondaryButton())
                Button("The run") { editor.showRun() }.buttonStyle(SecondaryButton()).disabled(editor.stretch == nil)
                Button { editor.zoom(by: 2) } label: { Image(systemName: "minus.magnifyingglass") }.buttonStyle(SecondaryButton()).help("Zoom out")
                Button { editor.zoom(by: 0.5) } label: { Image(systemName: "plus.magnifyingglass") }.buttonStyle(SecondaryButton()).help("Zoom in")
            }
        }
        .card(padding: 12)
    }
}

/// The whole clip in one thin bar: where the laps are, what the timeline below is showing, and the playhead.
struct EditorOverview: View {
    @ObservedObject var editor: Editor

    var body: some View {
        GeometryReader { geometry in
            Canvas { context, size in
                let total = max(editor.duration, 0.001)
                func x(_ seconds: Double) -> CGFloat { CGFloat(seconds / total) * size.width }
                context.fill(Path(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: 3), with: .color(.white.opacity(0.07)))
                if let first = editor.markers.first, let last = editor.markers.last, last > first {
                    let start = x(editor.seconds(first))
                    context.fill(Path(CGRect(x: start, y: 3, width: max(2, x(editor.seconds(last)) - start), height: size.height - 6)), with: .color(Theme.accent.opacity(0.7)))
                }
                let shown = CGRect(x: x(editor.visible.lowerBound), y: 0, width: max(3, x(editor.visible.upperBound) - x(editor.visible.lowerBound)), height: size.height)
                context.fill(Path(roundedRect: shown, cornerRadius: 3), with: .color(.white.opacity(0.14)))
                context.stroke(Path(roundedRect: shown.insetBy(dx: 0.5, dy: 0.5), cornerRadius: 3), with: .color(.white.opacity(0.5)), lineWidth: 1)
                context.fill(Path(CGRect(x: x(editor.seconds(editor.frame)) - 0.75, y: 0, width: 1.5, height: size.height)), with: .color(.white))
            }
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { value in
                editor.pause()
                editor.show(editor.frameIndex(at: Double(value.location.x / max(geometry.size.width, 1)) * editor.duration))
            })
        }
        .help("The whole clip. Click or drag to move through it.")
    }
}

/// The stretch of the clip being worked on: a ruler to scrub along, the laps, the stretch the
/// finished videos cover, and the song.
struct EditorTimeline: View {
    @ObservedObject var editor: Editor
    @State private var drag: Drag?
    /// Where the pointer last was over the timeline, to know what a right-click is on.
    @State private var pointer: CGPoint?

    enum Drag {
        case scrub, start, end
        /// An end of the music.
        case musicIn, musicOut
        /// How far into the song it was picked up.
        case song(Double)
        /// A double-click, which has done its work already.
        case spent
    }
    /// Whether the song has actually been slid since it was picked up. A click on it moves nothing.
    @State private var slid = false

    static let lapsTop: CGFloat = 26, lapsHeight: CGFloat = 30
    static let videoTop: CGFloat = 60, videoHeight: CGFloat = 18
    static let musicTop: CGFloat = 82, musicHeight: CGFloat = 42
    static let height: CGFloat = 124

    var body: some View {
        GeometryReader { geometry in
            let _ = Probe.note("timeline", geometry.frame(in: .global))
            Canvas { context, size in draw(in: &context, size: size) }
                .contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 0)
                    .onChanged { dragged($0, width: geometry.size.width) }
                    .onEnded { _ in
                        switch drag {
                        case .song: if slid { editor.songMoved() }
                        case .musicIn, .musicOut: editor.songMoved()
                        default: break
                        }
                        drag = nil
                        slid = false
                    })
                .onContinuousHover { phase in
                    // Over an end that can be dragged, the pointer says so, the way it does in Premiere.
                    switch phase {
                    case .active(let point):
                        pointer = point
                        (end(under: point, width: geometry.size.width) == nil ? NSCursor.arrow : NSCursor.resizeLeftRight).set()
                    case .ended:
                        NSCursor.arrow.set()
                    }
                }
                .contextMenu {
                    if let pointer, pointer.y >= Self.musicTop, let song = editor.songSpan {
                        // Over the music: marks in the song, and where the music comes in and stops.
                        let width = geometry.size.width
                        let time = editor.visible.lowerBound + Double(pointer.x / max(width, 1)) * (editor.visible.upperBound - editor.visible.lowerBound)
                        if let mark = songMark(under: pointer.x, width: width) {
                            Button("Line This Mark Up with the Playhead") { editor.lineUp(songMark: mark, with: editor.seconds(editor.frame)) }
                            Button("Put This Mark on the Start Gate") { editor.put(songTime: mark) }.disabled(editor.markers.isEmpty)
                            Button("Delete This Music Mark") { editor.removeSongMark(mark) }
                            Divider()
                        } else if let drop = drop(under: pointer.x, width: width) {
                            Button("Put This Drop on the Start Gate") { editor.put(songTime: drop) }.disabled(editor.markers.isEmpty)
                            Button("Line This Drop Up with the Playhead") { editor.lineUp(songMark: drop, with: editor.seconds(editor.frame)) }
                            Divider()
                        }
                        Button("Mark the Music Here") { editor.addSongMark(at: time) }.disabled(!song.contains(time))
                        Button("Delete All Music Marks") { editor.removeAllSongMarks() }.disabled(editor.songMarks.isEmpty)
                        Button("Open the Song's Sound Wave") { editor.openSoundWave(at: song.contains(time) ? time - song.lowerBound : nil) }
                        Divider()
                        Button("Bring the Music In Here") { editor.setMusicIn(at: time) }
                        Button("Stop the Music Here") { editor.setMusicOut(at: time) }
                        Button("Play the Music for the Whole Video") { editor.wholeMusic() }
                            .disabled(editor.edit.musicIn == nil && editor.edit.musicOut == nil)
                    } else {
                    if let marker = marker(under: pointer?.x, width: geometry.size.width) {
                        Button("Go to This Marker") {
                            editor.pause()
                            editor.show(marker)
                        }
                        Button("Delete This Marker") { editor.removeMarker(marker) }
                        Divider()
                    }
                    Button("Add a Marker at the Playhead") { editor.addMarker() }
                    Button("Delete All Markers") { editor.removeAllMarkers() }.disabled(editor.markers.isEmpty)
                    }
                }
        }
        .frame(height: Self.height)
    }

    /// The marker within a few points of a place along the timeline, if there is one.
    private func marker(under place: CGFloat?, width: CGFloat) -> Int? {
        guard let place else { return nil }
        let from = editor.visible.lowerBound, span = max(editor.visible.upperBound - from, 0.001)
        func x(_ marker: Int) -> CGFloat { CGFloat((editor.seconds(marker) - from) / span) * width }
        guard let nearest = editor.markers.min(by: { abs(x($0) - place) < abs(x($1) - place) }), abs(x(nearest) - place) <= 10 else { return nil }
        return nearest
    }

    /// The end that can be dragged at a point: of the stretch the video covers, or of the music.
    private func end(under point: CGPoint, width: CGFloat) -> Drag? {
        let from = editor.visible.lowerBound, span = max(editor.visible.upperBound - from, 0.001)
        func x(_ seconds: Double) -> CGFloat { CGFloat((seconds - from) / span) * width }
        if point.y >= Self.musicTop, let heard = editor.musicHeard {
            let toStart = abs(point.x - x(heard.lowerBound)), toEnd = abs(point.x - x(heard.upperBound))
            if min(toStart, toEnd) <= 7 { return toStart <= toEnd ? .musicIn : .musicOut }
        } else if point.y >= Self.videoTop, point.y < Self.musicTop, let stretch = editor.stretch {
            if abs(point.x - x(stretch.lowerBound)) <= 8 { return .start }
            if abs(point.x - x(stretch.upperBound)) <= 8 { return .end }
        }
        return nil
    }

    /// The mark in the song within a few points of a place along the timeline, if there is one.
    private func songMark(under place: CGFloat, width: CGFloat) -> Double? {
        guard let song = editor.songSpan else { return nil }
        let from = editor.visible.lowerBound, span = max(editor.visible.upperBound - from, 0.001)
        func x(_ mark: Double) -> CGFloat { CGFloat((song.lowerBound + mark - from) / span) * width }
        guard let nearest = editor.songMarks.min(by: { abs(x($0) - place) < abs(x($1) - place) }), abs(x(nearest) - place) <= 8 else { return nil }
        return nearest
    }

    /// The drop the lap timer heard within a few points of a place along the timeline, if there is one.
    private func drop(under place: CGFloat, width: CGFloat) -> Double? {
        guard let song = editor.songSpan else { return nil }
        let from = editor.visible.lowerBound, span = max(editor.visible.upperBound - from, 0.001)
        func x(_ time: Double) -> CGFloat { CGFloat((song.lowerBound + time - from) / span) * width }
        guard let nearest = editor.spots.map(\.time).min(by: { abs(x($0) - place) < abs(x($1) - place) }), abs(x(nearest) - place) <= 8 else { return nil }
        return nearest
    }

    private func dragged(_ value: DragGesture.Value, width: CGFloat) {
        let from = editor.visible.lowerBound, span = editor.visible.upperBound - from
        func seconds(_ x: CGFloat) -> Double { from + Double(x / max(width, 1)) * span }
        func x(_ seconds: Double) -> CGFloat { CGFloat((seconds - from) / span) * width }
        if drag == nil {
            let start = value.startLocation
            drag = .scrub
            slid = false
            if start.y >= Self.musicTop, let song = editor.songSpan, song.contains(seconds(start.x)), clickIsDouble() {
                // A double-click on the song opens its sound wave at that moment.
                editor.openSoundWave(at: seconds(start.x) - song.lowerBound)
                drag = .spent
            } else if let grabbed = end(under: start, width: width) {
                // An end of the video's stretch or of the music: this trims it.
                editor.pause()
                editor.remember()
                drag = grabbed
            } else if start.y >= Self.musicTop, let song = editor.songSpan, song.contains(seconds(start.x)) {
                // The body of the song: this slides it, once it is actually moved.
                drag = .song(seconds(start.x) - song.lowerBound)
            }
            if case .scrub = drag { editor.pause() }
        }
        let now = seconds(value.location.x)
        switch drag {
        case .scrub: editor.show(editor.frameIndex(at: min(max(now, from), editor.visible.upperBound)), follow: false)
        case .start: editor.dragVideoStart(to: now)
        case .end: editor.dragVideoEnd(to: now)
        case .musicIn: editor.dragMusicIn(to: now)
        case .musicOut: editor.dragMusicOut(to: now)
        case .song(let grabbed):
            if !slid {
                guard abs(value.translation.width) >= 2 else { break }
                editor.pause()
                editor.remember()
                slid = true
            }
            var place = ((now - grabbed) * 1000).rounded() / 1000
            // A mark in the song, or one of its drops, catches on a lap marker or on the start of the video as it passes.
            var reach = 7 / Double(max(width, 1)) * span
            let targets = editor.markers.map(editor.seconds) + (editor.stretch.map { [$0.lowerBound] } ?? [])
            for mark in editor.songMarks + editor.spots.map(\.time) {
                for target in targets where abs(target - (now - grabbed + mark)) < reach {
                    reach = abs(target - (now - grabbed + mark))
                    place = ((target - mark) * 1000).rounded() / 1000
                }
            }
            editor.edit.songStart = place
        case .spent, nil: break
        }
    }

    private func draw(in context: inout GraphicsContext, size: CGSize) {
        let from = editor.visible.lowerBound, to = editor.visible.upperBound, span = max(to - from, 0.001)
        func x(_ seconds: Double) -> CGFloat { CGFloat((seconds - from) / span) * size.width }
        func lane(_ top: CGFloat, _ height: CGFloat) -> CGRect { CGRect(x: 0, y: top, width: size.width, height: height) }
        func words(_ text: String, size: CGFloat, weight: Font.Weight = .heavy, _ color: Color) -> Text {
            Text(text).font(.system(size: size, weight: weight).monospacedDigit()).foregroundColor(color)
        }
        for rect in [lane(Self.lapsTop, Self.lapsHeight), lane(Self.videoTop, Self.videoHeight), lane(Self.musicTop, Self.musicHeight)] {
            context.fill(Path(roundedRect: rect, cornerRadius: 6), with: .color(.white.opacity(0.045)))
        }

        // Ruler: a tick every so often, down to single frames when zoomed right in.
        let steps: [Double] = [1 / editor.fps, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]
        let step = steps.first { $0 / span * Double(size.width) >= 66 } ?? 600
        let frameWidth = CGFloat(1 / editor.fps / span) * size.width
        if frameWidth >= 5 {
            var index = Int((from * editor.fps).rounded(.up))
            while editor.seconds(index) <= to {
                context.fill(Path(CGRect(x: x(editor.seconds(index)), y: 17, width: 1, height: 5)), with: .color(.white.opacity(0.14)))
                index += 1
            }
        }
        var tick = (from / step).rounded(.up) * step
        while tick <= to {
            let whole = Int(tick + 0.0005)
            let label = step < 1 ? EditorFormat.clock(tick) : String(format: "%d:%02d", whole / 60, whole % 60)
            context.fill(Path(CGRect(x: x(tick), y: 12, width: 1, height: 10)), with: .color(Theme.faint))
            context.draw(words(label, size: 9, weight: .semibold, Theme.faint), at: CGPoint(x: x(tick) + 4, y: 8), anchor: .leading)
            tick += step
        }

        // The stretch the finished videos cover, with an end to drag on each side.
        if let stretch = editor.stretch {
            let rect = CGRect(x: x(stretch.lowerBound), y: Self.videoTop, width: x(stretch.upperBound) - x(stretch.lowerBound), height: Self.videoHeight)
            context.fill(Path(roundedRect: rect, cornerRadius: 5), with: .color(.white.opacity(0.2)))
            for edge in [rect.minX, rect.maxX - 4] {
                context.fill(Path(roundedRect: CGRect(x: edge, y: rect.minY, width: 4, height: rect.height), cornerRadius: 2), with: .color(.white.opacity(0.85)))
            }
            if rect.width > 150 {
                context.draw(words("IN THE VIDEO  \(EditorFormat.span(stretch.upperBound - stretch.lowerBound))", size: 9, .white.opacity(0.8)), at: CGPoint(x: max(rect.minX, 0) + 10, y: rect.midY), anchor: .leading)
            }
            // What falls outside it is left out of the video: dim it in the music lane.
            for outside in [CGRect(x: 0, y: Self.musicTop, width: max(0, rect.minX), height: Self.musicHeight),
                            CGRect(x: rect.maxX, y: Self.musicTop, width: max(0, size.width - rect.maxX), height: Self.musicHeight)] {
                context.fill(Path(outside), with: .color(Theme.card.opacity(0.55)))
            }
        }

        // Laps between the markers.
        let markers = editor.markers, times = editor.laps, best = editor.best
        for index in times.indices {
            let start = x(editor.seconds(markers[index])), end = x(editor.seconds(markers[index + 1]))
            let inBest = best.map { index >= $0.first && index < $0.first + editor.window } ?? false
            let rect = CGRect(x: start + 1, y: Self.lapsTop + 2, width: max(1, end - start - 2), height: Self.lapsHeight - 4)
            context.fill(Path(roundedRect: rect, cornerRadius: 5), with: .color(inBest ? Theme.accent.opacity(0.9) : .white.opacity(0.17)))
            let color = inBest ? Theme.onAccent : Color.white
            if rect.width > 96 {
                context.draw(words("LAP \(index + 1)   \(EditorFormat.lap(times[index]))", size: 11, color), at: CGPoint(x: rect.midX, y: rect.midY), anchor: .center)
            } else if rect.width > 44 {
                context.draw(words(EditorFormat.lap(times[index]), size: 10, color), at: CGPoint(x: rect.midX, y: rect.midY), anchor: .center)
            }
        }

        // The song, with its loudness drawn in so a drop or a beat can be lined up with a gate.
        if let song = editor.songSpan {
            let rect = CGRect(x: x(song.lowerBound), y: Self.musicTop + 2, width: x(song.upperBound) - x(song.lowerBound), height: Self.musicHeight - 4)
            context.fill(Path(roundedRect: rect, cornerRadius: 5), with: .color(Theme.accent.opacity(0.13)))
            context.stroke(Path(roundedRect: rect.insetBy(dx: 0.5, dy: 0.5), cornerRadius: 5), with: .color(Theme.accent.opacity(0.45)), lineWidth: 1)
            if !editor.wave.isEmpty {
                // Its highest points faintly, how loud it is over them, and the bass inside that: a
                // drop is where the bass comes in.
                var tops = Path(), body = Path(), bass = Path()
                var column = max(rect.minX, 0).rounded(.down)
                let last = min(rect.maxX, size.width)
                let each = span / Double(size.width)
                while column < last {
                    let start = from + Double(column) * each - song.lowerBound
                    if let levels = editor.wave.levels(from: start, to: start + each) {
                        for (height, path) in [(levels.peak, 0), (levels.body, 1), (levels.bass, 2)] {
                            let tall = max(1, CGFloat(height) * (rect.height - 8))
                            let bar = CGRect(x: column, y: rect.midY - tall / 2, width: 1, height: tall)
                            if path == 0 { tops.addRect(bar) } else if path == 1 { body.addRect(bar) } else { bass.addRect(bar) }
                        }
                    }
                    column += 1
                }
                context.fill(tops, with: .color(Theme.accent.opacity(0.28)))
                context.fill(body, with: .color(Theme.accent.opacity(0.85)))
                context.fill(bass, with: .color(Theme.bass))
            }
            // Where the music is heard: dimmed outside, with an end to drag on each side.
            if let heard = editor.musicHeard {
                for silent in [CGRect(x: rect.minX, y: Self.musicTop, width: max(0, x(heard.lowerBound) - rect.minX), height: Self.musicHeight),
                               CGRect(x: x(heard.upperBound), y: Self.musicTop, width: max(0, rect.maxX - x(heard.upperBound)), height: Self.musicHeight)]
                where editor.edit.musicIn != nil || editor.edit.musicOut != nil {
                    context.fill(Path(silent), with: .color(Theme.card.opacity(0.6)))
                }
                for edge in [x(heard.lowerBound), x(heard.upperBound) - 3] {
                    context.fill(Path(roundedRect: CGRect(x: edge, y: Self.musicTop + 2, width: 3, height: Self.musicHeight - 4), cornerRadius: 1.5), with: .color(.white.opacity(0.85)))
                }
            }
            // The beat, once the timeline is zoomed in far enough to tell the beats apart.
            if let first = editor.analysis?.firstBeat, let length = editor.analysis?.beatLength, CGFloat(length / span) * size.width >= 12 {
                var index = max(0, Int(((from - song.lowerBound - first) / length).rounded(.up)))
                while song.lowerBound + first + Double(index) * length <= min(to, song.upperBound) {
                    let place = x(song.lowerBound + first + Double(index) * length)
                    context.fill(Path(CGRect(x: place - 0.5, y: Self.musicTop + Self.musicHeight - 8, width: 1, height: 6)), with: .color(.white.opacity(0.35)))
                    index += 1
                }
            }
            // The drops the lap timer heard: a dotted line with an arrowhead at the foot, in the
            // drops' own colour. Each sits on a dark line, so it shows over the wave.
            for spot in editor.spots {
                let place = x(song.lowerBound + spot.time)
                guard place >= -6, place <= size.width + 6 else { continue }
                context.fill(Path(CGRect(x: place - 1.5, y: Self.musicTop + 2, width: 3, height: Self.musicHeight - 4)), with: .color(.black.opacity(0.45)))
                var line = Path()
                line.move(to: CGPoint(x: place, y: Self.musicTop + 2))
                line.addLine(to: CGPoint(x: place, y: Self.musicTop + Self.musicHeight - 2))
                context.stroke(line, with: .color(Theme.drop), style: StrokeStyle(lineWidth: 1.5, dash: [3, 3]))
                var arrow = Path()
                arrow.move(to: CGPoint(x: place, y: Self.musicTop + Self.musicHeight - 9))
                arrow.addLine(to: CGPoint(x: place + 5, y: Self.musicTop + Self.musicHeight - 1))
                arrow.addLine(to: CGPoint(x: place - 5, y: Self.musicTop + Self.musicHeight - 1))
                arrow.closeSubpath()
                context.stroke(arrow, with: .color(.black.opacity(0.5)), lineWidth: 2)
                context.fill(arrow, with: .color(Theme.drop))
            }
            // The pilot's own marks in the song: a solid line with a diamond at its head, in the marks' colour.
            for mark in editor.songMarks {
                let place = x(song.lowerBound + mark)
                context.fill(Path(CGRect(x: place - 1.75, y: Self.musicTop, width: 3.5, height: Self.musicHeight)), with: .color(.black.opacity(0.45)))
                context.fill(Path(CGRect(x: place - 0.75, y: Self.musicTop, width: 1.5, height: Self.musicHeight)), with: .color(Theme.mark))
                var diamond = Path()
                diamond.move(to: CGPoint(x: place, y: Self.musicTop - 1))
                diamond.addLine(to: CGPoint(x: place + 5, y: Self.musicTop + 4))
                diamond.addLine(to: CGPoint(x: place, y: Self.musicTop + 9))
                diamond.addLine(to: CGPoint(x: place - 5, y: Self.musicTop + 4))
                diamond.closeSubpath()
                context.stroke(diamond, with: .color(.black.opacity(0.5)), lineWidth: 2)
                context.fill(diamond, with: .color(Theme.mark))
            }
        } else {
            let note = editor.edit.song == nil && editor.premiereMusic != nil ? "\(editor.premiereMusic ?? ""): lined up from Premiere when a video is made" : "No music"
            context.draw(words(note, size: 10, weight: .semibold, Theme.faint), at: CGPoint(x: size.width / 2, y: Self.musicTop + Self.musicHeight / 2), anchor: .center)
        }

        // Markers run down through every lane, so the song can be lined up against them.
        for (index, marker) in markers.enumerated() {
            let position = x(editor.seconds(marker))
            context.fill(Path(CGRect(x: position - 1, y: 12, width: 2, height: Self.lapsTop + Self.lapsHeight - 12)), with: .color(Theme.accent))
            context.fill(Path(CGRect(x: position - 0.5, y: Self.videoTop, width: 1, height: size.height - Self.videoTop)), with: .color(Theme.accent.opacity(0.4)))
            var flag = Path()
            flag.move(to: CGPoint(x: position - 1, y: 12))
            flag.addLine(to: CGPoint(x: position + 8, y: 16))
            flag.addLine(to: CGPoint(x: position - 1, y: 20))
            flag.closeSubpath()
            context.fill(flag, with: .color(Theme.accent))
            if index == 0, markers.count == 1 {
                context.draw(words("LAP 1 STARTS", size: 9, Theme.accent), at: CGPoint(x: position + 8, y: Self.lapsTop + Self.lapsHeight / 2), anchor: .leading)
            }
        }

        // Playhead.
        let now = x(editor.seconds(editor.frame))
        context.fill(Path(CGRect(x: now - 0.75, y: 0, width: 1.5, height: size.height)), with: .color(.white))
        var head = Path()
        head.move(to: CGPoint(x: now - 5, y: 0))
        head.addLine(to: CGPoint(x: now + 5, y: 0))
        head.addLine(to: CGPoint(x: now, y: 7))
        head.closeSubpath()
        context.fill(head, with: .color(.white))
    }
}

/// Where the parts of the marker editor that take clicks and drags are in the window. Only
/// --check-clicks reads it: that check works the editor with clicks of its own.
@MainActor
enum Probe {
    static var frames: [String: CGRect] = [:]
    /// When each was last noted. Something noted before the page last changed is no longer on show.
    static var noted: [String: Date] = [:]
    static func note(_ name: String, _ frame: CGRect) {
        frames[name] = frame
        noted[name] = Date()
    }
}

extension View {
    /// Notes where this is in the window, under a name, for --check-clicks to press it.
    func probe(_ name: String) -> some View {
        background(GeometryReader { geometry in
            let _ = Probe.note(name, geometry.frame(in: .global))
            Color.clear
        })
    }
}

/// True when the click being handled is the second of a double-click.
@MainActor
func clickIsDouble() -> Bool {
    guard let event = NSApp.currentEvent, [.leftMouseDown, .leftMouseUp, .leftMouseDragged].contains(event.type) else { return false }
    return event.clickCount >= 2
}

/// Where the sound wave is in its window, measured down from the top, so the scroll wheel and a pinch
/// can tell whether the pointer is over it and act around the moment under it.
final class WaveFrame {
    var frame = CGRect.zero
}

/// The sound wave window: the chosen song by itself, big enough to see where a drum lands, to mark
/// it by eye and to pick the moment that goes on the start gate.
struct SoundWaveView: View {
    @ObservedObject var editor: Editor
    @ObservedObject var wave: SoundWave
    @State private var monitor: Any?
    @State private var place = WaveFrame()

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            SoundWaveOverview(editor: editor, wave: wave).frame(height: 24)
            SoundWaveCanvas(editor: editor, wave: wave, place: place)
            controls
            Text("Space play  ·  click or drag to move along  ·  double-click to mark  ·  drag a mark to move it  ·  M mark  ·  ⌫ remove  ·  ← → one frame  ·  ⌘← ⌘→ nudge a mark  ·  ↑ ↓ marks and drops  ·  scroll to move along  ·  pinch or ⌥-scroll to zoom  ·  Esc close")
                .font(.system(size: 11, weight: .medium)).foregroundStyle(Theme.faint).lineLimit(1).minimumScaleFactor(0.7)
        }
        .padding(16)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Color.white.opacity(0.16)))
        .shadow(color: .black.opacity(0.6), radius: 30, y: 12)
        .onAppear(perform: watchScrolling)
        .onDisappear {
            if let monitor { NSEvent.removeMonitor(monitor) }
            monitor = nil
        }
    }

    /// Two fingers or the wheel move along the song, and a pinch, or the wheel with Option held, zooms
    /// around the pointer.
    private func watchScrolling() {
        guard monitor == nil else { return }
        let wave = wave, place = place
        monitor = NSEvent.addLocalMonitorForEvents(matching: [.scrollWheel, .magnify]) { event in
            // Only with the pointer over the wave itself. An event that names no window gives its place on the screen.
            guard let window = event.window ?? NSApp.windows.first(where: \.isVisible), let content = window.contentView else { return event }
            let inWindow = event.window == nil ? window.convertPoint(fromScreen: event.locationInWindow) : event.locationInWindow
            let pointer = CGPoint(x: inWindow.x, y: content.bounds.height - inWindow.y)
            let frame = place.frame
            guard frame.contains(pointer) else { return event }
            let span = wave.visible.upperBound - wave.visible.lowerBound
            let under = wave.visible.lowerBound + Double((pointer.x - frame.minX) / max(frame.width, 1)) * span
            if event.type == .magnify {
                wave.zoom(by: 1 / max(0.2, 1 + Double(event.magnification)), around: under)
                return nil
            }
            var across = Double(event.scrollingDeltaX), down = Double(event.scrollingDeltaY)
            // A mouse wheel counts in clicks, a trackpad in points: a click is worth a good many points.
            if !event.hasPreciseScrollingDeltas {
                across *= 30
                down *= 30
            }
            let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            if flags.contains(.option) || flags.contains(.command) {
                wave.zoom(by: exp(-down * 0.005), around: under)
            } else {
                let along = abs(across) >= abs(down) ? across : down
                wave.pan(by: -along / Double(max(frame.width, 1)) * span)
            }
            return nil
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 10) {
            Text("SOUND WAVE").label()
            Text(editor.edit.song ?? "").font(.system(size: 15, weight: .heavy)).lineLimit(1)
            if editor.listening {
                Text("Listening for the tempo and the drops…").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.dim)
            } else if let heard = editor.analysis, let tempo = heard.tempoLabel {
                Text(heard.beatLength == nil ? "About \(tempo)" : tempo).font(.system(size: 12, weight: .heavy).monospacedDigit()).foregroundStyle(Theme.dim)
            }
            Spacer(minLength: 8)
            if !editor.spots.isEmpty {
                Text("DROPS").label()
                ForEach(editor.spots, id: \.time) { spot in
                    Button(EditorFormat.songClock(spot.time)) {
                        wave.pause()
                        wave.go(to: spot.time)
                    }
                    .buttonStyle(SecondaryButton()).help("Go to this drop")
                }
            }
            Button("Done") { editor.closeSoundWave() }.buttonStyle(PrimaryButton()).help("Back to the timeline (Esc)")
        }
    }

    /// Says in words where the playhead's moment plays against the start gate, as the song lies now.
    private var placement: String {
        guard let lies = editor.songSpan?.lowerBound else { return "" }
        if let gate = editor.gate(under: wave.now) { return gate == 0 ? "This moment is on the start gate." : "This moment is on the gate that ends lap \(gate)." }
        guard let first = editor.markers.first else { return "Mark the start gate on the clip, and a moment of the song can be put on it." }
        let lead = lies + wave.now - editor.seconds(first)
        return "As the song lies now, this plays \(String(format: "%.2f s", abs(lead))) \(lead < 0 ? "before" : "after") the start gate."
    }

    private var controls: some View {
        let onMark = editor.songMark(at: wave.now) != nil && !wave.playing
        return HStack(spacing: 7) {
            VStack(alignment: .leading, spacing: 1) {
                Text(EditorFormat.clock(wave.now)).font(.system(size: 20, weight: .black).monospacedDigit())
                Text("INTO THE SONG").font(.system(size: 10, weight: .heavy)).tracking(1.1).foregroundStyle(Theme.faint)
            }
            .frame(width: 128, alignment: .leading)
            Button { wave.togglePlay() } label: { Image(systemName: wave.playing ? "pause.fill" : "play.fill").frame(width: 22, height: 14) }
                .buttonStyle(PrimaryButton()).help("Play the song from here, or pause (Space)").accessibilityLabel(wave.playing ? "Pause the song" : "Play the song")
            if onMark {
                Button("Remove mark") { editor.removeSongMarkAtWavePlayhead() }.buttonStyle(SecondaryButton()).help("Remove the mark here (⌫)")
            } else {
                Button { editor.markSongAtWavePlayhead() } label: {
                    HStack(spacing: 7) {
                        Text("Mark here")
                        Text("M").font(.system(size: 11, weight: .black)).padding(.horizontal, 5).padding(.vertical, 1)
                            .background(Color.white.opacity(0.14), in: RoundedRectangle(cornerRadius: 4, style: .continuous))
                    }
                }
                .buttonStyle(SecondaryButton()).help("Mark the song here (M). While it plays, press M in time with it.")
            }
            Button("Put this on the start gate") { editor.put(songTime: wave.now) }.buttonStyle(SecondaryButton())
                .disabled(editor.markers.isEmpty || wave.playing || editor.gate(under: wave.now) == 0)
                .help("Slide the song so this moment lands as you cross the start gate")
            Text(placement).font(.system(size: 11)).foregroundStyle(editor.gate(under: wave.now) == nil ? Theme.dim : Theme.good).lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            Toggle("Catch on the beat", isOn: $editor.snapToBeat).toggleStyle(.checkbox).font(.system(size: 12))
                .disabled(editor.analysis?.beatLength == nil)
                .help("The playhead and the marks catch on the nearest beat. They always catch on a drop.")
            Button("Whole song") { wave.showAll() }.buttonStyle(SecondaryButton())
            Button { wave.zoom(by: 2) } label: { Image(systemName: "minus.magnifyingglass") }.buttonStyle(SecondaryButton()).help("Zoom out").accessibilityLabel("Zoom out of the song")
            Button { wave.zoom(by: 0.5) } label: { Image(systemName: "plus.magnifyingglass") }.buttonStyle(SecondaryButton()).help("Zoom in").accessibilityLabel("Zoom in on the song")
        }
    }
}

/// The whole song in one thin bar: its shape, its drops and marks, what the wave below is showing, and the playhead.
struct SoundWaveOverview: View {
    @ObservedObject var editor: Editor
    @ObservedObject var wave: SoundWave

    var body: some View {
        GeometryReader { geometry in
            let _ = Probe.note("overview", geometry.frame(in: .global))
            Canvas { context, size in
                let total = max(wave.length, 0.001)
                func x(_ seconds: Double) -> CGFloat { CGFloat(seconds / total) * size.width }
                context.fill(Path(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: 4), with: .color(.white.opacity(0.07)))
                var shape = Path(), bass = Path()
                let each = total / Double(max(size.width, 1))
                var column: CGFloat = 0
                while column < size.width {
                    let start = Double(column) * each
                    if let levels = editor.wave.levels(from: start, to: start + each) {
                        let tall = max(1, CGFloat(levels.body) * (size.height - 4)), low = max(1, CGFloat(levels.bass) * (size.height - 4))
                        shape.addRect(CGRect(x: column, y: (size.height - tall) / 2, width: 1, height: tall))
                        bass.addRect(CGRect(x: column, y: (size.height - low) / 2, width: 1, height: low))
                    }
                    column += 1
                }
                context.fill(shape, with: .color(Theme.accent.opacity(0.6)))
                context.fill(bass, with: .color(Theme.bass.opacity(0.8)))
                for spot in editor.spots {
                    context.fill(Path(CGRect(x: x(spot.time) - 0.75, y: 0, width: 1.5, height: size.height)), with: .color(Theme.drop))
                }
                for mark in editor.songMarks {
                    context.fill(Path(CGRect(x: x(mark) - 0.75, y: 0, width: 1.5, height: size.height)), with: .color(Theme.mark))
                }
                let shown = CGRect(x: x(wave.visible.lowerBound), y: 0, width: max(3, x(wave.visible.upperBound) - x(wave.visible.lowerBound)), height: size.height)
                context.fill(Path(roundedRect: shown, cornerRadius: 3), with: .color(.white.opacity(0.12)))
                context.stroke(Path(roundedRect: shown.insetBy(dx: 0.5, dy: 0.5), cornerRadius: 3), with: .color(.white.opacity(0.5)), lineWidth: 1)
                context.fill(Path(CGRect(x: x(wave.now) - 0.75, y: 0, width: 1.5, height: size.height)), with: .color(.white))
            }
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { value in
                wave.pause()
                wave.go(to: Double(value.location.x / max(geometry.size.width, 1)) * wave.length)
            })
        }
        .help("The whole song. Click or drag to move through it.")
    }
}

/// The song's wave itself, with a ruler, the beat, the drops, the gates as the song lies now, the
/// marks and the playhead.
struct SoundWaveCanvas: View {
    @ObservedObject var editor: Editor
    @ObservedObject var wave: SoundWave
    let place: WaveFrame
    @State private var drag: Drag?
    /// Whether the mark picked up has actually been moved. A click on one moves nothing.
    @State private var moved = false
    /// Where the pointer last was over the wave, to know what a right-click is on.
    @State private var pointer: CGPoint?

    enum Drag {
        case scrub
        /// A mark, as it stands now.
        case mark(Double)
        /// A double-click, which has done its work already.
        case spent
    }

    static let waveTop: CGFloat = 26, footHeight: CGFloat = 20, height: CGFloat = 240

    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            let _ = Probe.note("wave", geometry.frame(in: .global))
            let _ = (place.frame = geometry.frame(in: .global))
            Canvas { context, size in draw(in: &context, size: size) }
                .contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 0)
                    .onChanged { dragged($0, width: width) }
                    .onEnded { _ in
                        drag = nil
                        moved = false
                    })
                .onContinuousHover { phase in
                    if case .active(let point) = phase { pointer = point }
                }
                .contextMenu {
                    let near = reach(6, width: width)
                    let place = pointer.map { time(at: $0.x, width: width) } ?? wave.now
                    if let pointer, let mark = mark(under: pointer.x, width: width) {
                        Button("Put This Mark on the Start Gate") { editor.put(songTime: mark) }.disabled(editor.markers.isEmpty)
                        Button("Delete This Mark") { editor.removeSongMark(mark) }
                        Divider()
                    } else {
                        Button("Mark the Song Here") { editor.addSongMark(inSong: editor.caught(place, within: near)) }
                        Button("Put This Moment on the Start Gate") { editor.put(songTime: editor.caught(place, within: near)) }.disabled(editor.markers.isEmpty)
                        Divider()
                    }
                    Button("Delete All Marks") { editor.removeAllSongMarks() }.disabled(editor.songMarks.isEmpty)
                }
        }
        .frame(height: Self.height)
    }

    private func time(at x: CGFloat, width: CGFloat) -> Double {
        wave.visible.lowerBound + Double(x / max(width, 1)) * (wave.visible.upperBound - wave.visible.lowerBound)
    }

    /// So many points across, as seconds of the song.
    private func reach(_ points: CGFloat, width: CGFloat) -> Double {
        Double(points / max(width, 1)) * (wave.visible.upperBound - wave.visible.lowerBound)
    }

    /// The mark within a few points of a place across the wave, if there is one.
    private func mark(under x: CGFloat, width: CGFloat) -> Double? {
        let place = time(at: x, width: width)
        guard let nearest = editor.songMarks.min(by: { abs($0 - place) < abs($1 - place) }), abs(nearest - place) <= reach(7, width: width) else { return nil }
        return nearest
    }

    private func dragged(_ value: DragGesture.Value, width: CGFloat) {
        let here = time(at: value.location.x, width: width), near = reach(6, width: width)
        if drag == nil {
            let start = value.startLocation
            moved = false
            wave.pause()
            if let mark = mark(under: start.x, width: width) {
                // On a mark: the playhead goes to it, and dragging from here moves it.
                drag = .mark(mark)
                wave.go(to: mark, follow: false)
            } else if clickIsDouble() {
                // A double-click marks the song there.
                if let mark = editor.addSongMark(inSong: editor.caught(time(at: start.x, width: width), within: near)) { wave.go(to: mark, follow: false) }
                drag = .spent
            } else {
                drag = .scrub
            }
        }
        switch drag {
        case .scrub: wave.go(to: editor.caught(here, within: near), follow: false)
        case .mark(let mark):
            if !moved {
                guard abs(value.translation.width) >= 2 else { break }
                editor.remember()
                moved = true
            }
            let now = editor.dragSongMark(mark, to: editor.caught(here, within: near, except: mark))
            drag = .mark(now)
            wave.go(to: now, follow: false)
        case .spent, nil: break
        }
    }

    private func draw(in context: inout GraphicsContext, size: CGSize) {
        let from = wave.visible.lowerBound, to = wave.visible.upperBound, span = max(to - from, 0.001)
        func x(_ seconds: Double) -> CGFloat { CGFloat((seconds - from) / span) * size.width }
        func words(_ text: String, size: CGFloat, weight: Font.Weight = .heavy, _ color: Color) -> Text {
            Text(text).font(.system(size: size, weight: weight).monospacedDigit()).foregroundColor(color)
        }
        let top = Self.waveTop, bottom = size.height - Self.footHeight
        let middle = (top + bottom) / 2, tall = (bottom - top) / 2 - 5
        let field = CGRect(x: 0, y: top, width: size.width, height: bottom - top)
        context.fill(Path(roundedRect: field, cornerRadius: 8), with: .color(.white.opacity(0.045)))
        /// Words over the wave, on a dark patch so they read whatever is behind them. `trailing` hangs
        /// them left of the point. They are drawn last, over the lines, so they are kept until then.
        var tags: [(parts: [(String, Color)], point: CGPoint, trailing: Bool)] = []
        func tag(_ parts: [(String, Color)], at point: CGPoint, trailing: Bool = false) { tags.append((parts, point, trailing)) }
        func draw(_ parts: [(String, Color)], at point: CGPoint, trailing: Bool) {
            let labels = parts.map { context.resolve(words($0.0, size: 9, $0.1)) }
            let sizes = labels.map { $0.measure(in: CGSize(width: 300, height: 30)) }
            let wide = sizes.reduce(0) { $0 + $1.width } + CGFloat(max(0, parts.count - 1)) * 8
            var place = trailing ? point.x - wide : point.x
            context.fill(Path(roundedRect: CGRect(x: place - 4, y: point.y - 7.5, width: wide + 8, height: 15), cornerRadius: 4), with: .color(Theme.card.opacity(0.85)))
            for (label, size) in zip(labels, sizes) {
                context.draw(label, at: CGPoint(x: place, y: point.y), anchor: .leading)
                place += size.width + 8
            }
        }

        // The part of the song that is heard in the finished video, as the song lies now: a bar along the foot.
        let lies = editor.songSpan?.lowerBound
        if let lies, let heard = editor.musicHeard {
            let rect = CGRect(x: x(heard.lowerBound - lies), y: bottom - 4, width: x(heard.upperBound - lies) - x(heard.lowerBound - lies), height: 4).intersection(field)
            if !rect.isNull, rect.width > 0 {
                context.fill(Path(rect), with: .color(.white.opacity(0.75)))
            }
        }

        // Ruler, in time into the song.
        let steps: [Double] = [0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60]
        let step = steps.first { $0 / span * Double(size.width) >= 74 } ?? 120
        var tick = (from / step).rounded(.up) * step
        while tick <= to {
            let whole = Int(tick + 0.0005)
            let label = step < 1 ? EditorFormat.songClock(tick) : String(format: "%d:%02d", whole / 60, whole % 60)
            context.fill(Path(CGRect(x: x(tick), y: 12, width: 1, height: 10)), with: .color(Theme.faint))
            context.draw(words(label, size: 9, weight: .semibold, Theme.faint), at: CGPoint(x: x(tick) + 4, y: 8), anchor: .leading)
            tick += step
        }

        // The beat, once the view is close enough to tell the beats apart.
        var beats = Path()
        if let first = editor.analysis?.firstBeat, let length = editor.analysis?.beatLength, CGFloat(length / span) * size.width >= 5 {
            var index = max(0, Int(((from - first) / length).rounded(.up)))
            while first + Double(index) * length <= to {
                beats.addRect(CGRect(x: x(first + Double(index) * length) - 0.5, y: top, width: 1, height: bottom - top))
                index += 1
            }
            context.fill(beats, with: .color(.white.opacity(0.16)))
        }

        // The wave: at each point across, the highest the sound gets faintly, how loud it is over
        // that, and its bass inside. A drop is where the bass comes in.
        if editor.wave.isEmpty {
            context.draw(words("Drawing the sound wave…", size: 11, weight: .semibold, Theme.faint), at: CGPoint(x: size.width / 2, y: middle), anchor: .center)
        } else {
            var tops = Path(), body = Path(), bass = Path()
            let each = span / Double(max(size.width, 1))
            var column: CGFloat = 0
            while column < size.width {
                let start = from + Double(column) * each
                if let levels = editor.wave.levels(from: start, to: start + each) {
                    func bar(_ level: Float) -> CGRect {
                        let reach = max(0.5, CGFloat(level) * tall)
                        return CGRect(x: column, y: middle - reach, width: 1, height: reach * 2)
                    }
                    tops.addRect(bar(levels.peak))
                    body.addRect(bar(levels.body))
                    bass.addRect(bar(levels.bass))
                }
                column += 1
            }
            context.fill(tops, with: .color(Theme.accent.opacity(0.28)))
            context.fill(body, with: .color(Theme.accent.opacity(0.9)))
            context.fill(bass, with: .color(Theme.bass))
            // The beat again, dark this time, so it shows over the wave as well as beside it.
            context.fill(beats, with: .color(.black.opacity(0.4)))
            // Which colour is which.
            tag([("PEAKS", Theme.accent.opacity(0.55)), ("LOUDNESS", Theme.accent), ("BASS", Theme.bass), ("DROPS", Theme.drop), ("YOUR MARKS", Theme.mark)],
                at: CGPoint(x: size.width - 10, y: top + 12), trailing: true)
        }
        if let lies, let heard = editor.musicHeard {
            let start = x(heard.lowerBound - lies), end = x(heard.upperBound - lies)
            if end - max(start, 0) > 96, start < size.width - 96 { tag([("IN THE VIDEO", .white.opacity(0.9))], at: CGPoint(x: max(start, 0) + 8, y: bottom - 15)) }
        }

        // The drops the lap timer heard.
        for spot in editor.spots {
            let place = x(spot.time)
            guard place >= -90, place <= size.width + 4 else { continue }
            context.fill(Path(CGRect(x: place - 1.5, y: top, width: 3, height: bottom - top)), with: .color(.black.opacity(0.45)))
            var line = Path()
            line.move(to: CGPoint(x: place, y: top))
            line.addLine(to: CGPoint(x: place, y: bottom))
            context.stroke(line, with: .color(Theme.drop), style: StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
            tag([(spot.strength >= 0.995 ? "BIGGEST DROP" : "DROP", Theme.drop)], at: CGPoint(x: place + 8, y: top + 12))
        }

        // The gates, where they fall in the song as it lies now.
        if let lies {
            for (index, marker) in editor.markers.enumerated() {
                let place = x(editor.seconds(marker) - lies)
                guard place >= -60, place <= size.width + 4 else { continue }
                context.fill(Path(CGRect(x: place - 1, y: top, width: 2, height: bottom - top + 6)), with: .color(Theme.good))
                context.draw(words(index == 0 ? "START" : "LAP \(index)", size: 9, Theme.good), at: CGPoint(x: place + 5, y: bottom + 11), anchor: .leading)
            }
        }

        // Marks.
        for mark in editor.songMarks {
            let place = x(mark)
            guard place >= -8, place <= size.width + 8 else { continue }
            context.fill(Path(CGRect(x: place - 1.75, y: top - 5, width: 3.5, height: bottom - top + 5)), with: .color(.black.opacity(0.45)))
            context.fill(Path(CGRect(x: place - 0.75, y: top - 5, width: 1.5, height: bottom - top + 5)), with: .color(Theme.mark))
            var diamond = Path()
            diamond.move(to: CGPoint(x: place, y: top - 11))
            diamond.addLine(to: CGPoint(x: place + 6, y: top - 5))
            diamond.addLine(to: CGPoint(x: place, y: top + 1))
            diamond.addLine(to: CGPoint(x: place - 6, y: top - 5))
            diamond.closeSubpath()
            context.stroke(diamond, with: .color(.black.opacity(0.5)), lineWidth: 2)
            context.fill(diamond, with: .color(Theme.mark))
        }

        for one in tags { draw(one.parts, at: one.point, trailing: one.trailing) }

        // Playhead.
        let now = x(wave.now)
        context.fill(Path(CGRect(x: now - 0.75, y: 0, width: 1.5, height: bottom)), with: .color(.white))
        var head = Path()
        head.move(to: CGPoint(x: now - 5, y: 0))
        head.addLine(to: CGPoint(x: now + 5, y: 0))
        head.addLine(to: CGPoint(x: now, y: 7))
        head.closeSubpath()
        context.fill(head, with: .color(.white))
    }
}

// MARK: - Leaderboard and settings

struct LeaderboardView: View {
    @EnvironmentObject var model: Model

    var body: some View {
        ScrollView {
        VStack(alignment: .leading, spacing: 22) {
            BackLink()
            Text("LEADERBOARD").font(.system(size: 40, weight: .black)).tracking(0.5)
            VStack(alignment: .leading, spacing: 12) {
                Text("YOUR TIMES").label()
                ForEach(model.tracks, id: \.self) { track in
                    // Each event's name, above the first of its tracks.
                    if let event = model.events.first(where: { $0.tracks.first == track }) {
                        let title = model.details(ofEvent: event.folder).name
                        Text(title.isEmpty ? "Tracks" : title).font(.system(size: 12, weight: .heavy)).foregroundStyle(Theme.accent)
                            .padding(.top, event.id == model.events.first?.id ? 0 : 8)
                    }
                    HStack {
                        Text(Model.trackName(track)).font(.system(size: 15, weight: .heavy))
                        Spacer()
                        if let sent = model.state(track).submissions.last {
                            Text("submitted \(sent.time)").font(.system(size: 13, weight: .bold).monospacedDigit()).foregroundStyle(Theme.good)
                        }
                        Text(model.summaries[track]?.best?.best?.seconds ?? "–")
                            .font(.system(size: 20, weight: .black).monospacedDigit()).foregroundStyle(Theme.accent)
                            .frame(width: 110, alignment: .trailing)
                    }
                    .padding(.vertical, 4)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Text("SEASON STANDINGS").label()
                    ComingSoonBadge()
                }
                Text("The whole season's standings will show here, next to your own times.")
                    .font(.system(size: 13)).foregroundStyle(Theme.dim)
                Button("Open racegow.com/leaderboards") {
                    if let url = URL(string: "https://www.racegow.com/leaderboards") { NSWorkspace.shared.open(url) }
                }
                .buttonStyle(SecondaryButton()).padding(.top, 4)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()
        }
        .padding(.horizontal, 34).padding(.top, 40).padding(.bottom, 90)
        .frame(maxWidth: Layout.page, alignment: .leading)
        .frame(maxWidth: .infinity)
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject var model: Model
    /// The timer as the lap timer draws it, and a frame of footage to show it over.
    @State private var timer: NSImage?
    @State private var footage: NSImage?
    private let corners = [("tl", "Top left"), ("tr", "Top right"), ("bl", "Bottom left"), ("br", "Bottom right")]

    @ViewBuilder private var updateStatus: some View {
        switch model.update {
        case .idle: EmptyView()
        case .checking: Text("Checking…").foregroundStyle(Theme.dim)
        case .current: Label("This is the newest version", systemImage: "checkmark.circle.fill").foregroundStyle(Theme.good)
        case .available(let release): Text("v\(release.version) is ready to install").foregroundStyle(Theme.accent)
        case .installing(let release): Text("Installing v\(release.version). The app will reopen.").foregroundStyle(Theme.accent)
        case .failed(let problem): Text(problem).foregroundStyle(Theme.warn)
        }
    }

    /// What the timer preview is drawn from. When any of it changes, the preview is drawn again.
    private struct PreviewSource: Equatable {
        var settings: TimerSettings
        var event: Model.EventDetails
        var track: String
        var laps: [String]
        var clip = ""
        /// A moment in the middle of the first lap, to take a frame of footage from.
        var moment = 1.0
        /// The run the laps are borrowed from, or empty when they are made up.
        var run = ""
    }

    /// The fastest run on the first track that has one lends the preview its laps and a frame.
    private var previewSource: PreviewSource {
        for track in model.tracks {
            guard let run = model.summaries[track]?.runs.first else { continue }
            let crossings = run.crossings ?? []
            return PreviewSource(settings: model.settings, event: model.details(ofEvent: Model.eventFolder(of: track)), track: track,
                                 laps: Array(run.laps.prefix(8)), clip: run.clip,
                                 moment: crossings.count > 1 ? (crossings[0] + crossings[1]) / 2 : 1, run: run.name)
        }
        // With no run to borrow from, the first track there is, or the one the first event will get.
        let track = model.tracks.first ?? (model.events.first.map { $0.folder.isEmpty ? "" : $0.folder + "/" } ?? "") + "Track 1"
        return PreviewSource(settings: model.settings, event: model.details(ofEvent: Model.eventFolder(of: track)), track: track,
                             laps: ["12.345", "11.876", "12.012"])
    }

    private var timerPreview: some View {
        let source = previewSource
        return VStack(alignment: .leading, spacing: 8) {
            ZStack {
                if let footage {
                    Image(nsImage: footage).resizable().aspectRatio(contentMode: .fit)
                } else {
                    LinearGradient(colors: [Color(white: 0.24), Color(white: 0.09)], startPoint: .top, endPoint: .bottom)
                    Text("YOUR VIDEO").label()
                }
                if let timer { Image(nsImage: timer).resizable().aspectRatio(contentMode: .fit) }
                // Clicking a corner of the picture moves the timer there.
                VStack(spacing: 0) {
                    ForEach([["tl", "tr"], ["bl", "br"]], id: \.self) { row in
                        HStack(spacing: 0) {
                            ForEach(row, id: \.self) { corner in
                                Color.clear.contentShape(Rectangle()).onTapGesture { model.settings.corner = corner }
                            }
                        }
                    }
                }
            }
            .aspectRatio(16.0 / 9, contentMode: .fit)
            .frame(maxWidth: 640)
            .background(Color.black)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.stroke))
            .help("Click a corner to put the timer there.")
            Text("How the timer sits on a 16:9 video, " + (source.run.isEmpty ? "with made-up laps" : "with the laps from \(source.run)")
                 + ". On a 9:16 video it goes under the picture instead, so the corner doesn't apply there.")
                .font(.system(size: 12)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
        }
        // Wait for typing to pause before asking the lap timer to draw it again.
        .task(id: source) {
            try? await Task.sleep(nanoseconds: 120_000_000)
            guard !Task.isCancelled else { return }
            let drawn = await model.timerPreview(laps: source.laps, track: source.track)
            if !Task.isCancelled { timer = drawn }
        }
        .task(id: source.clip) {
            footage = source.clip.isEmpty ? nil : await Model.footageFrame(of: source.clip, at: source.moment)
        }
    }

    private var busyUpdating: Bool {
        switch model.update {
        case .checking, .installing: return true
        default: return false
        }
    }

    var body: some View {
        ScrollView {
        VStack(alignment: .leading, spacing: 22) {
            BackLink()
            Text("PILOT & SETTINGS").font(.system(size: 40, weight: .black)).tracking(0.5)
            VStack(alignment: .leading, spacing: 16) {
                Text("PILOT").label()
                HStack(spacing: 14) {
                    AnswerField(title: "Pilot name", required: false, text: $model.settings.pilot)
                    AnswerField(title: "Email for submission forms", required: false, text: $model.store.email)
                }
                HStack(spacing: 12) {
                    Text("Your name goes on every timer and finished video, and into the entry forms.")
                        .font(.system(size: 12)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
                    Spacer()
                    Button("Ask me the setup questions") { model.note = .setUp }.buttonStyle(SecondaryButton())
                        .help("Your pilot name, and whether you fly \(PilotList.season). If you do, your registration number is looked up on the series' pilot list.")
                }
            }
            .card()
            VStack(alignment: .leading, spacing: 18) {
                Text("EVENTS").label()
                ForEach(model.events) { event in EventFields(event: event) }
                Text("An event is a race or a series: a folder in your library with its tracks inside. Its name goes on the timer of every track in it, next to the track's name, and your ID for it goes beside your name and into its entry forms. New event in the Video Creator makes another.")
                    .font(.system(size: 12)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
            }
            .card()
            VStack(alignment: .leading, spacing: 12) {
                Text("TIMER CORNER").label()
                HStack(spacing: 8) {
                    ForEach(corners, id: \.0) { corner in
                        if model.settings.corner == corner.0 {
                            Button(corner.1) {}.buttonStyle(PrimaryButton())
                        } else {
                            Button(corner.1) { model.settings.corner = corner.0 }.buttonStyle(SecondaryButton())
                        }
                    }
                }
                timerPreview
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()
            VStack(alignment: .leading, spacing: 8) {
                Text("LIBRARY").label()
                Text(model.root.path).font(.system(size: 12, design: .monospaced)).foregroundStyle(Theme.dim).textSelection(.enabled)
                Text(model.libraryIsFixed ? "This copy of the app keeps its tracks in the folder it sits in."
                                          : "Your tracks, markers, music and finished videos are kept here.")
                    .font(.system(size: 12)).foregroundStyle(Theme.dim)
                HStack(spacing: 8) {
                    Button("Show in Finder") { NSWorkspace.shared.open(model.root) }.buttonStyle(SecondaryButton())
                    if !model.libraryIsFixed {
                        Button("Use another folder…") { model.chooseLibrary() }.buttonStyle(SecondaryButton())
                            .disabled(model.job != nil)
                            .help("Keep your tracks somewhere else. Nothing is moved for you.")
                    }
                }
                if !model.toolFound {
                    Label("The lap timer that belongs inside this app is missing. Download the app again.", systemImage: "exclamationmark.triangle.fill")
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.warn)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()
            VStack(alignment: .leading, spacing: 10) {
                Text("VERSION").label()
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text("FPV Hangar v\(AppVersion.current)").font(.system(size: 15, weight: .heavy))
                    updateStatus.font(.system(size: 12, weight: .semibold)).fixedSize(horizontal: false, vertical: true)
                }
                if case .available(let release) = model.update, let notes = release.notes, !notes.isEmpty {
                    Text(notes).font(.system(size: 12)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
                }
                if AppVersion.isTestCopy {
                    Text("This is a test copy, for trying changes before they are released. It doesn't check for updates or replace itself: the released app gets them the usual way.")
                        .font(.system(size: 12)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
                } else {
                    HStack(spacing: 10) {
                        if case .available(let release) = model.update {
                            Button("Update to v\(release.version)") { model.installUpdate() }.buttonStyle(PrimaryButton())
                        }
                        Button("Check for updates") { model.checkForUpdates() }.buttonStyle(SecondaryButton()).disabled(busyUpdating)
                        Toggle("Check when the app opens", isOn: $model.automaticUpdates).toggleStyle(.checkbox).font(.system(size: 12))
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()
        }
        .padding(.horizontal, 34).padding(.top, 40).padding(.bottom, 90)
        .frame(maxWidth: Layout.page, alignment: .leading)
        .frame(maxWidth: .infinity)
        }
    }
}

/// The note that opens over the window. As the welcome it is the read-me: what the app is, how to
/// start, and what isn't built yet. As "What's new" it is the changelog since the version last run.
/// Both can be opened again from How it works.
struct NoteSheet: View {
    @EnvironmentObject var model: Model
    let note: LaunchNote

    /// True when this copy can't update itself where it is: macOS is running it from a quarantined
    /// copy, or it was opened straight out of the folder it was downloaded to.
    private var misplaced: Bool {
        let path = Bundle.main.bundlePath
        guard !model.libraryIsFixed, path.hasSuffix(".app") else { return false }
        return !path.hasPrefix("/Applications/") && !path.hasPrefix(NSHomeDirectory() + "/Applications/")
    }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
                Text(note == .welcome ? "WELCOME TO" : "WHAT'S NEW IN").label()
                HStack(spacing: 0) {
                    Text("FPV").foregroundStyle(.white)
                    Text("HANGAR").foregroundStyle(Theme.accent)
                }
                .font(.system(size: 34, weight: .black)).tracking(1)
                Text(note == .welcome ? ReadMe.summary : "You are on version \(AppVersion.current).")
                    .font(.system(size: 14)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true).padding(.top, 2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(24)
            Divider().overlay(Theme.stroke)

            ScrollView {
                if case .whatsNew(let since) = note {
                    changes(after: since)
                } else {
                VStack(alignment: .leading, spacing: 24) {
                    if misplaced {
                        Label("FPV Hangar isn't in your Applications folder. Quit it, drag it there and open it again, so it can update itself.", systemImage: "exclamationmark.triangle.fill")
                            .font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.warn).fixedSize(horizontal: false, vertical: true)
                    }
                    ForEach(ReadMe.sections.filter { !$0.fileOnly }) { section in
                        VStack(alignment: .leading, spacing: 10) {
                            HStack(spacing: 8) {
                                Text(section.title.uppercased()).label()
                                if section.title == ReadMe.comingSoon { ComingSoonBadge() }
                            }
                            if section.title == ReadMe.files {
                                library
                            } else {
                                ForEach(Array(rows(of: section).enumerated()), id: \.offset) { _, row in row }
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(24)
                }
            }

            Divider().overlay(Theme.stroke)
            HStack {
                Text("FPV Hangar v\(AppVersion.current)  ·  This note stays under How it works.")
                    .font(.system(size: 12)).foregroundStyle(Theme.faint)
                Spacer()
                Button(note == .welcome ? "Get started" : "Got it") { model.closeNote() }.buttonStyle(PrimaryButton()).keyboardShortcut(.defaultAction)
            }
            .padding(18)
        }
        .frame(width: 720, height: note == .welcome ? 740 : 560)
        .background(Theme.background)
        .preferredColorScheme(.dark)
    }

    /// The changelog's entries after a version, newest first.
    private func changes(after version: String?) -> some View {
        let entries = ChangeLog.entries(after: version)
        return VStack(alignment: .leading, spacing: 26) {
            if entries.isEmpty {
                Text("Nothing is written down for this version.").font(.system(size: 13)).foregroundStyle(Theme.dim)
            }
            ForEach(entries) { entry in
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text("v\(entry.version)").font(.system(size: 18, weight: .black)).foregroundStyle(entry.version == AppVersion.current ? Theme.accent : .white)
                        Text(entry.date.uppercased()).label()
                    }
                    ForEach(Array(entry.lines.enumerated()), id: \.offset) { _, line in
                        if line.hasPrefix("- ") {
                            HStack(alignment: .top, spacing: 9) {
                                Circle().fill(Theme.accent).frame(width: 5, height: 5).padding(.top, 6)
                                // The changelog is written in Markdown, so `code` and **bold** come through.
                                Text(.init(String(line.dropFirst(2)))).font(.system(size: 13)).foregroundStyle(.white.opacity(0.88)).fixedSize(horizontal: false, vertical: true)
                            }
                        } else {
                            Text(.init(line)).font(.system(size: 13)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(24)
    }

    /// Where this copy keeps things, which is not always where the read-me's file says.
    private var library: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(model.libraryIsFixed ? "In the folder this copy of the app sits in:" : "In this folder. Pilot & settings lets you use a different one.")
                .font(.system(size: 13)).foregroundStyle(Theme.dim)
            Text(model.root.path).font(.system(size: 12, design: .monospaced)).foregroundStyle(.white.opacity(0.85)).textSelection(.enabled)
            Button("Show in Finder") { NSWorkspace.shared.open(model.root) }.buttonStyle(SecondaryButton())
        }
    }

    /// A section's steps, points and paragraphs as views. Lines meant for the file are left out.
    private func rows(of section: ReadMe.Section) -> [AnyView] {
        var number = 0
        return section.items.compactMap { item -> AnyView? in
            switch item {
            case .paragraph(let text):
                return AnyView(Text(text).font(.system(size: 13)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true))
            case .step(let text):
                number += 1
                return AnyView(HStack(alignment: .top, spacing: 12) {
                    Text("\(number)").font(.system(size: 13, weight: .black).monospacedDigit()).foregroundStyle(Theme.onAccent)
                        .frame(width: 24, height: 24).background(Theme.accent, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                    Text(text).font(.system(size: 13)).foregroundStyle(.white.opacity(0.88)).fixedSize(horizontal: false, vertical: true).padding(.top, 3)
                })
            case .point(let text):
                return AnyView(HStack(alignment: .top, spacing: 9) {
                    Circle().fill(Theme.accent).frame(width: 5, height: 5).padding(.top, 6)
                    Text(text).font(.system(size: 13)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
                })
            case .lines:
                return nil
            }
        }
    }
}

/// One event's details in Pilot & settings: the name its timers show and the pilot's ID for it.
struct EventFields: View {
    @EnvironmentObject var model: Model
    let event: Model.Event

    private func field(_ part: WritableKeyPath<Model.EventDetails, String>) -> Binding<String> {
        Binding(get: { model.details(ofEvent: event.folder)[keyPath: part] }, set: { value in
            var details = model.details(ofEvent: event.folder)
            details[keyPath: part] = value
            model.setDetails(details, ofEvent: event.folder)
        })
    }

    var body: some View {
        let name = model.details(ofEvent: event.folder).name
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(event.folder.isEmpty ? (name.isEmpty ? "Tracks" : name) : event.folder).font(.system(size: 15, weight: .heavy))
                Text(event.tracks.isEmpty ? "no tracks yet" : "\(event.tracks.count) track\(event.tracks.count == 1 ? "" : "s")")
                    .font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.faint)
                Spacer()
                if event.folder.isEmpty {
                    Button("Give it its own folder") {
                        if let problem = model.gatherLooseTracks() { model.notice = problem }
                    }
                    .buttonStyle(SecondaryButton())
                    .help("These tracks sit loose in your library, from before there were events. This moves them into a folder named after the event, like any other. If their clips are in a Premiere project, Premiere will ask where they went.")
                }
                if !event.folder.isEmpty {
                    Button { model.askToDelete(event: event.folder) } label: { Image(systemName: "trash") }
                        .buttonStyle(SecondaryButton()).disabled(model.job != nil || !event.tracks.isEmpty).accessibilityLabel("Move this event to the Trash")
                        .help(event.tracks.isEmpty ? "Move this event to the Trash." : "An event can only be deleted once its tracks are. Delete those first.")
                }
            }
            HStack(spacing: 14) {
                AnswerField(title: "Name on the timer", required: false, text: field(\.name)).frame(width: 260)
                AnswerField(title: "Your ID number", required: false, text: field(\.id)).frame(width: 150)
                AnswerField(title: "Shown before the ID", required: false, text: field(\.idLabel)).frame(width: 200)
            }
            if !event.folder.isEmpty { logo }
        }
    }

    /// The event's logo, for its 9:16 videos: the picture when there is one, and the way to choose it.
    private var logo: some View {
        let file = model.logo(ofEvent: event.folder)
        return HStack(spacing: 12) {
            if let file, let picture = NSImage(contentsOf: file) {
                Image(nsImage: picture).resizable().interpolation(.high).scaledToFit().frame(maxWidth: 110, maxHeight: 46)
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                Text("This logo goes on this event's videos: at the head of the timer box on 16:9, and at the top beside your name on 9:16.")
                    .font(.system(size: 12)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                Button("Change…") { model.chooseLogo(forEvent: event.folder) }.buttonStyle(SecondaryButton())
                Button { model.removeLogo(ofEvent: event.folder) } label: { Image(systemName: "trash") }
                    .buttonStyle(SecondaryButton()).help("Move the logo to the Trash. The videos go back to having none.").accessibilityLabel("Remove the logo")
            } else {
                Text("LOGO").label()
                Text("None. Choose a picture, such as the series' own logo, and it goes on this event's videos: at the head of the timer box on 16:9, and at the top beside your name on 9:16.")
                    .font(.system(size: 12)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                Button("Choose a picture…") { model.chooseLogo(forEvent: event.folder) }.buttonStyle(SecondaryButton())
            }
        }
        .padding(.top, 2)
    }
}

/// A short walk through the whole job, from a raw clip to a submitted time.
struct GuideView: View {
    @EnvironmentObject var model: Model
    private let steps: [(String, String)] = [
        ("Set up the track",
         "On the first screen, open Video Creator, under RaceGOW. Its tracks are listed down the side, grouped by event. Press New track under an event, or New event for another race or series. Press Add clips on the track's page and choose your recordings, or drop them onto the page. Then paste the track's Google Form link into Submission form on the track page."),
        ("Mark the laps",
         "Press Mark laps on a clip. A recording you add by itself opens there straight away. Play or drag to just before a start/finish gate crossing, step to the exact frame with the arrow keys, and press M. The first marker starts lap 1; each later one ends a lap. The lap timer shows over the picture as the 16:9 video will have it, and changes with every marker; the timer button beside the playback speed hides it. To fix one, go to it with the up and down arrows and move it a frame at a time with ⌘← and ⌘→. Right-click a marker, in the list or on the timeline, to delete it or all of them. The marker keys are Premiere's: M, ⇧M and ⇧⌘M for the next and previous, ⌥M to clear one and ⌥⌘M to clear all, and they are in the Markers menu too. Press Done, which saves it, and the run appears on the track page, ranked by its best 3 laps in a row. Discard changes leaves without keeping them, and ⌘S saves while you carry on."),
        ("Choose what the video shows",
         "A finished video runs from 3 seconds before lap 1 to 8 seconds after the finish. To change that, open Markers & music on the run and drag the ends of the Video bar, or press I and O on the frames where it should start and end."),
        ("Add music, if you want it",
         "In Markers & music, pick one of your songs or add one. A song you add is kept in your song library, for every clip on every track, and the marks you put in it stay with it. The app listens to it and lists its drops, the moments it suddenly gets bigger: press On the start gate beside one and the song slides so the drop lands as you cross the gate, then press Space to hear it with the picture. The song lies under the laps with its loudness in yellow and its bass in red, and you can drag it yourself: a drop, or a point you marked with B, catches on a lap marker. The drops the app found are blue and your own marks are pink. Double-click the song to open its sound wave, where it is big enough to mark by eye, plays by itself, and any moment can be put on the start gate. Drag the white ends of the song, or use Music in and Music out, to choose where the music starts and stops."),
        ("Make the videos",
         "Make 16:9 video is for YouTube. Make 9:16 video is for Shorts, TikTok and Reels. Both carry the timer, your name and ID, the event and track, and the music. The 9:16 timer is built around your best 3 laps in a row: one big time for the three together, those laps under it, and the others smaller. An event's logo, chosen in Pilot & settings, goes on its videos: at the head of the timer box on 16:9, and at the top beside your name on 9:16. When a video is made the app asks whether to watch it."),
        ("Check them",
         "Click a run to see its files and open any of them in VLC. If there are two versions of something, press Keep only this one on the right one and the other goes to the Trash. A clip you haven't marked has a Trash button of its own on the track page."),
        ("Submit",
         "Upload the 16:9 video to YouTube, then press Submit this run. Paste the link, type your email the first time, since the form asks for one, and look over the answers: the app fills in your handle, number and time, and for the questions it can't know it shows what you answered last time, one line each, with Change beside it. Press Fill in the form, check the Google Form, and press Submit at the bottom of it yourself. The track page then shows what you sent."),
    ]
    private let notes = [
        "Lap times are only as exact as the markers: one frame, which is about 0.017 seconds at 60 frames a second. A run shows a warning when its markers aren't on exact frames.",
        "A song's tempo and drops are worked out from the song file itself, on your Mac, the first time you pick it. The tempo can read as double or half what you would call it. A song whose beat wanders, as a band playing without a click does, gets no beat lines, though its drops are still found. A drop is a guess at what will hit hardest: listen before you trust it.",
        "Premiere still works for all of this. Export a sequence's markers as CSV into the track's csv markers folder, named after the clip, and its sound as an MP3 into the music folder, also named after the clip. Place those markers while the clip still starts at the very beginning of its sequence.",
        "Saving markers here for a run that had a Premiere export moves that export to the Trash, so the run isn't timed twice.",
        "Some clips say 50 frames a second in their header but record 60. That only matters for markers from Premiere, and the track page asks which one the sequence uses. Markers placed here are always in the clip's real time.",
        "Add clips copies your recordings into the track's Raw files folder and leaves the originals where they were. Putting files in that folder yourself works too.",
        "Everything lives in the track's folder: Raw files, csv markers and music go in; landscape and vertical are what gets made. The tracks sit in your library folder, which Pilot & settings shows and can change.",
        "New versions are picked up from Pilot & settings, where Check for updates downloads and installs one in place.",
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                BackLink().padding(.bottom, 8)
                HStack(alignment: .firstTextBaseline) {
                    Text("HOW IT WORKS").font(.system(size: 40, weight: .black)).tracking(0.5)
                    Spacer()
                    Button("What's new") { model.note = .whatsNew(since: nil) }.buttonStyle(SecondaryButton())
                        .help("What changed in each version.")
                    Button("Welcome note") { model.note = .welcome }.buttonStyle(SecondaryButton())
                        .help("The note that opens the first time the app is run.")
                }
                Text("The Video Creator, from a raw clip to a submitted time.").font(.system(size: 14)).foregroundStyle(Theme.dim).padding(.bottom, 8)
                ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                    HStack(alignment: .top, spacing: 16) {
                        Text("\(index + 1)")
                            .font(.system(size: 17, weight: .black).monospacedDigit()).foregroundStyle(Theme.onAccent)
                            .frame(width: 34, height: 34)
                            .background(Theme.accent, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                        VStack(alignment: .leading, spacing: 5) {
                            Text(step.0).font(.system(size: 16, weight: .heavy))
                            Text(step.1).font(.system(size: 13)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .card(padding: 16)
                }
                VStack(alignment: .leading, spacing: 9) {
                    Text("GOOD TO KNOW").label()
                    ForEach(notes, id: \.self) { note in
                        HStack(alignment: .top, spacing: 9) {
                            Circle().fill(Theme.accent).frame(width: 5, height: 5).padding(.top, 6)
                            Text(note).font(.system(size: 13)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .card()
                .padding(.top, 8)
                VStack(alignment: .leading, spacing: 11) {
                    HStack(spacing: 8) {
                        Text("NOT BUILT YET").label()
                        ComingSoonBadge()
                    }
                    ForEach(ComingSoon.allCases, id: \.self) { item in
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: item.icon).font(.system(size: 14)).foregroundStyle(Theme.accent).frame(width: 22).padding(.top, 1)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(item.title).font(.system(size: 14, weight: .heavy))
                                Text(item.detail).font(.system(size: 13)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .card()
            }
            .padding(.horizontal, 34).padding(.top, 40).padding(.bottom, 90)
            .frame(maxWidth: Layout.page, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
    }
}

// MARK: - App

struct DashboardApp: App {
    @StateObject private var model = Model()

    var body: some Scene {
        WindowGroup("FPV Hangar") {
            RootView()
                .environmentObject(model)
                .frame(minWidth: 1080, minHeight: 700)
                .onAppear {
                    model.refresh()
                    model.checkForUpdatesIfDue()
                    model.greet()
                }
                .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in model.refresh() }
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1280, height: 840)
        .commands {
            // The keys are named in the titles and handled by the editor itself, not set as menu
            // shortcuts: a menu shortcut of a bare letter could get in the way of typing that letter.
            // With the song's sound wave open they act on the marks in the song.
            CommandMenu("Markers") {
                Button("Add Marker   (M)") { model.editor?.mark() }
                Button("Go to Next Marker   (⇧M or ↓)") { model.editor?.goToMark(1) }
                Button("Go to Previous Marker   (⇧⌘M or ↑)") { model.editor?.goToMark(-1) }
                Divider()
                Button("Clear Current Marker   (⌥M or ⌫)") { model.editor?.clearMark() }
                Button("Clear All Markers   (⌥⌘M)") { model.editor?.clearAllMarks() }
            }
        }
    }
}

@main
enum Main {
    static func main() {
        let arguments = CommandLine.arguments
        if arguments.contains("--read-me") {
            // The "Read Me First" file for the download. package.sh writes this next to the app.
            print(ReadMe.text(), terminator: "")
        } else if let index = arguments.firstIndex(of: "--snapshot"), index + 1 < arguments.count {
            MainActor.assumeIsolated { snapshot(to: arguments[index + 1], page: arguments.dropFirst(index + 2).first) }
        } else if arguments.contains("--check-form") {
            MainActor.assumeIsolated { checkForm() }
        } else if arguments.contains("--check-editor") {
            MainActor.assumeIsolated { checkEditor() }
        } else if arguments.contains("--check-clicks") {
            MainActor.assumeIsolated { checkClicks() }
        } else if let index = arguments.firstIndex(of: "--check-fresh") {
            MainActor.assumeIsolated { checkFresh(Array(arguments.dropFirst(index + 1))) }
        } else if let index = arguments.firstIndex(of: "--check-pilots") {
            MainActor.assumeIsolated { checkPilots(Array(arguments.dropFirst(index + 1))) }
        } else if arguments.contains("--check-season") {
            MainActor.assumeIsolated { checkSeason() }
        } else if arguments.contains("--check-launch") {
            MainActor.assumeIsolated { checkLaunch() }
        } else if let index = arguments.firstIndex(of: "--check-add-clips") {
            MainActor.assumeIsolated { checkAddClips(arguments.dropFirst(index + 1).filter { !$0.hasPrefix("--") }) }
        } else if arguments.contains("--check-delete") {
            MainActor.assumeIsolated { checkDelete() }
        } else if arguments.contains("--check-events") {
            MainActor.assumeIsolated { checkEvents() }
        } else if arguments.contains("--check-update") {
            MainActor.assumeIsolated { checkUpdate(install: arguments.contains("--install")) }
        } else {
            DashboardApp.main()
        }
    }

    /// Loads the first track's form in a hidden web view, fills it with placeholder answers, and prints
    /// what the form then holds. Nothing is sent. This is how to tell whether Google has changed its page.
    @MainActor
    static func checkForm() {
        final class Checker: NSObject, WKNavigationDelegate {
            let script: String
            /// The questions the app answers by itself: their ids, titles and what was put in.
            let expected: [(String, String, String)]
            init(script: String, expected: [(String, String, String)]) {
                self.script = script
                self.expected = expected
            }
            func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
                let read = "JSON.stringify(Object.fromEntries([...document.querySelectorAll('input[type=hidden][name^=\"entry.\"]')].filter(i => i.value).map(i => [i.name, i.value]).concat([['email', (document.querySelector('input[type=email]') || {}).value || '']])))"
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                    webView.evaluateJavaScript(self.script) { filled, _ in
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                            webView.evaluateJavaScript(read) { result, error in
                                let held = ((result as? String).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } as? [String: String]) ?? [:]
                                print("questions the page took an answer for: \(filled ?? "none")")
                                var wrong = 0
                                for (id, title, expected) in self.expected {
                                    let got = held["entry." + id] ?? ""
                                    if got != expected { wrong += 1 }
                                    print("  \(got == expected ? "ok   " : "WRONG") \(title.prefix(60)): \(got.isEmpty ? "(nothing)" : got)")
                                }
                                print("email on the form: \(held["email"] ?? "(nothing)")")
                                print(wrong == 0 ? "every answer the app fills in by itself reached the form. Nothing was sent." : "\(wrong) didn't reach the form. Nothing was sent.")
                                exit(wrong == 0 ? 0 : 1)
                            }
                        }
                    }
                }
            }
        }
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)
        let model = Model()
        guard let track = model.tracks.first(where: { !model.state($0).formURL.isEmpty }), let url = URL(string: model.state(track).formURL),
              let data = try? Data(contentsOf: url), let form = FormDefinition.parse(html: String(decoding: data, as: UTF8.self)) else {
            print("No track has a readable form link.")
            exit(1)
        }
        var answers: [String: [String]] = [:]
        var expected: [(String, String, String)] = []
        for question in form.questions {
            // The four the app fills in by itself get something shaped like the real thing.
            let samples: [FormQuestion.Role: String] = [.handle: "TEST PILOT", .number: "000", .time: "28.316", .link: "https://youtu.be/TEST1234567"]
            if let role = question.role, let sample = samples[role] {
                answers[question.id] = [sample]
                expected.append((question.id, "\(role): \(question.title)", sample))
                continue
            }
            switch question.kind {
            case .text, .paragraph: answers[question.id] = ["TEST"]
            case .choice, .checkboxes: answers[question.id] = question.options.first.map { [$0] } ?? []
            case .other: break
            }
        }
        print("\(form.title): \(form.questions.count) questions, \(answers.count) answerable here")
        if !expected.contains(where: { $0.1.hasPrefix("link") }) { print("This form has no question the app takes for the video's link.") }
        let checker = Checker(script: fillScript(answers: answers, email: "test@example.com"), expected: expected)
        let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 900, height: 1200))
        view.navigationDelegate = checker
        view.load(URLRequest(url: url))
        withExtendedLifetime(checker) { RunLoop.main.run(until: Date().addingTimeInterval(30)) }
        print("The form never finished loading.")
        exit(1)
    }

    /// Adds the files and folders named after it to the first track of the library given with --root,
    /// the way Add clips and a drop on the track page do, and prints what happened. It changes the
    /// library, so it is only for a throwaway copy.
    @MainActor
    static func checkAddClips(_ paths: [String]) {
        guard CommandLine.arguments.contains("--root") else {
            print("This changes the library it is run on. Point it at a copy with --root.")
            exit(1)
        }
        NSApplication.shared.setActivationPolicy(.prohibited)
        let model = Model()
        guard let track = model.tracks.first else {
            print("That library has no track to add to.")
            exit(1)
        }
        // --root and its folder are among the arguments: leave those out.
        let files = paths.filter { $0 != model.root.path }.map { URL(fileURLWithPath: $0) }
        model.addClips(files, to: track)
        var furthest = 0.0
        let limit = Date().addingTimeInterval(600)
        while model.job != nil, Date() < limit {
            furthest = max(furthest, model.job?.progress ?? 0)
            RunLoop.main.run(until: Date().addingTimeInterval(0.02))
        }
        RunLoop.main.run(until: Date().addingTimeInterval(0.3))
        print("progress reached \(Int(furthest * 100))%")
        print(model.notice ?? "(nothing was said)")
        print("clips in \(track): \((model.clips[track] ?? []).map { URL(fileURLWithPath: $0).lastPathComponent })")
        print("opened for marking: \(model.editor?.target.name ?? "nothing, which is right for more than one")")
        exit(0)
    }

    /// On the library given with --root, which it changes: goes through deleting the last event the
    /// way the rules allow (not while it has tracks, an empty track at once, a full one only with the
    /// phrase), then puts everything back from the Trash, printing each step. Only for a throwaway copy.
    @MainActor
    static func checkDelete() {
        guard CommandLine.arguments.contains("--root") else {
            print("This changes the library it is run on. Point it at a copy with --root.")
            exit(1)
        }
        NSApplication.shared.setActivationPolicy(.prohibited)
        let model = Model()
        guard let event = model.events.last(where: { !$0.folder.isEmpty }), !event.tracks.isEmpty else {
            print("That library needs an event with tracks in it.")
            exit(1)
        }
        func show(_ title: String) {
            print("\(title): events \(model.events.map { "\($0.folder) \($0.tracks.map(Model.trackName))" }), remembered tracks \(model.store.tracks.keys.sorted()), remembered events \((model.store.events ?? [:]).keys.sorted())")
        }
        show("at the start")
        model.askToDelete(event: event.folder)
        print("the event, while it has tracks: \(model.pendingRemoval == nil ? "refused" : "ASKED") — \(model.notice ?? "nothing said")")
        for track in event.tracks {
            model.notice = nil
            model.askToDelete(track: track)
            if let pending = model.pendingRemoval {
                print("\(Model.trackName(track)) has things in it, so it asks: \(pending.title) \(pending.detail)")
                print("  with nothing typed: \(model.confirmRemoval(typed: "") ? "DELETED" : "still there")")
                print("  with \"yes\" typed: \(model.confirmRemoval(typed: "yes") ? "DELETED" : "still there")")
                print("  with \"i understand\" typed: \(model.confirmRemoval(typed: " i understand ") ? "deleted" : "STILL THERE") — \(model.notice ?? "")")
            } else {
                print("\(Model.trackName(track)) is empty, so it went at once — \(model.notice ?? "nothing said")")
            }
        }
        show("after the tracks")
        model.notice = nil
        model.askToDelete(event: event.folder)
        print("the event, now empty: \(model.pendingRemoval == nil ? "went at once" : "asked") — \(model.notice ?? "nothing said")")
        show("after the event")
        // Put it all back: the event's folder first, then each track into it.
        let manager = FileManager.default
        var landed = model.trashed
        if let folder = landed.popLast() { try? manager.moveItem(at: folder, to: model.root.appendingPathComponent(event.folder)) }
        for (track, place) in zip(event.tracks, landed) { try? manager.moveItem(at: place, to: model.root.appendingPathComponent(track)) }
        model.refresh()
        show("after putting everything back")
        print("the event's details: \(model.details(ofEvent: event.folder)); form links: \(event.tracks.map { model.state($0).formURL })")
        exit(0)
    }

    /// Tries what can be done to events on the library given with --root, which it changes: makes an
    /// event, gives it details and a second track, and gathers any loose tracks into a folder. Prints
    /// what the library holds at each step. Only for a throwaway copy of a library.
    @MainActor
    static func checkEvents() {
        guard CommandLine.arguments.contains("--root") else {
            print("This changes the library it is run on. Point it at a copy with --root.")
            exit(1)
        }
        NSApplication.shared.setActivationPolicy(.prohibited)
        let model = Model()
        func show(_ title: String) {
            print(title)
            for event in model.events {
                let details = model.details(ofEvent: event.folder)
                print("  \(event.folder.isEmpty ? "(loose in the library)" : event.folder): on the timer \"\(details.name)\", \(details.idLabel) \"\(details.id)\", tracks \(event.tracks)")
            }
        }
        show("at the start")
        print("a name with a slash in it: \(model.newEvent(named: "a/b") ?? "accepted")")
        print("making Spring Cup: \(model.newEvent(named: " Spring Cup ") ?? "made")")
        print("the same name again: \(model.newEvent(named: "Spring Cup") ?? "made")")
        model.setDetails(Model.EventDetails(name: "Spring Cup 2026", id: "42", idLabel: "Pilot"), ofEvent: "Spring Cup")
        model.newTrack(in: "Spring Cup")
        show("after making Spring Cup and a second track in it")
        print("gathering the loose tracks: \(model.gatherLooseTracks() ?? "moved")")
        show("after gathering")
        print("remembered for: \(model.store.tracks.keys.sorted())")
        // Another copy of the app saving to the same library: this one should take what it saved, and not write over it.
        let file = model.root.appendingPathComponent("dashboard.json")
        if let track = model.tracks.first, var text = try? String(contentsOf: file, encoding: .utf8), let place = text.range(of: "\"formURL\" : \"") {
            text.insert(contentsOf: "https://example.com/saved-by-another-copy", at: place.upperBound)
            try? Data(text.utf8).write(to: file)
            model.refresh()
            let taken = model.state(track).formURL.contains("saved-by-another-copy") || model.store.tracks.values.contains { $0.formURL.contains("saved-by-another-copy") }
            let kept = (try? String(contentsOf: file, encoding: .utf8))?.contains("saved-by-another-copy") ?? false
            print("a change another copy saved: \(taken ? "taken up" : "NOT taken up"), and \(kept ? "still in the file" : "WRITTEN OVER")")
        }
        exit(0)
    }

    /// Prints what the update feed offers. With --install, puts a newer version in place of this copy
    /// without starting it.
    @MainActor
    static func checkUpdate(install: Bool) {
        NSApplication.shared.setActivationPolicy(.prohibited)
        final class Box: @unchecked Sendable { var result: Result<Release, Error>? }
        let box = Box()
        Task.detached {
            do { box.result = .success(try await Updates.latest()) } catch { box.result = .failure(error) }
        }
        let limit = Date().addingTimeInterval(30)
        while box.result == nil, Date() < limit { RunLoop.main.run(until: Date().addingTimeInterval(0.05)) }
        switch box.result {
        case .success(let release):
            let newer = AppVersion.isNewer(release.version, than: AppVersion.current)
            print("this copy: v\(AppVersion.current)\nnewest packaged: v\(release.version) (\(release.file))")
            print(newer ? "an update is available" : "this copy is up to date")
            if install, newer { print(Updates.install(release) ?? "installed v\(release.version) in place of this copy") }
            exit(0)
        case .failure(let error):
            print("couldn't read the update feed: \(error.localizedDescription)")
            exit(1)
        case nil:
            print("the update feed never answered")
            exit(1)
        }
    }

    /// A model with every track's runs already read, for the modes that show no window.
    @MainActor
    static func loadedModel() -> Model {
        let model = Model()
        for track in model.tracks {
            model.findClips(track)
            let markers = model.folder(track, "csv markers").path
            let rate = model.state(track).mismatchFPS
            let result = runTool(model.tool, ["--markers", markers, "--json"] + (rate.isEmpty ? [] : ["--mismatch-fps", rate]))
            model.summaries[track] = (try? JSONDecoder().decode(TrackSummary.self, from: Data(result.output.utf8))) ?? TrackSummary()
        }
        return model
    }

    /// Opens the fastest run of the first track in the marker editor, or the first clip when no run
    /// is timed yet, and waits until it is ready.
    @MainActor
    static func openEditor(in model: Model) -> Editor? {
        guard let track = model.tracks.first else { return nil }
        if let run = model.summaries[track]?.runs.first(where: { !$0.clip.isEmpty }) {
            model.edit(run, track: track)
        } else if let clip = model.clips[track]?.first {
            model.mark(clip: clip, track: track)
        }
        let limit = Date().addingTimeInterval(60)
        while model.editor?.phase == .loading, Date() < limit { RunLoop.main.run(until: Date().addingTimeInterval(0.05)) }
        return model.editor
    }

    /// Opens a clip in the marker editor without a window and checks that asking for a frame shows
    /// exactly that frame, by reading back which frame the player is holding. Then prints the laps
    /// and the marker file the editor would save, and tries the first song in the music folder.
    /// Nothing is written to the project.
    @MainActor
    static func checkEditor() {
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)
        let model = loadedModel()
        guard let editor = openEditor(in: model), editor.phase == .ready, let item = editor.player.currentItem else {
            if case .failed(let reason)? = model.editor?.phase { print(reason) } else { print("No clip could be opened.") }
            exit(1)
        }
        print("\(editor.target.name): \(editor.frameCount) frames at \(editor.fpsLabel) a second, \(EditorFormat.clock(editor.duration)) long")
        let output = AVPlayerItemVideoOutput(pixelBufferAttributes: nil)
        item.add(output)
        var wrong = 0
        func shown(after move: () -> Void) -> Int? {
            move()
            var found: Int?
            let limit = Date().addingTimeInterval(5)
            // The frame the player holds once the seek has landed. Earlier frames can still be on their way out.
            while Date() < limit {
                RunLoop.main.run(until: Date().addingTimeInterval(0.03))
                var display = CMTime.zero
                let now = item.currentTime()
                if output.hasNewPixelBuffer(forItemTime: now), output.copyPixelBuffer(forItemTime: now, itemTimeForDisplay: &display) != nil {
                    found = Int((display.seconds * editor.fps).rounded())
                }
                if editor.settled, found == editor.frame { break }
            }
            return found
        }
        let last = editor.frameCount - 1
        let targets = [0, 1, 2, 59, 60, 61, last / 2, last - 1, last] + editor.markers + editor.markers.map { $0 - 1 } + editor.markers.map { $0 + 1 }
        for target in targets.filter({ $0 >= 0 && $0 <= last }) {
            let got = shown { editor.show(target) }
            if got != target {
                wrong += 1
                print("  asked for frame \(target), showing \(got.map(String.init) ?? "nothing")")
            }
        }
        // Stepping one frame at a time, there and back.
        var position = editor.frame
        for direction in [1, 1, 1, -1, -1, -1, -1, 1] {
            position = min(max(position + direction, 0), last)
            let got = shown { editor.step(direction) }
            if got != position {
                wrong += 1
                print("  stepped to frame \(position), showing \(got.map(String.init) ?? "nothing")")
            }
        }
        print(wrong == 0 ? "frame seeking: every frame asked for was the frame shown" : "frame seeking: \(wrong) wrong")
        print("laps: \(editor.laps.map(EditorFormat.lap).joined(separator: "  "))   best \(editor.window): \(editor.best.map { EditorFormat.lap($0.total) } ?? "none")")
        print("marker file:\n\(editor.markerFile())", terminator: "")
        wrong += checkTimer(in: editor, model: model)
        // The marker keys, as the editor receives them.
        func press(_ modifiers: NSEvent.ModifierFlags = []) {
            if let event = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: modifiers, timestamp: 0, windowNumber: 0, context: nil,
                                            characters: "m", charactersIgnoringModifiers: modifiers.contains(.shift) ? "M" : "m", isARepeat: false, keyCode: 46) {
                _ = editor.handle(event)
            }
        }
        let before = editor.markers
        _ = shown { editor.show(30) }
        press()
        let added = editor.markers.contains(30)
        press([.shift])
        let next = editor.frame == (before.first { $0 > 30 } ?? 30)
        press([.command, .shift])
        let previous = editor.frame == 30
        press([.option])
        let cleared = !editor.markers.contains(30)
        press([.option, .command])
        let none = editor.markers.isEmpty
        editor.undo()
        let back = editor.markers == before
        let keys = [("M adds", added), ("⇧M goes to the next", next), ("⇧⌘M goes to the previous", previous), ("⌥M clears the one here", cleared),
                    ("⌥⌘M clears all", none), ("undo brings them back", back)]
        for (name, worked) in keys where !worked {
            wrong += 1
            print("  marker key: \(name) DIDN'T")
        }
        print(keys.allSatisfy(\.1) ? "marker keys: M, ⇧M, ⇧⌘M, ⌥M, ⌥⌘M and undo all did what they should" : "marker keys: some wrong")
        if let name = editor.songs.first {
            editor.choose(song: name)
            let limit = Date().addingTimeInterval(30)
            while editor.songSpan == nil || editor.wave.isEmpty, Date() < limit { RunLoop.main.run(until: Date().addingTimeInterval(0.05)) }
            if let span = editor.songSpan, !editor.wave.isEmpty {
                print("song: \(name), \(EditorFormat.clock(editor.songLength)) long, placed to start at \(EditorFormat.clock(span.lowerBound)) in the clip")
                wrong += checkSong(in: editor)
                // A mark 10 seconds into the song, lined up with lap 1; then music from lap 1 to the finish.
                if let first = editor.markers.first, let finish = editor.markers.last, finish > first {
                    editor.addSongMark(at: span.lowerBound + 10)
                    editor.lineUp(songMark: 10, with: editor.seconds(first))
                    let lined = abs((editor.edit.songStart ?? 0) - (editor.seconds(first) - 10)) < 0.002
                    editor.setMusicIn(at: editor.seconds(first))
                    editor.setMusicOut(at: editor.seconds(finish))
                    let heard = editor.musicHeard.map { abs($0.lowerBound - editor.seconds(first)) < 0.001 && abs($0.upperBound - editor.seconds(finish)) < 0.001 } ?? false
                    if !lined || !heard { wrong += 1 }
                    print("music: a mark 10 s into the song \(lined ? "lined up with lap 1" : "DIDN'T line up"), and music in and out \(heard ? "are where they were set" : "are WRONG")")
                }
            } else {
                wrong += 1
                print("song: \(name) couldn't be loaded")
            }
        }
        exit(wrong == 0 ? 0 : 1)
    }

    /// The timer the marker editor draws over the picture against the still the lap timer program
    /// writes for the same run at the same moment: the two have to be the same picture, to the pixel,
    /// or the editor would be showing something the video doesn't get. Returns how many differed.
    @MainActor
    static func checkTimer(in editor: Editor, model: Model) -> Int {
        let track = editor.target.track
        guard !editor.markersChanged, editor.markers.count >= 2,
              let run = model.summaries[track]?.runs.first(where: { $0.name == editor.target.name }) else {
            print("timer: this clip has no saved laps to draw a timer for")
            return 0
        }
        let crossings = editor.markers.map(editor.seconds)
        let options = model.timerOptions(for: track)
        let drawer = TimerDrawer()
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("fpv-hangar-timer-\(ProcessInfo.processInfo.processIdentifier)", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        // Before the start, in a lap, just after a lap ends (while its line still glows), at the
        // moment the best laps are set, and after the finish.
        let first = crossings[0], last = crossings[crossings.count - 1]
        let moments = [max(0, first - 1), first + 2.5, crossings[1] + 0.3, (first + last) / 2, last + 0.2, last + 4]
        var different = 0
        for (index, moment) in moments.enumerated() {
            let ours = folder.appendingPathComponent("editor-\(index).png"), theirs = folder.appendingPathComponent("video-\(index).png")
            let drew = drawer.still(crossings: crossings, at: moment, options: options, frame: CGSize(width: 1920, height: 1080), to: ours)
            let wrote = model.timerStill(markers: run.markers, track: track, at: moment, to: theirs)
            let same = drew && wrote && (try? Data(contentsOf: ours)) == (try? Data(contentsOf: theirs)) && (try? Data(contentsOf: ours)) != nil
            if !same {
                different += 1
                print("  timer at \(EditorFormat.clock(moment)): the editor's and the video's DIFFER\(drew ? "" : " (the editor drew none)")\(wrote ? "" : " (the lap timer wrote none)")")
            }
        }
        print(different == 0 ? "timer: over the picture it is the video's timer, pixel for pixel, at \(moments.count) moments of the run"
              : "timer: \(different) of \(moments.count) moments differ")
        return different
    }

    /// Does to the library given with --root what opening the app does, without a window: takes up
    /// what is saved, reads the season if the library has its event, makes the tracks that are open.
    /// Prints the events and tracks before and after. It can add tracks, so it is for a copy.
    @MainActor
    static func checkLaunch() {
        guard CommandLine.arguments.contains("--root") else {
            print("This can add tracks to the library it is run on. Point it at a copy with --root.")
            exit(1)
        }
        NSApplication.shared.setActivationPolicy(.prohibited)
        let model = Model()
        func show(_ title: String) {
            print(title)
            print("  pilot \"\(model.settings.pilot)\"")
            if model.events.isEmpty { print("  no events") }
            for event in model.events {
                let details = model.details(ofEvent: event.folder)
                print("  \(details.name): \(details.idLabel) \"\(details.id)\", \(model.season(of: event.folder).count) season tracks known")
                for track in event.tracks {
                    let season = model.seasonTrack(for: track)
                    print("    \(Model.trackName(track)): form \(model.state(track).formURL.isEmpty ? "not set" : "set")\(season.map { ", closes \($0.deadline.formatted(date: .abbreviated, time: .shortened))" } ?? "")")
                }
                if let next = model.nextSeasonTrack(in: event.folder) { print("    next: \(next.name), opens \(next.release.formatted(date: .abbreviated, time: .shortened))") }
            }
        }
        show("as it was left")
        model.refresh()
        let limit = Date().addingTimeInterval(40)
        // The season is read in the background. Give it time when there is a season to read.
        while let event = model.seasonEvent, model.season(of: event).isEmpty, Date() < limit { RunLoop.main.run(until: Date().addingTimeInterval(0.1)) }
        RunLoop.main.run(until: Date().addingTimeInterval(0.5))
        show("after opening")
        exit(0)
    }

    /// Checks how the season's schedule and forms are read, on made-up text that needs no network,
    /// and how a library fills with the season's tracks as their days come. Then reads the real
    /// schedule and pages and prints what they give. With --root and an empty folder.
    @MainActor
    static func checkSeason() {
        NSApplication.shared.setActivationPolicy(.prohibited)
        var wrong = 0
        func expect(_ what: String, _ good: Bool, _ detail: String = "") {
            if !good { wrong += 1 }
            print("\(good ? "ok   " : "WRONG") \(what)\(detail.isEmpty ? "" : ": \(detail)")")
        }
        var pacific = Calendar(identifier: .gregorian)
        pacific.timeZone = SeasonSchedule.zone
        func at(_ year: Int, _ month: Int, _ day: Int, _ hour: Int = 12, _ minute: Int = 0, _ second: Int = 0) -> Date {
            pacific.date(from: DateComponents(year: year, month: month, day: day, hour: hour, minute: minute, second: second)) ?? .distantPast
        }
        // The schedule laid out as the series' sheet is, slips and all.
        let sheet = """
        ,,RaceGOW6 Schedule,,,
        Track,Release: ,Deadline: ,Livestream:,Title,Track
        Number,Friday ~9am PST,Sunday 11:59pm PST ,Saturday ~12 noon pST,Sponsor,Designer
        1,Sepetember 25th,October 11th,October 17th,Prop Shop,GateKeeper
        2,October 9th,October 25th,October 31st,Whoops.example,GateKeeper
        3,October 23rd,November 8th,November 14th,TinyMotors,TBD
        7,December 18th,"January 3rd, 2027","January 9th, 2027",someSPONSORfpv,LoopDeLoop
        ,A Meet-Up 2027,"A Town, A State",January 16th-18th 2027,Link to stream = TBD,
        """
        let now = at(2026, 10, 8)
        let made = SeasonSchedule.tracks(inSchedule: sheet, now: now)
        expect("the schedule reads as its four tracks, and not the other events under them", made.map(\.number) == [1, 2, 3, 7])
        expect("a misspelt month still reads, in the right year", made.first?.release == at(2026, 9, 25, 9))
        expect("a deadline is the last second of its day on the Pacific coast", made.first?.deadline == at(2026, 10, 11, 23, 59, 59))
        expect("a day with its year written is in that year", made.last?.deadline == at(2027, 1, 3, 23, 59, 59) && made.last?.release == at(2026, 12, 18, 9))
        expect("read in January, the autumn's days are last year's", SeasonSchedule.tracks(inSchedule: sheet, now: at(2027, 1, 5)).first?.release == at(2026, 9, 25, 9))
        expect("sponsor and designer come through, and TBD is nobody", made.first?.sponsor == "Prop Shop" && made.first?.designer == "GateKeeper" && made[2].designer == nil)
        // The two ways the series' pages name a track's form, with the track-building form before it.
        let page = """
        <p>If you create a track for IGOW<span>6</span> please submit it here: <a href="https://www.google.com/url?q=https%3A%2F%2Fforms.gle%2FBuildABCD&amp;sa=D">https://forms.gle/BuildABCD</a></p>
        <h2>RaceGOW<span>6</span> Track <span>1</span></h2><p>Deadline = Sunday, <b>October 11th</b> at 11:59:59pm PST</p>
        <p>Submission Form is <a href="https://www.google.com/url?q=https%3A%2F%2Fforms.gle%2FTrackOne111&amp;sa=D">https://forms.gle/TrackOne111</a></p>
        <h2>RaceGOW6 Track2</h2><p>Deadline = Sunday, October 25th 11:59:59pm PST</p><p>Submission Form = <a href="https://docs.google.com/forms/d/e/abcDEF_123/viewform">here</a></p>
        <h2>RaceGOW6 Track3</h2><p>Opens October 23rd</p>
        """
        let forms = SeasonSchedule.forms(inPage: page)
        expect("each track gets its own form from the page, and the track-building form is nobody's",
               forms == [1: "https://forms.gle/TrackOne111", 2: "https://docs.google.com/forms/d/e/abcDEF_123/viewform"], "\(forms.sorted { $0.key < $1.key })")

        // A library filling up as the days come.
        if let index = CommandLine.arguments.firstIndex(of: "--root"), index + 1 < CommandLine.arguments.count,
           ((try? FileManager.default.contentsOfDirectory(atPath: CommandLine.arguments[index + 1])) ?? []).filter({ !$0.hasPrefix(".") }).isEmpty {
            let model = Model()
            model.finishSetUp(pilot: "TEST PILOT", fliesRaceGOW: false, number: "")
            // The event, as the setup questions make it, with the made-up schedule as if just read.
            let event = PilotList.season
            try? FileManager.default.createDirectory(at: model.root.appendingPathComponent(event), withIntermediateDirectories: true)
            var season = made
            season[0].form = "https://docs.google.com/forms/d/e/abcDEF_123/viewform"
            model.store.events = [event: EventState(id: "000", idLabel: PilotList.idLabel, season: season, seasonRead: Date())]
            model.findTracks()
            func names() -> [String] { model.tracks.map(Model.trackName) }
            model.applySeason(now: at(2026, 9, 20))
            expect("before the season starts there are no tracks, and Track 1 is the one to come", names().isEmpty && model.nextSeasonTrack(in: event, now: at(2026, 9, 20))?.number == 1)
            model.applySeason(now: now)
            expect("on 8 October Track 1 is there, with its form, and Track 2 is the one to come",
                   names() == ["Track 1"] && model.state(event + "/Track 1").formURL.hasSuffix("abcDEF_123/viewform") && model.nextSeasonTrack(in: event, now: now)?.number == 2)
            model.applySeason(now: at(2026, 10, 9, 8, 59))
            expect("a minute before nine on the 9th, Track 2 is still to come", names() == ["Track 1"])
            model.applySeason(now: at(2026, 10, 9, 9, 1))
            expect("a minute after, it is there", names() == ["Track 1", "Track 2"] && model.state(event + "/Track 2").formURL.isEmpty)
            model.update(event + "/Track 1") { $0.formURL = "https://example.com/the-pilots-own" }
            model.applySeason(now: at(2026, 10, 9, 9, 1))
            expect("a form link the pilot put in is left alone", model.state(event + "/Track 1").formURL == "https://example.com/the-pilots-own")
            model.askToDelete(track: event + "/Track 2")
            model.applySeason(now: at(2026, 10, 10))
            expect("a track the pilot deletes doesn't come back by itself", names() == ["Track 1"], "\(model.notice ?? "")")
            model.newTrack(in: event, now: at(2026, 10, 10))
            expect("New track brings it back", names() == ["Track 1", "Track 2"])
            model.notice = nil
            model.newTrack(in: event, now: at(2026, 10, 10))
            expect("and with nothing left to add, says when the next one opens", names() == ["Track 1", "Track 2"] && (model.notice ?? "").contains("Track 3"), model.notice ?? "nothing said")
            model.applySeason(now: at(2027, 2, 1))
            expect("by February every track is there", names() == ["Track 1", "Track 2", "Track 3", "Track 7"] && model.nextSeasonTrack(in: event, now: at(2027, 2, 1)) == nil)
            let reread = Model()
            expect("the schedule is kept with the library", reread.season(of: event).count == 4 && reread.store.events?[event]?.skipped == [])
        } else {
            print("(give --root with an empty folder to check a library filling up as the days come)")
        }

        final class Box: @unchecked Sendable { var result: Result<[SeasonTrack], Error>? }
        let box = Box()
        Task.detached {
            do { box.result = .success(try await SeasonSchedule.read()) } catch { box.result = .failure(error) }
        }
        let limit = Date().addingTimeInterval(60)
        while box.result == nil, Date() < limit { RunLoop.main.run(until: Date().addingTimeInterval(0.05)) }
        switch box.result {
        case .success(let tracks):
            print("the real season, read just now: \(tracks.count) tracks")
            let style = Date.FormatStyle(date: .abbreviated, time: .shortened)
            for one in tracks {
                print("  \(one.name): opens \(one.release.formatted(style)), closes \(one.deadline.formatted(style)), \(one.sponsor ?? "no sponsor") / \(one.designer ?? "designer to come"), form: \(one.form ?? "not posted yet")")
            }
            expect("the real schedule has tracks, and those open now with a form have the form's own address",
                   !tracks.isEmpty && tracks.filter { $0.release <= Date() && $0.form != nil }.allSatisfy { $0.form?.hasPrefix("https://docs.google.com/forms/") == true })
        case .failure(let error):
            wrong += 1
            print("WRONG the real schedule couldn't be read: \(error.localizedDescription)")
        case nil:
            wrong += 1
            print("WRONG the real schedule never answered")
        }
        exit(wrong == 0 ? 0 : 1)
    }

    /// Checks how the series' pilot list is read and searched, on a made-up list that needs no
    /// network, then reads the real one and says who each thing asked for after the flag could be.
    /// Only the names and numbers asked for are printed.
    @MainActor
    static func checkPilots(_ asked: [String]) {
        NSApplication.shared.setActivationPolicy(.prohibited)
        let sample = """
        ,,,,,A note above the headings
        Reg#,Pilot Name,Name,Location,,You can search the page
        503,310,Sam,Somewhere,,
        232,_-Ember-_,Kit,Elsewhere
        042,SkyBiscuit,Pat,Nowhere
        007,"Comma, The Pilot",Jo,"A Town, A State"
        310,"Quote ""Q"" Pilot",Al,Anywhere
        ,,,,
        045,Sky Otter,Bo,Far Away
        """
        let made = PilotList.parse(sample)
        var wrong = 0
        func expect(_ what: String, _ got: [String], _ wanted: [String]) {
            let good = got.sorted() == wanted.sorted()
            if !good { wrong += 1 }
            print("\(good ? "ok   " : "WRONG") \(what): \(got.isEmpty ? "nobody" : got.joined(separator: ", "))")
        }
        func numbers(_ query: String) -> [String] { PilotList.find(query, in: made).map(\.number) }
        expect("the made-up list reads as six pilots, quoted names whole", made.map(\.name), ["310", "_-Ember-_", "SkyBiscuit", "Comma, The Pilot", "Quote \"Q\" Pilot", "Sky Otter"])
        expect("a name exactly", numbers("SkyBiscuit"), ["042"])
        expect("a name in other capitals", numbers("  skybiscuit "), ["042"])
        expect("a name without its punctuation", numbers("ember"), ["232"])
        expect("a number without its zero", numbers("42"), ["042"])
        expect("a number with a #", numbers("#042"), ["042"])
        expect("a number that is also somebody's pilot name", numbers("310"), ["503", "310"])
        expect("part of a name, when several have it", numbers("sky"), ["042", "045"])
        expect("a name with a comma in it", numbers("comma, the pilot"), ["007"])
        expect("somebody who isn't on it", numbers("NoSuchPilotAnywhere"), [])
        expect("a single letter, which could be anyone", numbers("s"), [])

        final class Box: @unchecked Sendable { var result: Result<[PilotList.Pilot], Error>? }
        let box = Box()
        Task.detached {
            do { box.result = .success(try await PilotList.read()) } catch { box.result = .failure(error) }
        }
        let limit = Date().addingTimeInterval(30)
        while box.result == nil, Date() < limit { RunLoop.main.run(until: Date().addingTimeInterval(0.05)) }
        switch box.result {
        case .success(let pilots):
            print("the real \(PilotList.season) pilot list: \(pilots.count) pilots")
            for query in asked where !query.hasPrefix("--") {
                let found = PilotList.find(query, in: pilots)
                print("  \"\(query)\": \(found.isEmpty ? "nobody" : found.map { "\($0.name), \(PilotList.idLabel) \($0.number)" }.joined(separator: "; "))")
            }
        case .failure(let error):
            wrong += 1
            print("WRONG the real pilot list couldn't be read: \(error.localizedDescription)")
        case nil:
            wrong += 1
            print("WRONG the real pilot list never answered")
        }
        exit(wrong == 0 ? 0 : 1)
    }

    /// From a library with nothing in it to finished videos, the way a new pilot goes: a name, a
    /// track, a recording added, its laps marked, a song with its biggest drop put on the start gate,
    /// and the two videos made. Prints each step. It needs --root with an empty folder, and after the
    /// flag a recording, a song, and the gate crossings in seconds.
    @MainActor
    static func checkFresh(_ given: [String]) {
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)
        let paths = given.filter { !$0.hasPrefix("--") && Double($0) == nil }
        let crossings = given.compactMap { Double($0) }
        guard let rootIndex = CommandLine.arguments.firstIndex(of: "--root"), rootIndex + 1 < CommandLine.arguments.count else {
            print("This builds a library from nothing. Give it an empty folder with --root.")
            exit(1)
        }
        let root = URL(fileURLWithPath: CommandLine.arguments[rootIndex + 1])
        let files = paths.filter { $0 != root.path }
        guard files.count >= 2, crossings.count >= 2 else {
            print("After --check-fresh: a recording, a song, and at least two gate crossings in seconds.")
            exit(1)
        }
        guard ((try? FileManager.default.contentsOfDirectory(atPath: root.path)) ?? []).filter({ !$0.hasPrefix(".") }).isEmpty else {
            print("\(root.path) has things in it already. This check starts from an empty folder.")
            exit(1)
        }
        let recording = URL(fileURLWithPath: files[0]), song = URL(fileURLWithPath: files[1])
        var wrong = 0
        func step(_ what: String, _ worked: Bool, _ detail: String = "") {
            if !worked { wrong += 1 }
            print("\(worked ? "ok   " : "WRONG") \(what)\(detail.isEmpty ? "" : ": \(detail)")")
        }
        func wait(_ seconds: Double = 60, until done: () -> Bool) {
            let limit = Date().addingTimeInterval(seconds)
            while !done(), Date() < limit { RunLoop.main.run(until: Date().addingTimeInterval(0.05)) }
        }
        SoundWave.muted = true

        // 1. The first launch.
        let model = Model()
        step("a new library opens on the first screen, with no event and no tracks", model.page == .home && model.events.isEmpty && model.tracks.isEmpty)
        model.openVideoCreator()
        step("the Video Creator has nothing in it and says so", model.page == .tracks && model.events.isEmpty)
        model.page = .home
        // 2. The setup questions, answered as a pilot who flies the season.
        model.note = .welcome
        model.closeNote()
        wait(3) { model.note == .setUp }
        step("after the welcome note come the setup questions", model.note == .setUp)
        model.finishSetUp(pilot: "TEST PILOT", fliesRaceGOW: true, number: "000")
        let event = PilotList.season
        let reread = Model()
        step("they leave the pilot's name, and the season's event with the registration number",
             reread.settings.pilot == "TEST PILOT" && reread.events.map(\.folder) == [event] && reread.details(ofEvent: event).id == "000"
             && reread.details(ofEvent: event).idLabel == PilotList.idLabel && model.note == nil && model.page == .home,
             "\(reread.settings.pilot), event \(reread.events.map(\.folder)), \(reread.details(ofEvent: event).idLabel) \(reread.details(ofEvent: event).id)")
        // 3. The season's tracks, which a pilot who flies it doesn't have to make.
        wait(40) { !model.tracks.isEmpty }
        if model.tracks.isEmpty {
            print("     (the season's schedule couldn't be read, so a track is made by hand)")
            model.newTrack(in: event)
        } else {
            let open = model.tracks.map { track in "\(Model.trackName(track))\(model.state(track).formURL.isEmpty ? ", no form posted yet" : ", with its form")" }
            step("the season's open tracks are there by themselves", model.tracks.allSatisfy { model.seasonTrack(for: $0) != nil } && !model.state(model.tracks[0]).formURL.isEmpty,
                 open.joined(separator: "; ") + (model.nextSeasonTrack(in: event).map { "; \($0.name) opens \($0.release.formatted(date: .abbreviated, time: .omitted))" } ?? ""))
        }
        model.openVideoCreator()
        guard case .track(let track) = model.page else {
            step("the Video Creator opens on a track", false)
            exit(1)
        }
        step("the Video Creator opens on a track", model.tracks.contains(track), track)
        model.addClips([recording], to: track)
        wait(600) { model.job == nil }
        let clip = model.clips[track]?.first
        step("Add clips copies the recording in", clip != nil, model.notice ?? "")
        guard let clip else { exit(1) }
        // 4. Marking the laps. A recording added by itself opens there without being asked.
        wait(5) { model.editor != nil }
        step("a recording added by itself opens straight into marking", model.editor?.target.clip == clip)
        if model.editor == nil { model.mark(clip: clip, track: track) }
        wait(120) { model.editor?.phase != .loading }
        guard let editor = model.editor, editor.phase == .ready else {
            if case .failed(let reason)? = model.editor?.phase { step("Mark laps opens the recording", false, reason) } else { step("Mark laps opens the recording", false) }
            exit(1)
        }
        step("Mark laps opens the recording", true, "\(editor.frameCount) frames at \(editor.fpsLabel) a second")
        for crossing in crossings {
            editor.show(editor.frameIndex(at: crossing + 0.5 / editor.fps))
            editor.addMarker()
        }
        step("a marker on each gate crossing gives the laps", editor.markers.count == crossings.count && editor.best != nil,
             "laps \(editor.laps.map(EditorFormat.lap).joined(separator: "  ")), best \(editor.window): \(editor.best.map { EditorFormat.lap($0.total) } ?? "none")")
        let expected = editor.best.map { EditorFormat.lap($0.total) }
        step("Save writes the markers", model.save(editor) == nil)
        model.closeEditor()
        wait { model.summaries[track]?.runs.isEmpty == false }
        guard let run = model.summaries[track]?.runs.first else {
            step("the run shows on the track's page", false)
            exit(1)
        }
        step("the run shows on the track's page with the same time", run.best?.seconds == expected, "\(run.name) \(run.best?.seconds ?? "no time")")
        // 5. Music.
        model.edit(run, track: track)
        wait(120) { model.editor?.phase != .loading }
        guard let again = model.editor, again.phase == .ready else {
            step("Markers & music opens the run", false)
            exit(1)
        }
        step("Markers & music opens the run with its markers", again.markers.count == crossings.count)
        again.importSong(from: song)
        wait { again.songSpan != nil && !again.listening && !again.wave.isEmpty }
        let kept = model.songLibrary.appendingPathComponent(song.lastPathComponent)
        step("adding a song keeps it in the song library, not in the track", FileManager.default.fileExists(atPath: kept.path)
             && !FileManager.default.fileExists(atPath: model.folder(track, "music").appendingPathComponent(song.lastPathComponent).path), Model.songsFolder + "/" + song.lastPathComponent)
        step("the song is listened to", again.songSpan != nil && again.analysis != nil,
             again.analysis.map { "\($0.tempoLabel ?? "no tempo"), drops at \($0.spots.map { EditorFormat.songClock($0.time) }.joined(separator: ", "))" } ?? "nothing heard")
        if let drop = again.spots.max(by: { $0.strength < $1.strength }) {
            again.put(songTime: drop.time)
            step("its biggest drop goes on the start gate", again.gate(under: drop.time) == 0, again.shortfall(withStartGateAt: drop.time) ?? "the song covers the whole video")
        }
        again.addSongMark(inSong: 12.5)
        step("Save keeps the song and where it lies", model.save(again) == nil && model.state(track).edits?[run.name]?.song == song.lastPathComponent)
        // A mark belongs to the song: a clip that has never used the song finds the mark there.
        let other = Editor(target: again.target, edit: RunEdit(song: song.lastPathComponent, songStart: 0), window: 3, tool: model.tool,
                           musicFolder: model.folder(track, "music"), songLibrary: model.songLibrary, songMarks: model.songMarks, clipNames: [])
        step("a mark put in the song stays with the song, for the next clip that uses it", other.songMarks == [12.5] && Model().songMarks[song.lastPathComponent] == [12.5],
             "marks kept with \(song.lastPathComponent): \(model.songMarks[song.lastPathComponent] ?? [])")
        other.stop()
        let length = again.stretch.map { $0.upperBound - $0.lowerBound } ?? 0
        model.closeEditor()
        // A logo for the event, which the 9:16 video then carries. A small made-up one: a red square.
        let picture = FileManager.default.temporaryDirectory.appendingPathComponent("fpv-hangar-logo-\(ProcessInfo.processInfo.processIdentifier).png")
        if let surface = CGContext(data: nil, width: 96, height: 60, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                   bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) {
            surface.setFillColor(CGColor(srgbRed: 0.8, green: 0.1, blue: 0.1, alpha: 1))
            surface.fill(CGRect(x: 18, y: 0, width: 60, height: 60))
            if let made = surface.makeImage(), let file = CGImageDestinationCreateWithURL(picture as CFURL, "public.png" as CFString, 1, nil) {
                CGImageDestinationAddImage(file, made, nil)
                CGImageDestinationFinalize(file)
            }
        }
        let logoProblem = model.setLogo(from: picture, ofEvent: event)
        step("an event's logo is kept in the event's folder", logoProblem == nil && model.logo(ofEvent: event)?.lastPathComponent == "Logo.png"
             && Model().logo(ofEvent: event) != nil, logoProblem ?? "\(event)/Logo.png")
        try? FileManager.default.removeItem(at: picture)
        // 6. The videos.
        for (output, folder) in [(Model.Output.landscape, "landscape"), (Model.Output.upright, "vertical")] {
            guard let current = model.summaries[track]?.runs.first else { break }
            model.make(current, track: track, output: output)
            wait(900) { model.job == nil }
            wait { (try? FileManager.default.contentsOfDirectory(atPath: model.folder(track, folder).path))?.contains { $0.hasSuffix(".mp4") } ?? false }
            let made = ((try? FileManager.default.contentsOfDirectory(atPath: model.folder(track, folder).path)) ?? []).filter { $0.hasSuffix(".mp4") }
            var detail = model.notice?.components(separatedBy: "\n").first ?? ""
            var good = made.count == 1
            if let file = made.first {
                // It should run as long as the stretch chosen, with picture and sound.
                let asset = AVURLAsset(url: model.folder(track, folder).appendingPathComponent(file))
                final class Box: @unchecked Sendable { var seconds = 0.0, picture = false, sound = false }
                let box = Box()
                var finished = false
                Task {
                    box.seconds = ((try? await asset.load(.duration))?.seconds) ?? 0
                    box.picture = ((try? await asset.loadTracks(withMediaType: .video).first) ?? nil) != nil
                    box.sound = ((try? await asset.loadTracks(withMediaType: .audio).first) ?? nil) != nil
                    finished = true
                }
                wait(30) { finished }
                good = good && box.picture && box.sound && abs(box.seconds - length) < 0.2
                detail = "\(file), \(String(format: "%.2f", box.seconds)) s for a stretch of \(String(format: "%.2f", length)) s, \(box.picture ? "picture" : "NO PICTURE") and \(box.sound ? "sound" : "NO SOUND")"
            }
            step("Make \(output.title)", good, detail)
            step("and asks whether to watch it now", model.justMade?.title == output.title && made.first.map { model.justMade?.path.hasSuffix($0) ?? false } ?? false)
            model.justMade = nil
            wait { model.summaries[track] != nil }
        }
        // 7. What a new pilot would find in the library.
        let inside = ((try? FileManager.default.subpathsOfDirectory(atPath: root.path)) ?? []).filter { !$0.contains("/.") && !$0.hasPrefix(".") }.sorted()
        print("in the library now:")
        for path in inside where path.split(separator: "/").count <= 4 { print("  \(path)") }
        print(wrong == 0 ? "from an empty library to finished videos, every step worked" : "\(wrong) step\(wrong == 1 ? "" : "s") went wrong")
        exit(wrong == 0 ? 0 : 1)
    }

    /// Works the marker editor's timeline and its sound wave window the way a hand does: with clicks,
    /// double-clicks, drags and key presses, made inside the app and sent through it like real ones,
    /// to a window put up far off any screen. Prints what each did. Nothing is saved.
    @MainActor
    static func checkClicks() {
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)
        let model = loadedModel()
        // A size such as 3440x1340 as the last thing on the line tries it all in a window of that size.
        var size = NSSize(width: 1280, height: 840)
        if let given = CommandLine.arguments.last?.split(separator: "x").compactMap({ Double($0) }), given.count == 2, given[0] >= 1080, given[1] >= 700 {
            size = NSSize(width: given[0], height: given[1])
        }
        let view = NSHostingView(rootView: RootView().environmentObject(model).frame(width: size.width, height: size.height))
        // A window only takes clicks once it is up, so this one is put up far off any screen.
        let window = NSWindow(contentRect: NSRect(origin: NSPoint(x: -6000, y: -6000), size: size), styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = view
        view.layoutSubtreeIfNeeded()
        /// Lets the app take in whatever has been sent to it, for a moment.
        func pump(_ seconds: Double = 0.08) {
            let until = Date().addingTimeInterval(seconds)
            repeat {
                while let event = app.nextEvent(matching: .any, until: Date().addingTimeInterval(0.01), inMode: .default, dequeue: true) { app.sendEvent(event) }
            } while Date() < until
        }
        func wait(_ seconds: Double = 30, until done: () -> Bool) {
            let limit = Date().addingTimeInterval(seconds)
            while !done(), Date() < limit { pump(0.05) }
        }
        var sent = 0
        func mouse(_ type: NSEvent.EventType, at point: CGPoint, clicks: Int = 1) {
            sent += 1
            // SwiftUI measures down from the top of the window, AppKit up from the bottom.
            let place = NSPoint(x: point.x, y: size.height - point.y)
            if let event = NSEvent.mouseEvent(with: type, location: place, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                                              context: nil, eventNumber: sent, clickCount: clicks, pressure: type == .leftMouseUp ? 0 : 1) {
                app.postEvent(event, atStart: false)
            }
            pump()
        }
        func click(at point: CGPoint, clicks: Int = 1) {
            mouse(.leftMouseDown, at: point, clicks: clicks)
            mouse(.leftMouseUp, at: point, clicks: clicks)
        }
        func doubleClick(at point: CGPoint) {
            click(at: point)
            click(at: point, clicks: 2)
        }
        func drag(from start: CGPoint, to end: CGPoint) {
            mouse(.leftMouseDown, at: start)
            for step in 1...6 { mouse(.leftMouseDragged, at: CGPoint(x: start.x + (end.x - start.x) * CGFloat(step) / 6, y: start.y + (end.y - start.y) * CGFloat(step) / 6)) }
            mouse(.leftMouseUp, at: end)
        }
        func key(_ characters: String, code: UInt16, _ modifiers: NSEvent.ModifierFlags = []) {
            if let event = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: modifiers, timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                                            context: nil, characters: characters, charactersIgnoringModifiers: characters, isARepeat: false, keyCode: code) {
                app.postEvent(event, atStart: false)
            }
            pump()
        }
        /// The wheel turned with the pointer at a place in the window: so many points across and down.
        func scroll(at point: CGPoint, across: Int32 = 0, down: Int32 = 0, option: Bool = false) {
            guard let made = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: down, wheel2: across, wheel3: 0) else { return }
            // Such an event says where it is on the screen, measured down from the top of the main one.
            let onScreen = window.convertPoint(toScreen: NSPoint(x: point.x, y: size.height - point.y))
            made.location = CGPoint(x: onScreen.x, y: (NSScreen.screens.first?.frame.height ?? 0) - onScreen.y)
            if option { made.flags = .maskAlternate }
            if let event = NSEvent(cgEvent: made) { app.postEvent(event, atStart: false) }
            // Longer than for a click: once in a while a turn of the wheel takes a moment to arrive.
            pump(0.3)
        }
        var wrong = 0
        func report(_ what: String, _ worked: Bool, _ detail: String = "") {
            if !worked { wrong += 1 }
            print("  \(worked ? "ok   " : "WRONG") \(what)\(detail.isEmpty ? "" : ": \(detail)")")
        }
        SoundWave.muted = true

        // An app that shows nothing is hidden as soon as it starts taking events, so the window goes up after that.
        pump(0.3)
        window.orderFrontRegardless()
        pump(0.3)
        guard window.isVisible else {
            print("The window couldn't be put up, so nothing can be clicked.")
            exit(1)
        }

        /// Clicks the middle of something that has noted where it is. False when it isn't on this page.
        var pageChanged = Date.distantPast
        func press(_ name: String) -> Bool {
            guard let frame = Probe.frames[name], let when = Probe.noted[name], when >= pageChanged else { return false }
            let before = model.page, clicked = Date()
            click(at: CGPoint(x: frame.midX, y: frame.midY))
            pump(0.3)
            if model.page != before { pageChanged = clicked }
            return true
        }
        // The first screen, and the ways in and out of the tools.
        print("around the hangar, in a window \(Int(size.width)) by \(Int(size.height))")
        report("the app opens on the first screen", model.page == .home)
        report("the Video Creator's tile opens it on a track", press("tile videoCreator") && model.page.isInVideoCreator, "\(model.page)")
        let inTool = model.page
        report("Pilot & settings opens from inside it", press("tool settings") && model.page == .settings)
        report("and its way back is to the Video Creator", model.backTitle == "Video Creator" && press("back") && model.page == inTool)
        report("Hangar goes back to the first screen", press("tool hangar") && model.page == .home)
        report("How it works opens from the first screen, and comes back to it", press("home guide") && model.page == .guide && model.backTitle == "Hangar" && press("back") && model.page == .home)
        report("the Leaderboards tile opens, and comes back", press("tile leaderboards") && model.page == .leaderboard && press("back") && model.page == .home)
        report("a tool that isn't built doesn't open when pressed", press("tile upload") && press("tile anyFootage") && model.page == .home)

        guard let editor = openEditor(in: model), editor.phase == .ready else {
            print("No clip could be opened.")
            exit(1)
        }
        pump(0.5)
        // A song, with its biggest drop on the start gate.
        if editor.songSpan == nil, let name = editor.songs.first { editor.choose(song: name) }
        wait { editor.songSpan != nil && !editor.listening && !editor.wave.isEmpty }
        guard let lies = editor.songSpan, editor.markers.count >= 2 else {
            print("This needs a marked run and a song in the music folder.")
            exit(1)
        }
        if let drop = editor.spots.max(by: { $0.strength < $1.strength }) { editor.put(songTime: drop.time) }
        // Catching on the beat is switched off for the clicks whose landing place is checked, and put back at the end.
        let catching = editor.snapToBeat
        editor.snapToBeat = false
        editor.showRun()
        wait(3) { Probe.frames["timeline"] != nil }
        pump(0.4)
        guard let timeline = Probe.frames["timeline"], let placed = editor.songSpan else {
            print("The timeline never appeared.")
            exit(1)
        }
        print("the song lay at \(String(format: "%.3f", lies.lowerBound)) s, and with its biggest drop on the start gate at \(String(format: "%.3f", placed.lowerBound)) s")
        func timelineTime(_ part: Double) -> Double { editor.visible.lowerBound + part * (editor.visible.upperBound - editor.visible.lowerBound) }
        func onMusic(_ part: Double) -> CGPoint {
            CGPoint(x: timeline.minX + CGFloat(part) * timeline.width, y: timeline.minY + EditorTimeline.musicTop + EditorTimeline.musicHeight / 2)
        }
        print("on the timeline")
        // On the laps, above the music.
        click(at: CGPoint(x: timeline.minX + 0.45 * timeline.width, y: timeline.minY + EditorTimeline.lapsTop + 10))
        report("a click on the timeline moves the playhead there", abs(editor.seconds(editor.frame) - timelineTime(0.45)) < 2 * (editor.visible.upperBound - editor.visible.lowerBound) / Double(timeline.width),
               EditorFormat.clock(editor.seconds(editor.frame)))
        let before = editor.edit
        click(at: onMusic(0.3))
        report("a click on the song moves nothing and opens nothing", editor.edit == before && editor.soundWave == nil)
        doubleClick(at: onMusic(0.6))
        pump(0.5)
        let asked = timelineTime(0.6) - placed.lowerBound
        report("a double-click on the song opens its sound wave there", editor.soundWave.map { abs($0.now - asked) < 0.05 } ?? false,
               editor.soundWave.map { String(format: "asked for %.3f s into the song, opened at %.3f", asked, $0.now) } ?? "it didn't open")
        guard let wave = editor.soundWave, let canvas = Probe.frames["wave"], let overview = Probe.frames["overview"] else {
            print("The sound wave window never appeared.")
            exit(1)
        }
        print("in the sound wave window")
        func waveTime(_ part: Double) -> Double { wave.visible.lowerBound + part * (wave.visible.upperBound - wave.visible.lowerBound) }
        func onWave(_ part: Double) -> CGPoint { CGPoint(x: canvas.minX + CGFloat(part) * canvas.width, y: canvas.midY) }
        // A point across the wave is this many seconds of song.
        let point = (wave.visible.upperBound - wave.visible.lowerBound) / Double(canvas.width)
        click(at: onWave(0.25))
        report("a click moves the playhead there", abs(wave.now - waveTime(0.25)) < point, String(format: "%.3f s", wave.now))
        let marks = editor.songMarks
        doubleClick(at: onWave(0.35))
        let made = editor.songMarks.first { !marks.contains($0) }
        report("a double-click marks the song there", made.map { abs($0 - waveTime(0.35)) < point } ?? false, made.map { String(format: "a mark at %.3f s", $0) } ?? "no mark")
        if let made {
            drag(from: onWave(0.35), to: onWave(0.4))
            let moved = editor.songMarks.first { !marks.contains($0) }
            report("dragging the mark moves it", moved.map { abs($0 - waveTime(0.4)) < 2 * point && $0 != made } ?? false, moved.map { String(format: "now at %.3f s", $0) } ?? "it is gone")
            key("z", code: 6, [.command])
            report("⌘Z puts it back", editor.songMarks.contains(made))
            click(at: onWave(0.35))
            report("a click on the mark puts the playhead on it", abs(wave.now - made) < 0.0005)
            key("", code: 51)
            report("⌫ removes it", editor.songMarks == marks)
        }
        click(at: CGPoint(x: overview.minX + overview.width / 2, y: overview.midY))
        report("a click on the bar above goes to that part of the song", abs(wave.now - wave.length / 2) < wave.length / Double(overview.width) * 1.5, String(format: "%.3f s of %.3f", wave.now, wave.length))
        key("m", code: 46)
        report("M marks the song at the playhead, and the clip keeps its markers", editor.songMarks.contains { abs($0 - wave.now) < 0.001 } && editor.markers.count == editor.laps.count + 1)
        key("", code: 51)
        // The wheel: with Option it zooms around the moment under the pointer, without it it moves along.
        let under = waveTime(0.3)
        scroll(at: onWave(0.3), down: 120, option: true)
        let zoomed = wave.visible.upperBound - wave.visible.lowerBound
        report("the wheel with Option zooms in around the pointer", zoomed < wave.length * 0.7 && abs(waveTime(0.3) - under) < zoomed / Double(canvas.width) * 2,
               String(format: "now showing %.1f s, with %.3f s still under the pointer", zoomed, waveTime(0.3)))
        let lower = wave.visible.lowerBound
        scroll(at: onWave(0.3), across: -200)
        report("the wheel moves along the song", abs(wave.visible.lowerBound - lower - 200 * zoomed / Double(canvas.width)) < 0.01 * zoomed,
               String(format: "%.2f s further on", wave.visible.lowerBound - lower))
        scroll(at: CGPoint(x: canvas.midX, y: canvas.minY - 120), across: -200)
        report("off the wave, the wheel is left alone", abs(wave.visible.lowerBound - lower - 200 * zoomed / Double(canvas.width)) < 0.01 * zoomed)
        wave.showAll()
        pump(0.2)
        // Catching on the beat: a click a few points off a beat lands on it.
        if let first = editor.analysis?.firstBeat, let length = editor.analysis?.beatLength {
            editor.snapToBeat = true
            wave.showClosely(around: 60, span: 4)
            pump(0.3)
            let beat = first + (60 / length).rounded() * length
            let off = canvas.minX + CGFloat((beat - wave.visible.lowerBound) / (wave.visible.upperBound - wave.visible.lowerBound)) * canvas.width + 4
            click(at: CGPoint(x: off, y: canvas.midY))
            report("close in, a click just off a beat lands on the beat", abs(wave.now - beat) < 0.0005, String(format: "the beat is at %.4f s, the playhead at %.4f", beat, wave.now))
            editor.snapToBeat = false
        }
        key(" ", code: 49)
        let from = wave.now
        wait(4) { wave.now > from + 0.4 }
        report("Space plays the song", wave.playing && wave.now > from + 0.4)
        key(" ", code: 49)
        report("Space again pauses it", !wave.playing)
        key("\u{1B}", code: 53)
        pump(0.3)
        report("Esc closes the sound wave window, not the editor", editor.soundWave == nil && model.editor != nil)

        print("back on the timeline")
        let start = editor.edit.songStart ?? 0
        let across = (editor.visible.upperBound - editor.visible.lowerBound) / Double(timeline.width)
        drag(from: onMusic(0.5), to: CGPoint(x: onMusic(0.5).x + 60, y: onMusic(0.5).y))
        let slid = (editor.edit.songStart ?? 0) - start
        report("dragging the song slides it", abs(slid - 60 * across) < 8 * across, String(format: "%.3f s later, for a drag of %.3f s", slid, 60 * across))
        key("z", code: 6, [.command])
        report("⌘Z puts it back, in one step", abs((editor.edit.songStart ?? 0) - start) < 0.0005)
        // Dragged back near where it was, the drop catches on the start gate again.
        drag(from: onMusic(0.5), to: CGPoint(x: onMusic(0.5).x + 40, y: onMusic(0.5).y))
        drag(from: onMusic(0.5), to: CGPoint(x: onMusic(0.5).x - 37, y: onMusic(0.5).y))
        report("dragged to within a few points of it, the drop catches on the start gate", editor.spots.contains { editor.gate(under: $0.time) == 0 },
               String(format: "the song lies at %.3f s", editor.edit.songStart ?? 0))
        editor.snapToBeat = catching
        print(wrong == 0 ? "every click, drag and key did what it should" : "\(wrong) did not")
        exit(wrong == 0 ? 0 : 1)
    }

    /// Part of --check-editor: what the lap timer heard in the chosen song, a drop put on the start
    /// gate, and the sound wave window worked by its keys. Returns how many things were wrong.
    @MainActor
    static func checkSong(in editor: Editor) -> Int {
        var wrong = 0
        func wait(_ seconds: Double = 30, until done: () -> Bool) {
            let limit = Date().addingTimeInterval(seconds)
            while !done(), Date() < limit { RunLoop.main.run(until: Date().addingTimeInterval(0.05)) }
        }
        wait { !editor.listening && !editor.wave.isEmpty }
        guard let heard = editor.analysis else {
            print("listening: the lap timer said nothing about the song")
            return 1
        }
        let beat = heard.beatLength.map { String(format: "a steady beat every %.4f s from %.3f s", $0, heard.firstBeat ?? 0) } ?? "no steady beat"
        print("listening: \(heard.tempoLabel ?? "no tempo"), \(beat), drops at \(heard.spots.map { "\(EditorFormat.songClock($0.time)) (\(Int(($0.strength * 100).rounded()))%)" }.joined(separator: ", "))")
        print("sound wave: \(String(format: "%.3f", editor.wave.length)) s drawn, for a song of \(String(format: "%.3f", editor.songLength)) s")
        if abs(editor.wave.length - editor.songLength) > 0.1 { wrong += 1 }
        // The bass should come in at the biggest drop: more of it in the second after than in the second before.
        if let drop = heard.spots.max(by: { $0.strength < $1.strength }),
           let before = editor.wave.levels(from: drop.time - 1, to: drop.time), let after = editor.wave.levels(from: drop.time, to: drop.time + 1) {
            print(String(format: "sound wave at the biggest drop: bass %.2f before it, %.2f after; loudness %.2f before, %.2f after", before.bass, after.bass, before.body, after.body))
            if after.bass <= before.bass { wrong += 1 }
        }
        let before = editor.edit
        if let drop = heard.spots.max(by: { $0.strength < $1.strength }), let first = editor.markers.first {
            editor.put(songTime: drop.time)
            let landed = abs((editor.edit.songStart ?? 0) + drop.time - editor.seconds(first)) < 0.0006 && editor.gate(under: drop.time) == 0
            let parked = abs(editor.seconds(editor.frame) - max(editor.stretch?.lowerBound ?? 0, editor.seconds(first) - 3)) < 1 / editor.fps
            if !landed || !parked { wrong += 1 }
            print("drop on the start gate: the biggest drop \(landed ? "lands on it" : "DOESN'T land on it"), the playhead \(parked ? "is parked 3 s before" : "ISN'T parked before it"); \(editor.shortfall(withStartGateAt: drop.time) ?? "the song covers the whole video")")
        }
        // The sound wave window, by its keys.
        func press(_ characters: String, code: UInt16, _ modifiers: NSEvent.ModifierFlags = []) {
            if let event = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: modifiers, timestamp: 0, windowNumber: 0, context: nil,
                                            characters: characters, charactersIgnoringModifiers: characters, isARepeat: false, keyCode: code) {
                _ = editor.handle(event)
            }
        }
        let marksBefore = editor.songMarks, gatesBefore = editor.markers
        SoundWave.muted = true
        editor.openSoundWave(at: 20)
        guard let window = editor.soundWave else {
            print("sound wave window: DIDN'T open")
            return wrong + 1
        }
        var results: [(String, Bool)] = [("opens where asked", abs(window.now - 20) < 0.001)]
        press("m", code: 46)
        results.append(("M marks the song, not the clip", editor.songMarks.contains(20) && editor.markers == gatesBefore))
        press("", code: 124, [.command])
        results.append(("⌘→ nudges the mark a thousandth", editor.songMarks.contains(20.001) && abs(window.now - 20.001) < 0.0001))
        press("", code: 124)
        results.append(("→ steps a frame", abs(window.now - 20.001 - 1 / editor.fps) < 0.0001))
        press("", code: 126)
        results.append(("↑ goes back to the mark", abs(window.now - 20.001) < 0.0001))
        press("", code: 51)
        results.append(("⌫ removes it", editor.songMarks == marksBefore))
        if let length = heard.beatLength, let first = heard.firstBeat {
            // Between two beats, a little nearer the second.
            let between = first + 40.6 * length
            let catching = editor.snapToBeat
            editor.snapToBeat = true
            let caught = editor.caught(between, within: length)
            editor.snapToBeat = false
            let free = editor.caught(between, within: length)
            editor.snapToBeat = catching
            results.append(("catching on the beat", abs(caught - (first + 41 * length)) < 0.0005 && free == between))
        }
        if let drop = heard.spots.first {
            results.append(("a drop catches", editor.caught(drop.time + 0.004, within: 0.01) == drop.time))
        }
        window.togglePlay()
        let from = window.now
        wait(4) { window.now > from + 0.5 }
        results.append(("Space-style playback moves the playhead", window.playing && window.now > from + 0.5))
        window.pause()
        window.zoom(by: 0.00001)
        results.append(("zooms in no closer than its limit", abs((window.visible.upperBound - window.visible.lowerBound) - SoundWave.closest) < 0.001 && window.visible.contains(window.now)))
        editor.closeSoundWave()
        results.append(("closes", editor.soundWave == nil))
        for (name, worked) in results where !worked {
            wrong += 1
            print("  sound wave window: \(name) DIDN'T work")
        }
        print(results.allSatisfy(\.1) ? "sound wave window: \(results.count) things tried, all as they should be" : "sound wave window: some wrong")
        editor.edit = before
        return wrong
    }

    /// Draws one page to a PNG without showing a window, for checking the layout.
    @MainActor
    static func snapshot(to path: String, page: String?) {
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)
        let model = loadedModel()
        // The clip's picture is drawn by the system outside the view, so it comes out black here.
        if ["mark", "marktall", "wave", "waveclose"].contains(page ?? ""), let editor = openEditor(in: model) {
            // With a song chosen, so the music and what was heard in it are in the picture.
            if editor.songSpan == nil, let name = editor.songs.first { editor.choose(song: name) }
            let limit = Date().addingTimeInterval(30)
            while editor.edit.song != nil, editor.listening || editor.wave.isEmpty || editor.songSpan == nil, Date() < limit { RunLoop.main.run(until: Date().addingTimeInterval(0.05)) }
            if page == "wave" || page == "waveclose", let drop = editor.spots.max(by: { $0.strength < $1.strength }) {
                if editor.gate(under: drop.time) == nil { editor.put(songTime: drop.time) }
                editor.addSongMark(inSong: drop.time + 11.03)
                editor.openSoundWave(at: drop.time)
                // Close in on the drop, or on a stretch given in seconds, to see the beat lines against the drums.
                if page == "waveclose" {
                    let around = CommandLine.arguments.last.flatMap(Double.init) ?? drop.time
                    editor.soundWave?.go(to: around)
                    editor.soundWave?.showClosely(around: around, span: 3)
                }
            }
        }
        if page == "files", let track = model.tracks.first, let run = model.summaries[track]?.runs.first { model.expanded = [run.id] }
        if page == "leaderboard" { model.open(.leaderboard) }
        if page == "settings" { model.open(.settings) }
        if page == "guide" { model.open(.guide) }
        // The Video Creator's track page, or its page for when there is no track yet.
        if page == "track" || page == "files" { model.openVideoCreator() }
        // "marktall" is the editor in a window tall enough to show the whole of its side column. A size
        // such as 3440x1340 after the page's name draws the page in a window of that size.
        var size = NSSize(width: 1280, height: page == "marktall" ? 1500 : 840)
        if let given = CommandLine.arguments.last?.split(separator: "x").compactMap({ Double($0) }), given.count == 2, given[0] >= 400, given[1] >= 300 {
            size = NSSize(width: given[0], height: given[1])
        }
        var content = AnyView(RootView().environmentObject(model))
        if page == "welcome" {
            size = NSSize(width: 720, height: 740)
            content = AnyView(NoteSheet(note: .welcome).environmentObject(model))
        }
        if page == "whatsnew" {
            size = NSSize(width: 720, height: 560)
            content = AnyView(NoteSheet(note: .whatsNew(since: nil)).environmentObject(model))
        }
        // The setup questions: the first, or with a name after "setup2" the second, looked up for that name.
        if page == "setup" {
            size = NSSize(width: 600, height: 330)
            content = AnyView(SetUpSheet().environmentObject(model))
        }
        if page == "setup2" {
            size = NSSize(width: 600, height: 520)
            content = AnyView(SetUpSheet(lookingUp: CommandLine.arguments.last ?? "").environmentObject(model))
        }
        if page == "delete", let track = model.tracks.first {
            // The question a track with something in it gets, without deleting anything.
            model.askToDelete(track: track)
            if let pending = model.pendingRemoval {
                size = NSSize(width: 500, height: 300)
                content = AnyView(RemovalSheet(pending: pending).environmentObject(model))
            }
        }
        if page == "submit", let track = model.tracks.first, let run = model.summaries[track]?.best {
            let address = model.state(track).formURL
            if let url = URL(string: address), let data = try? Data(contentsOf: url) {
                model.forms[address] = FormDefinition.parse(html: String(decoding: data, as: UTF8.self))
            }
            // With "answered" after it, as it looks from the second entry on: every question the app
            // can't answer has an answer kept from last time.
            if CommandLine.arguments.last == "answered", let form = model.forms[address] {
                for question in form.questions where question.role == nil {
                    model.store.answers[question.title] = question.options.last.map { [$0] } ?? ["An answer from last time"]
                }
                model.store.email = "pilot@example.com"
                model.update(track) { $0.links[run.name] = "https://youtu.be/EXAMPLE1234" }
            }
            size = NSSize(width: 680, height: 700)
            content = AnyView(SubmitSheet(target: SubmitTarget(track: track, run: run)).environmentObject(model))
        }
        let view = NSHostingView(rootView: content.frame(width: size.width, height: size.height))
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = view
        view.layoutSubtreeIfNeeded()
        // The looked-up page waits for the pilot list to come back.
        RunLoop.main.run(until: Date().addingTimeInterval(page == "setup2" ? 6 : 1.5))
        guard let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { exit(1) }
        view.cacheDisplay(in: view.bounds, to: bitmap)
        try? bitmap.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: path))
        exit(0)
    }
}
