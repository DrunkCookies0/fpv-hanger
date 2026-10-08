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
    /// A song in the track's music folder. Empty is silence. Nil is the sound file named after the
    /// run, lined up from the Premiere project, when there is one.
    var song: String?
    /// The clip time the song's first moment belongs at. Before 0 means the song is already under way when the clip starts.
    var songStart: Double?
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
    case upload, leaderboards

    var title: String {
        switch self {
        case .upload: return "Upload to YouTube, TikTok and Instagram"
        case .leaderboards: return "Season leaderboards"
        }
    }

    var detail: String {
        switch self {
        case .upload: return "Send a finished video straight to your channels from here, with the YouTube link filled into the submission form for you. For now, upload it yourself and paste the link."
        case .leaderboards: return "The whole season's standings, next to your own times."
        }
    }

    var icon: String {
        switch self {
        case .upload: return "square.and.arrow.up"
        case .leaderboards: return "list.number"
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

    static let summary = "Lap times, timer overlays, finished videos and RaceGOW entry forms, straight from your goggle recordings. Right now it is built around the RaceGOW whoop series."
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
                .step("In Pilot & settings, type your pilot name, and under Events your ID for the race or series. They go on every timer and video, and into the entry form."),
                .step("Press New track under the event in the sidebar, then Open folder, and put your recordings in that track's \"Raw files\" folder."),
                .step("Press Mark laps on a clip. Step to the frame where you cross the start/finish gate and press M. Do that for every crossing, then Save."),
                .step("Press Make 16:9 video for YouTube, or Make 9:16 video for Shorts, TikTok and Reels. Markers & music lets you add a song and choose where the video starts and ends."),
                .step("Paste the track's Google Form link on the track page, upload your video to YouTube, and press Submit this run. The app fills the form in. You press Submit on the form yourself."),
                .paragraph("The full walk-through and the editor's keys are in the app under How it works."),
            ]),
            Section(title: files, items: [
                .paragraph("In a folder called \"FPV Hangar\" in your Movies folder. Pilot & settings shows it and lets you use a different one."),
            ]),
            Section(title: "Updates", items: [
                .paragraph("The app looks for a newer version when it opens. When there is one, a yellow update button appears at the bottom of the sidebar. It downloads the new version and swaps it in, and the previous copy goes to the Trash."),
                .paragraph("Keep the app in your Applications folder. From anywhere else it may not be able to replace itself."),
                .lines(["  Versions and what changed: \(Updates.page.absoluteString)"]),
            ]),
            Section(title: comingSoon, items: [.paragraph("These are marked \"Coming soon\" in the app and do nothing yet:")] + ComingSoon.allCases.map { .point($0.title) }),
            Section(title: "Good to know", items: [
                .point("Flying another race or series? Press New event in the sidebar. Each event has its own tracks, its own name on the timer and its own ID."),
                .point("Lap times are as exact as your markers: one video frame, which is about 0.017 seconds at 60 frames a second."),
                .point("It has been used most with HDZero recordings (.ts). An .mp4 recording has been tested once. Other formats have not been tried."),
                .point("The app goes online for two things only: to read your Google Form, and to check for a newer version."),
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

    var id: String {
        switch self {
        case .welcome: return "welcome"
        case .whatsNew(let since): return "new since \(since ?? "the start")"
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
        case track(String)
        case leaderboard
        case settings
        case guide
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
            all[folder] = EventState(name: details.name.isEmpty || details.name == folder ? nil : details.name, id: details.id, idLabel: details.idLabel)
            store.events = all
        }
    }

    /// The event of the track that is showing, or the first event when another page is.
    var currentEvent: String {
        if case .track(let track) = page { return Self.eventFolder(of: track) }
        return events.first?.folder ?? ""
    }
    @Published var page: Page = .settings
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
        summaries = [:]
        clips = [:]
        expanded = []
        findTracks()
        // A library with nothing in it starts with one event, for the series the app is built around.
        if events.isEmpty {
            let name = settings.event.flatMap { $0.isEmpty ? nil : $0 } ?? "RaceGOW6"
            var all = store.events ?? [:]
            all[name] = EventState(id: settings.id.isEmpty ? nil : settings.id, idLabel: settings.idLabel)
            store.events = all
            findTracks()
        }
        page = tracks.first.map { .track($0) } ?? .settings
    }

    /// Closes the note. After the welcome, a pilot with no name yet is taken to where it goes.
    func closeNote() {
        if note == .welcome, settings.pilot.isEmpty { page = .settings }
        note = nil
    }

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
        findTracks()
        for track in tracks { loadSummary(track) }
        if case .track(let name) = page, !tracks.contains(name), let first = tracks.first { page = .track(first) }
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
        return arguments
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

    /// The sound a run's finished videos get: the song chosen in the marker editor, or else the file
    /// named after the run in the music folder. Nil when they are silent.
    func music(for run: RunInfo, track: String) -> String? {
        if let song = state(track).edits?[run.name]?.song {
            return song.isEmpty ? nil : folder(track, "music").appendingPathComponent(song).path
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
                arguments += ["--music", folder(track, "music").appendingPathComponent(song).path]
                if let start = edit.songStart { arguments += ["--music-start", String(start)] }
            }
        }
        return arguments
    }

    func make(_ run: RunInfo, track: String, output: Output) {
        guard job == nil else { return }
        if output != .overlay, let song = state(track).edits?[run.name]?.song, !song.isEmpty,
           !FileManager.default.fileExists(atPath: folder(track, "music").appendingPathComponent(song).path) {
            notice = "\(song) isn't in \(Self.trackName(track))'s music folder any more. Open Markers & music for \(run.name) and pick the song again."
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
                    let written = lines.last { $0.hasPrefix("Wrote ") }.map { "Made \(URL(fileURLWithPath: String($0.dropFirst(6))).lastPathComponent)" }
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
                        tool: tool, musicFolder: folder(target.track, "music"), clipNames: names.union([target.name.lowercased()]))
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
                let (data, _) = try await URLSession.shared.data(from: url)
                if let form = FormDefinition.parse(html: String(decoding: data, as: UTF8.self)) {
                    forms[address] = form
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

    /// Makes the next track in an event: "Track 3" after two.
    func newTrack(in event: String) {
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
        guard !FileManager.default.fileExists(atPath: root.appendingPathComponent(name).path) else {
            return "There is already a folder called \(name) in your library."
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

struct RootView: View {
    @EnvironmentObject var model: Model

    var body: some View {
        ZStack {
            HStack(spacing: 0) {
                Sidebar()
                ZStack(alignment: .bottom) {
                    Group {
                        switch model.page {
                        case .track(let name): TrackView(track: name).id(name)
                        case .leaderboard: LeaderboardView()
                        case .settings: SettingsView()
                        case .guide: GuideView()
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    StatusBar()
                }
                .background(Theme.background)
            }
            // Out of reach while the editor is up, so a text field under it can't keep the keyboard.
            .disabled(model.editor != nil)
            .accessibilityHidden(model.editor != nil)
            .sheet(item: $model.note) { note in
                NoteSheet(note: note).environmentObject(model)
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
    }
}

struct Sidebar: View {
    @EnvironmentObject var model: Model
    /// Asking for a new event's name.
    @State private var naming = false
    @State private var newName = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 0) {
                    Text("FPV").foregroundStyle(.white)
                    Text("HANGAR").foregroundStyle(Theme.accent)
                }
                .font(.system(size: 26, weight: .black)).tracking(1)
                Text("DRONE RACING").label()
            }
            .padding(.horizontal, 20).padding(.top, 44).padding(.bottom, 26)

            // Events and their tracks can outgrow the window, so this part scrolls.
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(model.events) { event in
                        let title = model.details(ofEvent: event.folder).name
                        Text((title.isEmpty ? "Tracks" : title).uppercased()).label().lineLimit(1)
                            .padding(.horizontal, 20).padding(.top, event.id == model.events.first?.id ? 0 : 20).padding(.bottom, 8)
                        ForEach(event.tracks, id: \.self) { track in
                            SidebarRow(title: Model.trackName(track), detail: model.summaries[track]?.best?.best?.seconds, selected: model.page == .track(track)) {
                                model.page = .track(track)
                            }
                        }
                        Button { model.newTrack(in: event.folder) } label: {
                            Label("New track", systemImage: "plus").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.dim)
                        }
                        .buttonStyle(.plain).padding(.horizontal, 20).padding(.top, 10)
                    }
                    Button { naming = true } label: {
                        Label("New event", systemImage: "folder.badge.plus").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.dim)
                    }
                    .buttonStyle(.plain).padding(.horizontal, 20).padding(.top, 20)
                    .help("Another race or series, with its own tracks, its own name on the timer and its own ID.")

                    Text("SEASON").label().padding(.horizontal, 20).padding(.top, 28).padding(.bottom, 8)
                    SidebarRow(title: "Leaderboard", detail: nil, selected: model.page == .leaderboard) { model.page = .leaderboard }
                    SidebarRow(title: "Pilot & settings", detail: nil, selected: model.page == .settings) { model.page = .settings }
                    SidebarRow(title: "How it works", detail: nil, selected: model.page == .guide) { model.page = .guide }

                    // The series' own site, while any event here is a RaceGOW one.
                    if model.events.contains(where: { model.details(ofEvent: $0.folder).name.lowercased().contains("racegow") }) {
                        Text("RACEGOW.COM").label().padding(.horizontal, 20).padding(.top, 28).padding(.bottom, 8)
                        ForEach([("Home", "home"), ("Tracks", "tracks"), ("Submissions", "submissions"), ("Leaderboards", "leaderboards")], id: \.1) { page in
                            Button {
                                if let url = URL(string: "https://www.racegow.com/\(page.1)") { NSWorkspace.shared.open(url) }
                            } label: {
                                HStack {
                                    Text(page.0).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.dim)
                                    Spacer()
                                    Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .heavy)).foregroundStyle(Theme.faint)
                                }
                                .padding(.leading, 20).padding(.trailing, 16).padding(.vertical, 6)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(.bottom, 12)
            }
            .alert("New event", isPresented: $naming) {
                TextField("Its name, such as RaceGOW7", text: $newName)
                Button("Create") {
                    if let problem = model.newEvent(named: newName) { model.notice = problem }
                    newName = ""
                }
                Button("Cancel", role: .cancel) { newName = "" }
            } message: {
                Text("An event is a race or a series. It gets its own folder in your library, with its own tracks, its own name on the timer and its own ID.")
            }

            Spacer()
            VStack(alignment: .leading, spacing: 3) {
                if case .available(let release) = model.update {
                    Button { model.page = .settings } label: {
                        Text("UPDATE TO V\(release.version)").font(.system(size: 10, weight: .heavy)).tracking(1.1).foregroundStyle(Theme.onAccent)
                            .padding(.horizontal, 9).padding(.vertical, 5).background(Theme.accent, in: Capsule())
                    }
                    .buttonStyle(.plain).padding(.bottom, 8).help("A newer version is ready. Open Pilot & settings to install it.")
                }
                Text(model.settings.pilot.isEmpty ? "Add your pilot name" : model.settings.pilot)
                    .font(.system(size: 15, weight: .heavy)).foregroundStyle(.white)
                // The ID is the event's: the one for the track that is showing.
                let event = model.details(ofEvent: model.currentEvent)
                if !event.id.isEmpty {
                    Text("\(event.idLabel) \(event.id)".uppercased())
                        .font(.system(size: 10, weight: .heavy)).tracking(1.3).foregroundStyle(Theme.accent)
                }
                Text("FPV Hangar v\(AppVersion.current)").font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.faint).padding(.top, 4)
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

    private var summary: TrackSummary { model.summaries[track] ?? TrackSummary() }
    private var state: TrackState { model.state(track) }
    private var form: FormDefinition? { model.form(track) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                header
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
            .frame(maxWidth: 1040, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear {
            model.loadSummary(track)
            model.loadForm(track)
        }
    }

    private var header: some View {
        HStack(alignment: .lastTextBaseline, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                let event = model.details(ofEvent: Model.eventFolder(of: track)).name
                if !event.isEmpty { Text(event.uppercased()).label() }
                Text(Model.trackName(track).uppercased()).font(.system(size: 40, weight: .black)).tracking(0.5)
            }
            if let deadline = form?.deadline { DeadlinePill(deadline: deadline) }
            Spacer()
            Button("Refresh") { model.refresh() }.buttonStyle(SecondaryButton())
            Button("Open folder") { NSWorkspace.shared.open(model.root.appendingPathComponent(track)) }.buttonStyle(SecondaryButton())
        }
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
                     ? "Put the raw clips in this track's \"Raw files\" folder and press Refresh. Each one then gets a Mark laps button."
                     : "Press Mark laps on a clip below, step to each start/finish gate crossing and press M. Save, and the run shows up here, ranked.")
                    .font(.system(size: 13)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
                Text("Markers exported from Premiere still work: File > Export > Markers as CSV into this track's \"csv markers\" folder, named after the race clip (hdz_0008.csv for hdz_0008.ts).")
                    .font(.system(size: 12)).foregroundStyle(Theme.faint).fixedSize(horizontal: false, vertical: true)
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
                Text("Each track has its own form. Paste the link once and Submit fills it in for you.").font(.system(size: 12)).foregroundStyle(Theme.dim)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
        .onAppear { address = saved }
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
                    HStack(spacing: 7) {
                        FileButton(output: .overlay, files: run.overlays) { model.make(run, track: track, output: .overlay) }
                            .help("A see-through timer clip to lay over the footage in Premiere. Only needed if you finish the video there.")
                        Button("Submit this run") { model.submitting = SubmitTarget(track: track, run: run) }
                            .buttonStyle(PrimaryButton())
                            .disabled(run.best == nil)
                    }
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

    private var form: FormDefinition? { model.form(target.track) }
    private var time: String { target.run.best?.seconds ?? "" }
    private var missing: [FormQuestion] {
        (form?.questions ?? []).filter { $0.required && $0.kind != .other && (answers[$0.id] ?? []).allSatisfy { $0.trimmingCharacters(in: .whitespaces).isEmpty } }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("SUBMIT \(Model.trackName(target.track).uppercased())").label()
                    Text(sent ? "Sent" : showingForm ? "Check it and press Submit" : "Your answers").font(.system(size: 24, weight: .black))
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
                        VStack(alignment: .leading, spacing: 18) {
                            AnswerField(title: "Your email", required: true, text: $email)
                            ForEach(form.questions) { question in
                                QuestionRow(question: question, values: Binding(
                                    get: { answers[question.id] ?? [] },
                                    set: { answers[question.id] = $0 }))
                            }
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                ComingSoonBadge()
                                Text("Uploading the video to YouTube from here and filling its link in for you. For now, upload the 16:9 video yourself and paste the link above.")
                                    .font(.system(size: 12)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .padding(24)
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
                    if !missing.isEmpty {
                        Text("\(missing.count) required answer\(missing.count == 1 ? "" : "s") still empty").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.warn)
                    }
                    Button("Fill in the form") {
                        remember()
                        showingForm = true
                    }
                    .buttonStyle(PrimaryButton())
                    .disabled(form == nil || !missing.isEmpty || email.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .padding(18)
        }
        .frame(width: 780, height: 760)
        .background(Theme.background)
        .preferredColorScheme(.dark)
        .onAppear(perform: prepare)
    }

    /// Starts from what's known: the pilot, the time, and whatever was answered last time.
    private func prepare() {
        email = model.store.email
        guard let form else { return }
        for question in form.questions {
            switch question.role {
            case .handle: answers[question.id] = [model.settings.pilot]
            case .number: answers[question.id] = [model.details(ofEvent: Model.eventFolder(of: target.track)).id]
            case .time: answers[question.id] = [time]
            case .link: answers[question.id] = [model.state(target.track).links[target.run.name] ?? ""]
            case nil: answers[question.id] = model.store.answers[question.title] ?? []
            }
        }
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
    @Binding var values: [String]

    var body: some View {
        switch question.kind {
        case .text, .paragraph:
            AnswerField(title: question.title, required: question.required,
                        text: Binding(get: { values.first ?? "" }, set: { values = [$0] }), tall: question.kind == .paragraph)
        case .choice, .checkboxes:
            VStack(alignment: .leading, spacing: 7) {
                QuestionTitle(title: question.title, required: question.required)
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
                QuestionTitle(title: question.title, required: question.required)
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

enum EditorFormat {
    /// The first line of a marker file saved here. The lap timer takes "clip time" in it to mean the
    /// markers never went through a Premiere sequence.
    static let tag = "# FPV Hangar markers, in clip time"

    /// Whether a marker file was saved here rather than exported from Premiere, whatever the app was called at the time.
    static func wrote(_ text: String) -> Bool {
        let first = text.prefix { !$0.isNewline }
        return first.hasPrefix("#") && first.lowercased().contains("clip time")
    }
    /// How finely a song's loudness is sampled for its picture on the timeline.
    static let peaksPerSecond = 100.0
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
    private let musicFolder: URL
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
    /// Songs in the track's music folder.
    @Published var songs: [String] = []
    /// The sound exported from the run's Premiere sequence, if the music folder has one.
    @Published var premiereMusic: String?
    @Published var songLength = 0.0
    /// The chosen song's loudness, `EditorFormat.peaksPerSecond` values to the second, from 0 to 1.
    @Published var peaks: [Float] = []
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

    init(target: EditTarget, edit: RunEdit, window: Int, tool: URL, musicFolder: URL, clipNames: Set<String>) {
        self.target = target
        self.edit = edit
        self.window = max(1, window)
        self.tool = tool
        self.musicFolder = musicFolder
        self.clipNames = clipNames
        savedEdit = edit
        Task { await load() }
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
            // A song that starts before the clip does is already that far in when the clip begins.
            let skipped = max(0, -start), at = max(0, start)
            let length = min(songLength - skipped, range.end.seconds - at)
            if length > 0.05, let music = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
                try? music.insertTimeRange(CMTimeRange(start: clock(skipped), duration: clock(length)), of: sound, at: clock(at))
            }
        }
        guard mine == generation else { return }
        player.replaceCurrentItem(with: AVPlayerItem(asset: composition))
        seeking = false
        wanted = nil
        show(frame, follow: false)
    }

    func stop() {
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
        let songChanged = last.edit.song != edit.song, songMoved = last.edit.songStart != edit.songStart
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
        let names = ((try? FileManager.default.contentsOfDirectory(atPath: musicFolder.path)) ?? [])
            .filter { !$0.hasPrefix(".") && Model.audioExtensions.contains(($0 as NSString).pathExtension.lowercased()) }
            .sorted { $0.localizedStandardCompare($1) == .orderedAscending }
        premiereMusic = names.first { ($0 as NSString).deletingPathExtension.lowercased() == target.name.lowercased() }
        songs = names.filter { !clipNames.contains(($0 as NSString).deletingPathExtension.lowercased()) }
    }

    /// `nil` is the sound from Premiere when there is some, an empty name is silence, anything else is a song in the music folder.
    func choose(song name: String?) {
        guard name != edit.song else { return }
        pause()
        remember()
        edit.song = name
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

    /// After the song has been dragged along the timeline.
    func songMoved() {
        Task { await rebuild() }
    }

    /// Asks for an audio file and copies it into the track's music folder.
    func importSong() {
        pause()
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.audio]
        panel.message = "Choose a song. A copy goes into this track's music folder."
        guard panel.runModal() == .OK, let picked = panel.url else { return }
        let name = picked.lastPathComponent
        let destination = musicFolder.appendingPathComponent(name)
        if picked.standardizedFileURL.path != destination.standardizedFileURL.path, !FileManager.default.fileExists(atPath: destination.path) {
            do {
                try FileManager.default.createDirectory(at: musicFolder, withIntermediateDirectories: true)
                try FileManager.default.copyItem(at: picked, to: destination)
            } catch {
                message = "\(name) couldn't be copied into the music folder: \(error.localizedDescription)"
                return
            }
        }
        findSongs()
        choose(song: name)
    }

    private func loadSong() async {
        song = nil
        songLength = 0
        peaks = []
        guard let name = edit.song, !name.isEmpty else { return }
        let url = musicFolder.appendingPathComponent(name)
        let asset = AVURLAsset(url: url)
        guard let length = try? await asset.load(.duration), length.seconds > 0,
              (try? await asset.loadTracks(withMediaType: .audio).first) != nil else {
            message = "\(name) isn't in the music folder any more, or can't be read."
            return
        }
        guard edit.song == name else { return }
        song = asset
        songLength = length.seconds
        Task {
            let found = await Editor.loudness(of: url)
            if self.edit.song == name { self.peaks = found }
        }
    }

    /// How loud a sound file is along its length, for drawing it.
    nonisolated static func loudness(of url: URL) async -> [Float] {
        let asset = AVURLAsset(url: url)
        guard let track = try? await asset.loadTracks(withMediaType: .audio).first, let reader = try? AVAssetReader(asset: asset) else { return [] }
        let rate = 8000.0
        let output = AVAssetReaderAudioMixOutput(audioTracks: [track], audioSettings: [
            AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false, AVLinearPCMIsNonInterleaved: false, AVSampleRateKey: rate, AVNumberOfChannelsKey: 1,
        ])
        guard reader.canAdd(output) else { return [] }
        reader.add(output)
        guard reader.startReading() else { return [] }
        let bucket = Int(rate / EditorFormat.peaksPerSecond)
        var peaks: [Float] = []
        var highest = 0, filled = 0
        while let buffer = output.copyNextSampleBuffer() {
            guard let block = CMSampleBufferGetDataBuffer(buffer) else { continue }
            var samples = [Int16](repeating: 0, count: CMBlockBufferGetDataLength(block) / 2)
            let copied = samples.withUnsafeMutableBytes { CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: $0.count, destination: $0.baseAddress!) }
            guard copied == noErr else { continue }
            for sample in samples {
                highest = max(highest, abs(Int(sample)))
                filled += 1
                if filled == bucket {
                    peaks.append(Float(highest) / 32768)
                    highest = 0
                    filled = 0
                }
            }
        }
        let top = peaks.max() ?? 0
        return top > 0 ? peaks.map { $0 / top } : peaks
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
        savedMarkers = markers
        savedEdit = edit
        saved = true
    }

    /// Handles a key press. False leaves it for whoever else wants it.
    func handle(_ event: NSEvent) -> Bool {
        guard phase == .ready else { return false }
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
            switch ((event.charactersIgnoringModifiers ?? "").lowercased(), command) {
            case ("m", false): addMarker()
            case ("i", false): setVideoStart()
            case ("o", false): setVideoEnd()
            case ("z", true): undo()
            default: return false
            }
        }
        return true
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
    @State private var closing = false

    var body: some View {
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
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background)
        .onAppear(perform: watchKeys)
        .onDisappear {
            if let monitor { NSEvent.removeMonitor(monitor) }
            monitor = nil
        }
        .confirmationDialog("Save the changes to \(editor.target.name)?", isPresented: $closing) {
            Button("Save") { if save() { model.closeEditor() } }
            Button("Don't save", role: .destructive) { model.closeEditor() }
            Button("Cancel", role: .cancel) {}
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
            if closing || NSApp.modalWindow != nil || window?.attachedSheet != nil || window?.firstResponder is NSTextView { return event }
            let command = event.modifierFlags.contains(.command)
            if command, event.charactersIgnoringModifiers?.lowercased() == "s" {
                _ = save()
                return nil
            }
            if event.keyCode == 53 {
                done()
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

    private func done() {
        if editor.dirty {
            editor.pause()
            closing = true
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
                    Text("Not saved yet").foregroundStyle(Theme.dim)
                } else if editor.saved {
                    Label("Saved", systemImage: "checkmark.circle.fill").foregroundStyle(Theme.good)
                }
            }
            .font(.system(size: 12, weight: .semibold)).multilineTextAlignment(.trailing).frame(maxWidth: 460, alignment: .trailing)
            Button("Save") { save() }.buttonStyle(PrimaryButton()).disabled(!editor.dirty || editor.phase != .ready)
            Button("Done", action: done).buttonStyle(SecondaryButton())
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
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(Color.clear.contentShape(Rectangle()).onTapGesture { editor.togglePlay() })
                    transport
                }
                VStack(spacing: 12) {
                    laps
                    videoCard
                    musicCard
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
            if editor.markers.contains(editor.frame) && !editor.playing {
                Button("Remove marker") { editor.removeMarker() }.buttonStyle(SecondaryButton()).help("Remove the marker on this frame (⌫)")
            } else {
                Button("Mark crossing") { editor.addMarker() }.buttonStyle(PrimaryButton()).help("Mark a gate crossing on this frame (M)")
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
                ScrollView {
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
                            .help("Go to this marker")
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
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
            Text("MUSIC").label()
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
                Button("Choose a file…") { editor.importSong() }
            } label: {
                Label(title, systemImage: "music.note").font(.system(size: 12, weight: .bold)).lineLimit(1)
            }
            .menuStyle(.borderlessButton)
            .padding(.horizontal, 11).padding(.vertical, 7)
            .background(Theme.raised, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(Theme.stroke))
            if let span = editor.songSpan {
                Text(songPlacement(span.lowerBound))
                    .font(.system(size: 11)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 6) {
                    Button("Start it here") { editor.placeSong(at: editor.seconds(editor.frame)) }.buttonStyle(SecondaryButton())
                        .help("Put the start of the song on this frame. Or drag the song along the timeline.")
                    Button("Start it with the video") { editor.placeSong(at: editor.stretch?.lowerBound ?? 0) }.buttonStyle(SecondaryButton())
                        .disabled(editor.stretch == nil)
                }
            } else if chosen == nil, editor.premiereMusic != nil {
                Text("Lined up from your saved Premiere project when a video is made. Pick a song instead to place it here.")
                    .font(.system(size: 11)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
            } else if title == "No music" {
                Text("Pick a song and drag it along the timeline to line it up.")
                    .font(.system(size: 11)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 14)
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
                Text("Space play  ·  ← → one frame  ·  ⇧ ten  ·  ⌥ one second  ·  M mark  ·  ⌫ remove  ·  ⌘← ⌘→ move marker  ·  ↑ ↓ markers  ·  I O video start, end  ·  ⌘Z undo")
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

    enum Drag {
        case scrub, start, end
        /// How far into the song it was picked up.
        case song(Double)
    }

    static let lapsTop: CGFloat = 26, lapsHeight: CGFloat = 30
    static let videoTop: CGFloat = 60, videoHeight: CGFloat = 18
    static let musicTop: CGFloat = 82, musicHeight: CGFloat = 42
    static let height: CGFloat = 124

    var body: some View {
        GeometryReader { geometry in
            Canvas { context, size in draw(in: &context, size: size) }
                .contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 0)
                    .onChanged { dragged($0, width: geometry.size.width) }
                    .onEnded { _ in
                        if case .song = drag { editor.songMoved() }
                        drag = nil
                    })
        }
        .frame(height: Self.height)
    }

    private func dragged(_ value: DragGesture.Value, width: CGFloat) {
        let from = editor.visible.lowerBound, span = editor.visible.upperBound - from
        func seconds(_ x: CGFloat) -> Double { from + Double(x / max(width, 1)) * span }
        func x(_ seconds: Double) -> CGFloat { CGFloat((seconds - from) / span) * width }
        if drag == nil {
            let start = value.startLocation
            drag = .scrub
            if start.y >= Self.musicTop, let song = editor.songSpan, song.contains(seconds(start.x)) {
                editor.pause()
                editor.remember()
                drag = .song(seconds(start.x) - song.lowerBound)
            } else if start.y >= Self.videoTop, start.y < Self.musicTop, let stretch = editor.stretch {
                if abs(start.x - x(stretch.lowerBound)) <= 8 {
                    editor.remember()
                    drag = .start
                } else if abs(start.x - x(stretch.upperBound)) <= 8 {
                    editor.remember()
                    drag = .end
                }
            }
            if case .scrub = drag { editor.pause() }
        }
        let now = seconds(value.location.x)
        switch drag {
        case .scrub: editor.show(editor.frameIndex(at: min(max(now, from), editor.visible.upperBound)), follow: false)
        case .start: editor.dragVideoStart(to: now)
        case .end: editor.dragVideoEnd(to: now)
        case .song(let grabbed): editor.edit.songStart = ((now - grabbed) * 1000).rounded() / 1000
        case nil: break
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
            let peaks = editor.peaks
            if !peaks.isEmpty {
                var wave = Path()
                var column = max(rect.minX, 0).rounded(.down)
                let last = min(rect.maxX, size.width)
                let perColumn = span / Double(size.width) * EditorFormat.peaksPerSecond
                while column < last {
                    let first = Int((from + Double(column / size.width) * span - song.lowerBound) * EditorFormat.peaksPerSecond)
                    if first >= 0, first < peaks.count {
                        let loudest = peaks[first..<min(peaks.count, first + max(1, Int(perColumn.rounded(.up))))].max() ?? 0
                        let tall = max(1, CGFloat(loudest) * (rect.height - 8))
                        wave.addRect(CGRect(x: column, y: rect.midY - tall / 2, width: 1, height: tall))
                    }
                    column += 1
                }
                context.fill(wave, with: .color(Theme.accent.opacity(0.85)))
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

// MARK: - Leaderboard and settings

struct LeaderboardView: View {
    @EnvironmentObject var model: Model

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
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
        .padding(.horizontal, 34).padding(.top, 40)
        .frame(maxWidth: 1040, alignment: .leading)
        .frame(maxWidth: .infinity, alignment: .leading)
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
            Text("How the timer sits on a 16:9 video and on the Premiere overlay, " + (source.run.isEmpty ? "with made-up laps" : "with the laps from \(source.run)")
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
            Text("PILOT & SETTINGS").font(.system(size: 40, weight: .black)).tracking(0.5)
            VStack(alignment: .leading, spacing: 16) {
                Text("PILOT").label()
                HStack(spacing: 14) {
                    AnswerField(title: "Pilot name", required: false, text: $model.settings.pilot)
                    AnswerField(title: "Email for submission forms", required: false, text: $model.store.email)
                }
                Text("Your name goes on every timer and finished video, and into the entry forms.")
                    .font(.system(size: 12)).foregroundStyle(Theme.dim).fixedSize(horizontal: false, vertical: true)
            }
            .card()
            VStack(alignment: .leading, spacing: 18) {
                Text("EVENTS").label()
                ForEach(model.events) { event in EventFields(event: event) }
                Text("An event is a race or a series: a folder in your library with its tracks inside. Its name goes on the timer of every track in it, next to the track's name, and your ID for it goes beside your name and into its entry forms. New event in the sidebar makes another.")
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
                HStack(spacing: 10) {
                    if case .available(let release) = model.update {
                        Button("Update to v\(release.version)") { model.installUpdate() }.buttonStyle(PrimaryButton())
                    }
                    Button("Check for updates") { model.checkForUpdates() }.buttonStyle(SecondaryButton()).disabled(busyUpdating)
                    Toggle("Check when the app opens", isOn: $model.automaticUpdates).toggleStyle(.checkbox).font(.system(size: 12))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()
        }
        .padding(.horizontal, 34).padding(.top, 40).padding(.bottom, 90)
        .frame(maxWidth: 1040, alignment: .leading)
        .frame(maxWidth: .infinity, alignment: .leading)
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
            }
            HStack(spacing: 14) {
                AnswerField(title: "Name on the timer", required: false, text: field(\.name)).frame(width: 260)
                AnswerField(title: "Your ID number", required: false, text: field(\.id)).frame(width: 150)
                AnswerField(title: "Shown before the ID", required: false, text: field(\.idLabel)).frame(width: 200)
            }
        }
    }
}

/// A short walk through the whole job, from a raw clip to a submitted time.
struct GuideView: View {
    @EnvironmentObject var model: Model
    private let steps: [(String, String)] = [
        ("Set up the track",
         "Tracks are grouped by event in the sidebar. Press New track under an event, or New event for another race or series. Put the raw clips in the track's Raw files folder and paste the track's Google Form link into Submission form on the track page."),
        ("Mark the laps",
         "Press Mark laps on a clip. Play or drag to just before a start/finish gate crossing, step to the exact frame with the arrow keys, and press M. The first marker starts lap 1; each later one ends a lap. To fix one, go to it with the up and down arrows and move it a frame at a time with ⌘← and ⌘→. Save, and the run appears on the track page, ranked by its best 3 laps in a row."),
        ("Choose what the video shows",
         "A finished video runs from 3 seconds before lap 1 to 8 seconds after the finish. To change that, open Markers & music on the run and drag the ends of the Video bar, or press I and O on the frames where it should start and end."),
        ("Add music, if you want it",
         "In Markers & music, pick a song from the track's music folder or choose a file. It appears under the laps with its loudness drawn in: drag it until the part you want sits against the laps, and press Space to hear it with the picture."),
        ("Make the videos",
         "Make 16:9 video is for YouTube. Make 9:16 video is for Shorts, TikTok and Reels. Both carry the timer, your name and ID, the event and track, and the music. Premiere overlay is only for finishing a video in Premiere yourself."),
        ("Check them",
         "Click a run to see its files and open any of them in VLC. If there are two versions of something, press Keep only this one on the right one and the other goes to the Trash."),
        ("Submit",
         "Upload the 16:9 video to YouTube, then press Submit this run. Paste the link, check the answers, press Fill in the form, and press Submit at the bottom of the Google Form. The track page then shows what you sent."),
    ]
    private let notes = [
        "Lap times are only as exact as the markers: one frame, which is about 0.017 seconds at 60 frames a second. A run shows a warning when its markers aren't on exact frames.",
        "Premiere still works for all of this. Export a sequence's markers as CSV into the track's csv markers folder, named after the clip, and its sound as an MP3 into the music folder, also named after the clip. Place those markers while the clip still starts at the very beginning of its sequence.",
        "Saving markers here for a run that had a Premiere export moves that export to the Trash, so the run isn't timed twice.",
        "Some clips say 50 frames a second in their header but record 60. That only matters for markers from Premiere, and the track page asks which one the sequence uses. Markers placed here are always in the clip's real time.",
        "Everything lives in the track's folder: Raw files, csv markers and music go in; overlays, landscape and vertical are what gets made. The tracks sit in your library folder, which Pilot & settings shows and can change.",
        "New versions are picked up from Pilot & settings, where Check for updates downloads and installs one in place.",
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .firstTextBaseline) {
                    Text("HOW IT WORKS").font(.system(size: 40, weight: .black)).tracking(0.5)
                    Spacer()
                    Button("What's new") { model.note = .whatsNew(since: nil) }.buttonStyle(SecondaryButton())
                        .help("What changed in each version.")
                    Button("Welcome note") { model.note = .welcome }.buttonStyle(SecondaryButton())
                        .help("The note that opens the first time the app is run.")
                }
                Text("From a raw clip to a submitted time.").font(.system(size: 14)).foregroundStyle(Theme.dim).padding(.bottom, 8)
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
            .frame(maxWidth: 1040, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
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
            init(script: String) { self.script = script }
            func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
                let read = "JSON.stringify(Object.fromEntries([...document.querySelectorAll('input[type=hidden][name^=\"entry.\"]')].filter(i => i.value).map(i => [i.name, i.value]).concat([['email', (document.querySelector('input[type=email]') || {}).value || '']])))"
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                    webView.evaluateJavaScript(self.script) { filled, _ in
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                            webView.evaluateJavaScript(read) { result, error in
                                print("questions filled:", filled ?? "none", "\nform now holds:", result ?? String(describing: error))
                                exit(0)
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
        for question in form.questions {
            switch question.kind {
            case .text, .paragraph: answers[question.id] = ["TEST"]
            case .choice, .checkboxes: answers[question.id] = question.options.first.map { [$0] } ?? []
            case .other: break
            }
        }
        print("\(form.title): \(form.questions.count) questions, \(answers.count) answerable here")
        let checker = Checker(script: fillScript(answers: answers, email: "test@example.com"))
        let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 900, height: 1200))
        view.navigationDelegate = checker
        view.load(URLRequest(url: url))
        withExtendedLifetime(checker) { RunLoop.main.run(until: Date().addingTimeInterval(30)) }
        print("The form never finished loading.")
        exit(1)
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
        if let name = editor.songs.first {
            editor.choose(song: name)
            let limit = Date().addingTimeInterval(30)
            while editor.songSpan == nil || editor.peaks.isEmpty, Date() < limit { RunLoop.main.run(until: Date().addingTimeInterval(0.05)) }
            if let span = editor.songSpan, !editor.peaks.isEmpty {
                print("song: \(name), \(EditorFormat.clock(editor.songLength)) long, placed to start at \(EditorFormat.clock(span.lowerBound)) in the clip, \(editor.peaks.count) loudness readings")
            } else {
                wrong += 1
                print("song: \(name) couldn't be loaded")
            }
        }
        exit(wrong == 0 ? 0 : 1)
    }

    /// Draws one page to a PNG without showing a window, for checking the layout.
    @MainActor
    static func snapshot(to path: String, page: String?) {
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)
        let model = loadedModel()
        // The clip's picture is drawn by the system outside the view, so it comes out black here.
        if page == "mark" { _ = openEditor(in: model) }
        if page == "files", let track = model.tracks.first, let run = model.summaries[track]?.runs.first { model.expanded = [run.id] }
        if page == "leaderboard" { model.page = .leaderboard }
        if page == "settings" { model.page = .settings }
        if page == "guide" { model.page = .guide }
        var size = NSSize(width: 1280, height: 840)
        var content = AnyView(RootView().environmentObject(model))
        if page == "welcome" {
            size = NSSize(width: 720, height: 740)
            content = AnyView(NoteSheet(note: .welcome).environmentObject(model))
        }
        if page == "whatsnew" {
            size = NSSize(width: 720, height: 560)
            content = AnyView(NoteSheet(note: .whatsNew(since: nil)).environmentObject(model))
        }
        if page == "submit", let track = model.tracks.first, let run = model.summaries[track]?.best {
            let address = model.state(track).formURL
            if let url = URL(string: address), let data = try? Data(contentsOf: url) {
                model.forms[address] = FormDefinition.parse(html: String(decoding: data, as: UTF8.self))
            }
            size = NSSize(width: 780, height: 760)
            content = AnyView(SubmitSheet(target: SubmitTarget(track: track, run: run)).environmentObject(model))
        }
        let view = NSHostingView(rootView: content.frame(width: size.width, height: size.height))
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = view
        view.layoutSubtreeIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(1.5))
        guard let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { exit(1) }
        view.cacheDisplay(in: view.bounds, to: bitmap)
        try? bitmap.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: path))
        exit(0)
    }
}
