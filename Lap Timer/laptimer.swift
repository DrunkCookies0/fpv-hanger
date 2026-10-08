// laptimer — builds a transparent lap-timer overlay (ProRes 4444 with alpha) for Premiere Pro
// from the timeline markers you drop at each start/finish gate crossing.
//
// Build:  swiftc -O laptimer.swift -o laptimer
// Run:    ./laptimer            (asks a few questions)
//         ./laptimer --help     (all options)

import Accelerate
import AppKit
import AVFoundation
import CoreImage
import Foundation

/// The same number as the VERSION file and the app. package.sh refuses to package if they differ.
let toolVersion = "0.3.0"

// MARK: - Utilities

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data(("\nError: " + message + "\n").utf8))
    exit(1)
}

extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}

func pow10(_ n: Int) -> Int { (0..<n).reduce(1) { value, _ in value * 10 } }

func zeroPad(_ value: Int, _ width: Int) -> String {
    let s = String(value)
    return String(repeating: "0", count: max(0, width - s.count)) + s
}

/// Formats a time held in display units (10^-decimals seconds) as `m:ss.ddd`, or `ss.ddd` under a minute.
func formatTime(_ units: Int, decimals: Int, minutes: Bool, plain: Bool = false) -> String {
    let perSecond = pow10(decimals)
    let whole = units / perSecond
    let fraction = decimals > 0 ? "." + zeroPad(units % perSecond, decimals) : ""
    // `plain` keeps it in seconds however long it is, the way the submission form wants it.
    if !plain && (minutes || whole >= 60) { return "\(whole / 60):" + zeroPad(whole % 60, 2) + fraction }
    return "\(whole)" + fraction
}

/// Parses `ss.sss`, `m:ss.sss` or `h:mm:ss.sss`.
func parseSeconds(_ text: String) -> Double? {
    let parts = text.trimmed.split(separator: ":", omittingEmptySubsequences: false)
    guard (1...3).contains(parts.count) else { return nil }
    var total = 0.0
    for part in parts {
        guard let value = Double(part), value >= 0 else { return nil }
        total = total * 60 + value
    }
    return total
}

func parseHexColor(_ text: String) -> [CGFloat]? {
    var hex = text.trimmed
    if hex.hasPrefix("#") { hex.removeFirst() }
    guard hex.count == 6, let value = Int(hex, radix: 16) else { return nil }
    return [CGFloat((value >> 16) & 0xFF) / 255, CGFloat((value >> 8) & 0xFF) / 255, CGFloat(value & 0xFF) / 255]
}

// MARK: - Frame rate and timecode

struct FrameRate {
    let num: Int
    let den: Int

    var value: Double { Double(num) / Double(den) }
    /// Frames per timecode second (30 for 29.97, 60 for 59.94, ...).
    var timebase: Int { Int(value.rounded()) }
    var label: String {
        if den == 1 { return "\(num)" }
        return String(format: "%.3f", value).replacingOccurrences(of: "0+$", with: "", options: .regularExpression)
    }

    static let standard: [FrameRate] = [
        FrameRate(num: 24000, den: 1001), FrameRate(num: 24, den: 1), FrameRate(num: 25, den: 1),
        FrameRate(num: 30000, den: 1001), FrameRate(num: 30, den: 1), FrameRate(num: 48, den: 1),
        FrameRate(num: 50, den: 1), FrameRate(num: 60000, den: 1001), FrameRate(num: 60, den: 1),
        FrameRate(num: 100, den: 1), FrameRate(num: 120000, den: 1001), FrameRate(num: 120, den: 1),
        FrameRate(num: 240000, den: 1001), FrameRate(num: 240, den: 1),
    ]

    static func nearest(to rate: Double) -> FrameRate? {
        guard rate.isFinite, rate >= 1 else { return nil }
        if let match = standard.min(by: { abs($0.value - rate) < abs($1.value - rate) }), abs(match.value - rate) < 0.02 {
            return match
        }
        return FrameRate(num: Int((rate * 1000).rounded()), den: 1000)
    }

    static func parse(_ text: String) -> FrameRate? {
        Double(text.trimmed).flatMap(nearest(to:))
    }
}

struct Timecode {
    let hours: Int, minutes: Int, seconds: Int, frames: Int
    let dropFrame: Bool
    let text: String

    private static let pattern = try! NSRegularExpression(
        pattern: #"(?<![\d:;.])(\d{1,2})[:;](\d{2})[:;](\d{2})[:;](\d{2,3})(?![\d:;.])"#)

    static func first(in string: String) -> Timecode? {
        let range = NSRange(string.startIndex..., in: string)
        guard let match = pattern.firstMatch(in: string, range: range) else { return nil }
        let text = (string as NSString).substring(with: match.range)
        let fields = (1...4).map { Int((string as NSString).substring(with: match.range(at: $0)))! }
        return Timecode(hours: fields[0], minutes: fields[1], seconds: fields[2], frames: fields[3],
                        dropFrame: text.contains(";"), text: text)
    }

    func frameNumber(at fps: FrameRate) -> Int {
        let timebase = fps.timebase
        if frames >= timebase {
            fail("Marker \(text) has frame number \(frames), which can't exist at \(fps.label) fps. "
                + "Check that the frame rate matches your Premiere sequence (Sequence > Sequence Settings > Timebase).")
        }
        var number = ((hours * 60 + minutes) * 60 + seconds) * timebase + frames
        if dropFrame && fps.den == 1001 && timebase % 30 == 0 {
            let totalMinutes = hours * 60 + minutes
            number -= (timebase / 15) * (totalMinutes - totalMinutes / 10)
        }
        return number
    }
}

/// Converts a marker written as timecode (`00:00:12:14`, `00;00;12;14`) or plain time (`12.345`, `1:02.345`)
/// to seconds from the start of the sequence.
func markerSeconds(_ token: String, fps: FrameRate) -> Double? {
    if let timecode = Timecode.first(in: token) {
        return Double(timecode.frameNumber(at: fps)) * Double(fps.den) / Double(fps.num)
    }
    return parseSeconds(token)
}

// MARK: - Marker files

func readText(at path: String) -> String? {
    guard let data = FileManager.default.contents(atPath: path) else { return nil }
    if data.starts(with: [0xFF, 0xFE]) || data.starts(with: [0xFE, 0xFF]) {
        return String(data: data, encoding: .utf16)
    }
    // Premiere exports markers as UTF-16; cope with a missing byte-order mark too.
    let sample = data.prefix(400)
    let zeros = sample.enumerated().filter { $0.element == 0 }
    if zeros.count > sample.count / 4 {
        let oddZeros = zeros.filter { $0.offset % 2 == 1 }.count
        return String(data: data, encoding: oddZeros * 2 >= zeros.count ? .utf16LittleEndian : .utf16BigEndian)
    }
    return String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1)
}

/// Pulls one time per marker out of a Premiere marker export (File > Export > Markers) or a plain list of times.
func markerTokens(inFile text: String) -> [String] {
    let lines = text.components(separatedBy: .newlines).filter { !$0.trimmed.isEmpty && !$0.hasPrefix("#") }
    var inColumn: (index: Int, delimiter: Character)?
    if let header = lines.first {
        for delimiter in ["\t", ","] as [Character] {
            let columns = header.split(separator: delimiter, omittingEmptySubsequences: false)
                .map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
            if let index = columns.firstIndex(of: "in") {
                inColumn = (index, delimiter)
                break
            }
        }
    }
    var tokens: [String] = []
    for line in lines {
        if let column = inColumn {
            let cells = line.split(separator: column.delimiter, omittingEmptySubsequences: false)
            if column.index < cells.count, let timecode = Timecode.first(in: String(cells[column.index])) {
                tokens.append(timecode.text)
                continue
            }
        }
        if let timecode = Timecode.first(in: line) {
            tokens.append(timecode.text)
        } else if parseSeconds(line) != nil {
            tokens.append(line.trimmed)
        }
    }
    return tokens
}

/// Markers placed in the app's marker editor say so on a line starting with "#". They are in the race clip's
/// own time, whatever a Premiere sequence made from that clip would have used.
func markersAreInClipTime(_ text: String) -> Bool {
    text.components(separatedBy: .newlines).contains { $0.hasPrefix("#") && $0.lowercased().contains("clip time") }
}

// MARK: - Race model

struct Race {
    /// Start/finish gate crossings in display units (10^-decimals seconds) from the start of the sequence.
    /// Lap times are differences of these, so the laps shown always add up exactly to the totals shown.
    let bounds: [Int]
    let decimals: Int
    /// How many consecutive laps are combined.
    let window: Int

    var unitsPerSecond: Int { pow10(decimals) }
    var lapCount: Int { bounds.count - 1 }

    func lap(_ index: Int) -> Int { bounds[index + 1] - bounds[index] }

    func completed(at now: Int) -> Int {
        bounds.dropFirst().filter { $0 <= now }.count
    }

    /// Fastest run of `window` consecutive laps among the first `completed` laps.
    func best(afterLaps completed: Int) -> (start: Int, total: Int)? {
        guard completed >= window else { return nil }
        var result: (start: Int, total: Int)?
        for start in 0...(completed - window) {
            let total = bounds[start + window] - bounds[start]
            if result == nil || total < result!.total { result = (start, total) }
        }
        return result
    }

    func time(_ units: Int, minutes: Bool = false) -> String {
        formatTime(units, decimals: decimals, minutes: minutes)
    }
}

// MARK: - Panel drawing

final class Panel {
    enum Align { case left, right }
    /// `stack` is the corner box for a landscape frame. `wide` is the low strip that sits under the
    /// picture in an upright video.
    enum Layout { case stack, wide }

    let race: Race
    let scale: CGFloat
    let title: String?
    let badge: String?
    /// The event and track, shown as a strip across the top, such as "RACEGOW6" and "TRACK 1".
    let event: String?
    let track: String?
    let layout: Layout
    let rows: Int
    let pixelWidth: Int
    let pixelHeight: Int

    private let context: CGContext
    private let accentRGB: [CGFloat]
    private let accent: CGColor
    private let onAccent: CGColor

    // Layout in 1080p reference points; `scale` maps them to pixels.
    private let width: CGFloat
    private let height: CGFloat
    private let pad: CGFloat = 24
    private let stripHeight: CGFloat
    private let titleHeight: CGFloat
    private let headerHeight: CGFloat
    private let rowHeight: CGFloat = 38
    private let footerHeight: CGFloat = 66
    /// Wide layout: where the lap list starts.
    private let listX: CGFloat = 330

    private let titleFont = NSFont.systemFont(ofSize: 16, weight: .bold) as CTFont
    private let badgeFont = NSFont.systemFont(ofSize: 13, weight: .heavy) as CTFont
    private let stripFont = NSFont.systemFont(ofSize: 13, weight: .heavy) as CTFont
    private let headLabelFont = NSFont.systemFont(ofSize: 17, weight: .heavy) as CTFont
    private let bigFont = NSFont.monospacedDigitSystemFont(ofSize: 66, weight: .heavy) as CTFont
    private let rowLabelFont = NSFont.systemFont(ofSize: 15, weight: .bold) as CTFont
    private let rowValueFont = NSFont.monospacedDigitSystemFont(ofSize: 24, weight: .bold) as CTFont
    private let footLabelFont = NSFont.systemFont(ofSize: 16, weight: .heavy) as CTFont
    private let footValueFont = NSFont.monospacedDigitSystemFont(ofSize: 32, weight: .heavy) as CTFont

    /// `title` (pilot name) and `badge` (such as an ID) share a heading row, under the event and track strip.
    init(race: Race, scale: CGFloat, accent rgb: [CGFloat], title: String?, badge: String? = nil,
         event: String? = nil, track: String? = nil, maxRows: Int, layout: Layout = .stack) {
        self.race = race
        self.scale = scale
        self.title = title
        self.badge = badge
        self.event = event
        self.track = track
        self.layout = layout
        accentRGB = rgb
        accent = CGColor(srgbRed: rgb[0], green: rgb[1], blue: rgb[2], alpha: 1)
        let luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
        onAccent = luminance > 0.55
            ? CGColor(srgbRed: 0.05, green: 0.05, blue: 0.06, alpha: 1)
            : CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 1)
        stripHeight = event == nil && track == nil ? 0 : 36
        titleHeight = title == nil && badge == nil ? 0 : 44
        switch layout {
        case .stack:
            rows = min(race.lapCount, max(0, maxRows))
            width = 400
            headerHeight = 118
            height = stripHeight + titleHeight + headerHeight + (rows > 0 ? CGFloat(rows) * 38 + 16 : 0) + 66
        case .wide:
            rows = min(race.lapCount, 3)
            width = 560
            headerHeight = 124
            height = stripHeight + titleHeight + headerHeight + 66
        }
        pixelWidth = Int((width * scale).rounded(.up))
        pixelHeight = Int((height * scale).rounded(.up))
        guard let context = CGContext(
            data: nil, width: pixelWidth, height: pixelHeight, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpace(name: CGColorSpace.sRGB)!,
            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
        else { fail("Could not create a drawing surface.") }
        self.context = context
    }

    private func white(_ alpha: CGFloat) -> CGColor { CGColor(srgbRed: 1, green: 1, blue: 1, alpha: alpha) }

    private func line(_ string: String, _ font: CTFont, _ color: CGColor, kern: CGFloat = 0) -> CTLine {
        let attributes: [NSAttributedString.Key: Any] = [
            NSAttributedString.Key(kCTFontAttributeName as String): font,
            NSAttributedString.Key(kCTForegroundColorAttributeName as String): color,
            NSAttributedString.Key(kCTKernAttributeName as String): kern,
        ]
        return CTLineCreateWithAttributedString(NSAttributedString(string: string, attributes: attributes))
    }

    /// Draws text vertically centred on `centerY` by cap height; returns its width.
    @discardableResult
    private func put(_ line: CTLine, x: CGFloat, centerY: CGFloat, font: CTFont, align: Align = .left) -> CGFloat {
        let lineWidth = CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil))
        context.textPosition = CGPoint(x: align == .left ? x : x - lineWidth, y: centerY + CTFontGetCapHeight(font) / 2)
        CTLineDraw(line, context)
        return lineWidth
    }

    private func hairline(at y: CGFloat) {
        context.setFillColor(white(0.14))
        context.fill(CGRect(x: 0, y: y, width: width, height: 1))
    }

    /// Redraws the panel as it should look `seconds` into the sequence.
    func draw(at seconds: Double) {
        let c = context
        c.saveGState()
        defer { c.restoreGState() }
        c.clear(CGRect(x: 0, y: 0, width: pixelWidth, height: pixelHeight))
        // Work top-down in reference points.
        c.translateBy(x: 0, y: CGFloat(pixelHeight))
        c.scaleBy(x: scale, y: -scale)
        c.textMatrix = CGAffineTransform(scaleX: 1, y: -1)

        let unitsPerSecond = Double(race.unitsPerSecond)
        let now = Int((seconds * unitsPerSecond).rounded())
        let laps = race.lapCount
        let done = race.completed(at: now)
        let started = now >= race.bounds[0]
        let finished = done == laps
        let best = race.best(afterLaps: done)
        func age(ofBound index: Int) -> Double { seconds - Double(race.bounds[index]) / unitsPerSecond }

        let frame = CGRect(x: 0, y: 0, width: width, height: height)
        c.addPath(CGPath(roundedRect: frame, cornerWidth: 16, cornerHeight: 16, transform: nil))
        c.clip()
        c.setFillColor(CGColor(srgbRed: 0.03, green: 0.04, blue: 0.05, alpha: 0.8))
        c.fill(frame)

        var y: CGFloat = 0

        if stripHeight > 0 {
            c.setFillColor(white(0.09))
            c.fill(CGRect(x: 0, y: 0, width: width, height: stripHeight))
            // With both, the event sits left and the track right; one alone sits left.
            if let first = event ?? track {
                put(line(first.uppercased(), stripFont, accent, kern: 1.8), x: pad, centerY: stripHeight / 2 + 1, font: stripFont)
            }
            if event != nil, let track {
                put(line(track.uppercased(), stripFont, white(0.9), kern: 1.8), x: width - pad, centerY: stripHeight / 2 + 1, font: stripFont, align: .right)
            }
            y += stripHeight
        }

        if titleHeight > 0 {
            if let title {
                put(line(title, titleFont, white(0.92), kern: 0.3), x: pad, centerY: y + titleHeight / 2 + 1, font: titleFont)
            }
            if let badge {
                put(line(badge.uppercased(), badgeFont, accent, kern: 1.3), x: width - pad, centerY: y + titleHeight / 2 + 1, font: badgeFont, align: .right)
            }
            y += titleHeight
            hairline(at: y)
        }

        // Current lap
        let labelY = y + (layout == .wide ? 35 : 31)
        let headLabel = finished ? "FINISHED" : "LAP \(done + 1)"
        let headWidth = put(line(headLabel, headLabelFont, accent, kern: 1.6), x: pad, centerY: labelY, font: headLabelFont)
        if !finished {
            put(line("/ \(laps)", headLabelFont, white(0.45), kern: 1.6), x: pad + headWidth + 7, centerY: labelY, font: headLabelFont)
        }
        let running = finished ? race.lap(laps - 1) : started ? now - race.bounds[done] : 0
        put(line(race.time(running, minutes: true), bigFont, white(started ? 1 : 0.5)),
            x: pad - 3, centerY: y + (layout == .wide ? 83 : 77), font: bigFont)

        // Lap list: under the current lap in the stack, beside it in the wide strip.
        let listLeft: CGFloat
        var rowY: CGFloat
        switch layout {
        case .stack:
            if rows > 0 { hairline(at: y + headerHeight) }
            listLeft = 0
            rowY = y + headerHeight + 8
        case .wide:
            c.setFillColor(white(0.14))
            c.fill(CGRect(x: listX, y: y, width: 1, height: headerHeight))
            listLeft = listX
            rowY = y + (headerHeight - CGFloat(rows) * rowHeight) / 2
        }
        let first = laps <= rows ? 0 : min(max(done - rows + 1, 0), laps - rows)
        for row in 0..<rows {
            let lap = first + row
            let complete = lap < done
            let current = lap == done && started
            let inBest = laps > race.window && best.map { lap >= $0.start && lap < $0.start + race.window } ?? false
            if complete {
                let flash = 1 - age(ofBound: lap + 1)
                if flash > 0 {
                    c.setFillColor(accent.copy(alpha: 0.5 * flash)!)
                    c.fill(CGRect(x: listLeft, y: rowY, width: width - listLeft, height: rowHeight))
                }
            }
            if inBest {
                c.setFillColor(accent)
                c.fill(CGRect(x: listLeft, y: rowY + 5, width: 5, height: rowHeight - 10))
            }
            let labelColor = inBest ? accent : white(complete ? 0.62 : current ? 0.9 : 0.3)
            put(line("LAP \(lap + 1)", rowLabelFont, labelColor, kern: 1.2),
                x: listLeft + (layout == .wide ? 20 : pad), centerY: rowY + rowHeight / 2, font: rowLabelFont)
            let value = complete ? race.time(race.lap(lap)) : "–"
            put(line(value, rowValueFont, white(complete ? 1 : 0.3)), x: width - pad, centerY: rowY + rowHeight / 2, font: rowValueFont, align: .right)
            rowY += rowHeight
        }

        // Combined consecutive laps
        let window = race.window
        var label = laps == window ? "\(window) LAPS" : "BEST \(window) LAPS"
        var value = started ? min(now, race.bounds[laps]) - race.bounds[0] : 0
        var isSet = false
        var setAge = Double.infinity
        if laps < window {
            label = "TOTAL"
            isSet = finished
            if finished { setAge = age(ofBound: laps) }
        } else if let best {
            value = best.total
            isSet = true
            setAge = age(ofBound: best.start + window)
        }
        let footer = CGRect(x: 0, y: height - footerHeight, width: width, height: footerHeight)
        if isSet {
            let flash = CGFloat(max(0, 1 - setAge / 0.8)) * 0.75
            let mixed = accentRGB.map { $0 + (1 - $0) * flash }
            c.setFillColor(CGColor(srgbRed: mixed[0], green: mixed[1], blue: mixed[2], alpha: 1))
        } else {
            c.setFillColor(white(0.08))
        }
        c.fill(footer)
        put(line(label, footLabelFont, isSet ? onAccent : accent, kern: 1.4), x: pad, centerY: footer.midY, font: footLabelFont)
        put(line(race.time(value, minutes: true), footValueFont, isSet ? onAccent : white(0.6)),
            x: width - pad, centerY: footer.midY, font: footValueFont, align: .right)
    }

    /// Copies the panel into a BGRA frame at pixel (x, y) from the top-left, converting to straight alpha.
    func blit(into base: UnsafeMutableRawPointer, bytesPerRow: Int, x: Int, y: Int) {
        var source = vImage_Buffer(data: context.data, height: vImagePixelCount(pixelHeight),
                                   width: vImagePixelCount(pixelWidth), rowBytes: context.bytesPerRow)
        var destination = vImage_Buffer(data: base + y * bytesPerRow + x * 4, height: vImagePixelCount(pixelHeight),
                                        width: vImagePixelCount(pixelWidth), rowBytes: bytesPerRow)
        // Alpha is the last byte for both BGRA and RGBA, so the RGBA routine applies as is.
        vImageUnpremultiplyData_RGBA8888(&source, &destination, vImage_Flags(kvImageNoFlags))
    }

    func image() -> CGImage { context.makeImage()! }
}

/// Pilot name and ID as a banner for the top of an upright video, `width` pixels wide, with an
/// optional line above them for the event and track.
func uprightHeading(title: String?, badge: String?, eyebrow: String?, accent: [CGFloat], width: Int) -> CGImage? {
    guard title != nil || badge != nil || eyebrow != nil else { return nil }
    let lift = eyebrow == nil ? 0 : 50
    let height = (title == nil && badge == nil ? 0 : 150) + lift
    guard let context = CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return nil }
    context.translateBy(x: 0, y: CGFloat(height))
    context.scaleBy(x: 1, y: -1)
    context.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
    func put(_ string: String, font: CTFont, color: CGColor, kern: CGFloat, x: CGFloat, centerY: CGFloat) {
        let attributes: [NSAttributedString.Key: Any] = [
            NSAttributedString.Key(kCTFontAttributeName as String): font,
            NSAttributedString.Key(kCTForegroundColorAttributeName as String): color,
            NSAttributedString.Key(kCTKernAttributeName as String): kern,
        ]
        context.textPosition = CGPoint(x: x, y: centerY + CTFontGetCapHeight(font) / 2)
        CTLineDraw(CTLineCreateWithAttributedString(NSAttributedString(string: string, attributes: attributes)), context)
    }
    context.setShadow(offset: CGSize(width: 0, height: -3), blur: 14, color: CGColor(srgbRed: 0, green: 0, blue: 0, alpha: 0.6))
    if let eyebrow {
        put(eyebrow.uppercased(), font: NSFont.systemFont(ofSize: 30, weight: .heavy) as CTFont,
            color: CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 0.85), kern: 4, x: 43, centerY: 24)
    }
    if let title {
        put(title, font: NSFont.systemFont(ofSize: 76, weight: .heavy) as CTFont,
            color: CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 1), kern: 0, x: 40, centerY: CGFloat(lift) + (badge == nil ? 75 : 46))
    }
    if let badge {
        put(badge.uppercased(), font: NSFont.systemFont(ofSize: 30, weight: .heavy) as CTFont,
            color: CGColor(srgbRed: accent[0], green: accent[1], blue: accent[2], alpha: 1), kern: 3, x: 43, centerY: CGFloat(lift) + (title == nil ? 75 : 120))
    }
    return context.makeImage()
}

// MARK: - Output

struct Placement {
    let frameWidth: Int
    let frameHeight: Int
    let x: Int
    let y: Int
}

func place(panel: Panel, frameWidth: Int, frameHeight: Int, position: String, margin: CGFloat) -> Placement {
    let inset = Int((margin * panel.scale).rounded())
    guard panel.pixelWidth + 2 * inset <= frameWidth, panel.pixelHeight + 2 * inset <= frameHeight else {
        fail("The timer panel (\(panel.pixelWidth)x\(panel.pixelHeight) px) doesn't fit in a \(frameWidth)x\(frameHeight) frame. "
            + "Try a smaller --scale or fewer --max-rows.")
    }
    let x: Int, y: Int
    switch position.trimmed.lowercased().replacingOccurrences(of: " ", with: "-") {
    case "tl", "top-left": (x, y) = (inset, inset)
    case "tr", "top-right": (x, y) = (frameWidth - panel.pixelWidth - inset, inset)
    case "bl", "bottom-left": (x, y) = (inset, frameHeight - panel.pixelHeight - inset)
    case "br", "bottom-right": (x, y) = (frameWidth - panel.pixelWidth - inset, frameHeight - panel.pixelHeight - inset)
    case "tc", "top-center": (x, y) = ((frameWidth - panel.pixelWidth) / 2, inset)
    case "bc", "bottom-center": (x, y) = ((frameWidth - panel.pixelWidth) / 2, frameHeight - panel.pixelHeight - inset)
    default: fail("Unknown position \"\(position)\". Use tl, tr, bl, br, tc or bc.")
    }
    return Placement(frameWidth: frameWidth, frameHeight: frameHeight, x: x, y: y)
}

func writeMovie(to url: URL, panel: Panel, placement: Placement, fps: FrameRate, frameCount: Int, label: String) {
    try? FileManager.default.removeItem(at: url)
    let writer: AVAssetWriter
    do {
        writer = try AVAssetWriter(outputURL: url, fileType: .mov)
    } catch {
        fail("Could not create \(url.path): \(error.localizedDescription)")
    }
    let settings: [String: Any] = [
        AVVideoCodecKey: AVVideoCodecType.proRes4444,
        AVVideoWidthKey: placement.frameWidth,
        AVVideoHeightKey: placement.frameHeight,
        AVVideoColorPropertiesKey: [
            AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
            AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
            AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
        ],
    ]
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
    input.expectsMediaDataInRealTime = false
    input.mediaTimeScale = CMTimeScale(fps.num)
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: placement.frameWidth,
        kCVPixelBufferHeightKey as String: placement.frameHeight,
    ])
    guard writer.canAdd(input) else { fail("This Mac can't encode ProRes 4444 at \(placement.frameWidth)x\(placement.frameHeight).") }
    writer.add(input)
    guard writer.startWriting() else { fail("Could not start writing: \(writer.error?.localizedDescription ?? "unknown error")") }
    writer.startSession(atSourceTime: .zero)
    guard let pool = adaptor.pixelBufferPool else { fail("Could not allocate video frames.") }

    func frameTime(_ frame: Int) -> CMTime {
        CMTime(value: CMTimeValue(frame * fps.den), timescale: CMTimeScale(fps.num))
    }

    var lastPercent = -1
    for frame in 0..<frameCount {
        autoreleasepool {
            while !input.isReadyForMoreMediaData {
                if writer.status == .failed { fail("Encoding failed: \(writer.error?.localizedDescription ?? "unknown error")") }
                usleep(500)
            }
            var pixelBuffer: CVPixelBuffer?
            CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pixelBuffer)
            guard let buffer = pixelBuffer else { fail("Could not allocate a video frame.") }

            panel.draw(at: Double(frame) * Double(fps.den) / Double(fps.num))
            CVPixelBufferLockBaseAddress(buffer, [])
            let base = CVPixelBufferGetBaseAddress(buffer)!
            let bytesPerRow = CVPixelBufferGetBytesPerRow(buffer)
            memset(base, 0, bytesPerRow * placement.frameHeight)
            panel.blit(into: base, bytesPerRow: bytesPerRow, x: placement.x, y: placement.y)
            CVPixelBufferUnlockBaseAddress(buffer, [])
            CVBufferSetAttachment(buffer, kCVImageBufferAlphaChannelModeKey, kCVImageBufferAlphaChannelMode_StraightAlpha, .shouldPropagate)

            if !adaptor.append(buffer, withPresentationTime: frameTime(frame)) {
                fail("Encoding failed: \(writer.error?.localizedDescription ?? "unknown error")")
            }
        }
        let percent = (frame + 1) * 100 / frameCount
        if percent != lastPercent {
            lastPercent = percent
            print("\r\(label)… \(percent)%", terminator: "")
            fflush(stdout)
        }
    }
    print("")
    input.markAsFinished()
    writer.endSession(atSourceTime: frameTime(frameCount))
    let finished = DispatchSemaphore(value: 0)
    writer.finishWriting { finished.signal() }
    finished.wait()
    guard writer.status == .completed else { fail("Could not finish the movie: \(writer.error?.localizedDescription ?? "unknown error")") }
}

func writeStill(to url: URL, panel: Panel, placement: Placement, seconds: Double, background: [CGFloat]?) {
    guard let context = CGContext(
        data: nil, width: placement.frameWidth, height: placement.frameHeight, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { fail("Could not create a drawing surface.") }
    if let rgb = background {
        context.setFillColor(CGColor(srgbRed: rgb[0], green: rgb[1], blue: rgb[2], alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: placement.frameWidth, height: placement.frameHeight))
    }
    panel.draw(at: seconds)
    context.draw(panel.image(), in: CGRect(
        x: placement.x, y: placement.frameHeight - placement.y - panel.pixelHeight,
        width: panel.pixelWidth, height: panel.pixelHeight))
    guard let destination = CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil) else {
        fail("Could not create \(url.path).")
    }
    CGImageDestinationAddImage(destination, context.makeImage()!, nil)
    guard CGImageDestinationFinalize(destination) else { fail("Could not write \(url.path).") }
}

struct ClipInfo {
    let fps: FrameRate
    let width: Int
    let height: Int
    /// The frame rate the stream's header claims, when that isn't how far apart its frames really are.
    /// Premiere goes by the header, so a sequence made from such a clip takes this rate instead.
    var claimedFPS: FrameRate?
}

func videoInfo(path: String) -> ClipInfo? {
    final class Box: @unchecked Sendable { var info: ClipInfo? }
    let box = Box()
    let loaded = DispatchSemaphore(value: 0)
    let asset = AVURLAsset(url: URL(fileURLWithPath: path))
    Task.detached {
        defer { loaded.signal() }
        guard let track = try? await asset.loadTracks(withMediaType: .video).first,
              let (size, transform, rate) = try? await track.load(.naturalSize, .preferredTransform, .nominalFrameRate),
              let fps = FrameRate.nearest(to: Double(rate)) else { return }
        let oriented = size.applying(transform)
        box.info = ClipInfo(fps: fps, width: Int(abs(oriented.width).rounded()), height: Int(abs(oriented.height).rounded()))
    }
    loaded.wait()
    return box.info ?? transportStreamInfo(path: path)
}

/// Frame rate and size of an MPEG transport stream (.ts), which AVFoundation can't open. HDZero and
/// other FPV goggles record these. Only the start of the file is read.
func transportStreamInfo(path: String) -> ClipInfo? {
    guard let handle = FileHandle(forReadingAtPath: path) else { return nil }
    defer { try? handle.close() }
    let data = [UInt8](handle.readData(ofLength: 8_000_000))
    guard data.count >= 376, data[0] == 0x47, data[188] == 0x47 else { return nil }

    var programMapPID: Int?
    var videoPID: Int?
    var hevc = false
    var timestamps: [Int] = []
    var stream: [UInt8] = []
    var offset = 0
    while offset + 188 <= data.count {
        let start = offset, end = offset + 188
        offset = end
        guard data[start] == 0x47 else { continue }
        let unitStart = data[start + 1] & 0x40 != 0
        let pid = Int(data[start + 1] & 0x1F) << 8 | Int(data[start + 2])
        let adaptation = (data[start + 3] >> 4) & 3
        var p = start + 4
        if adaptation & 2 != 0 { p += 1 + Int(data[start + 4]) }
        guard adaptation & 1 != 0, p < end else { continue }

        if pid == 0, unitStart, programMapPID == nil {
            let section = p + 1 + Int(data[p])
            guard section + 12 <= end else { continue }
            programMapPID = Int(data[section + 10] & 0x1F) << 8 | Int(data[section + 11])
        } else if pid == programMapPID, unitStart, videoPID == nil {
            let section = p + 1 + Int(data[p])
            guard section + 12 <= end else { continue }
            let sectionLength = Int(data[section + 1] & 0x0F) << 8 | Int(data[section + 2])
            let programInfoLength = Int(data[section + 10] & 0x0F) << 8 | Int(data[section + 11])
            var entry = section + 12 + programInfoLength
            let entriesEnd = min(section + 3 + sectionLength - 4, end)
            while entry + 5 <= entriesEnd {
                let streamType = data[entry]
                if streamType == 0x1B || streamType == 0x24 {
                    videoPID = Int(data[entry + 1] & 0x1F) << 8 | Int(data[entry + 2])
                    hevc = streamType == 0x24
                    break
                }
                entry += 5 + (Int(data[entry + 3] & 0x0F) << 8 | Int(data[entry + 4]))
            }
        } else if pid == videoPID {
            if unitStart, p + 14 <= end, data[p] == 0, data[p + 1] == 0, data[p + 2] == 1 {
                if data[p + 7] & 0x80 != 0 {
                    let b = (0..<5).map { Int(data[p + 9 + $0]) }
                    timestamps.append(((b[0] >> 1) & 7) << 30 | b[1] << 22 | (b[2] >> 1) << 15 | b[3] << 7 | b[4] >> 1)
                }
                p += 9 + Int(data[p + 8])
            }
            if p < end, stream.count < 500_000 { stream.append(contentsOf: data[p..<end]) }
        }
    }

    // Frame rate from the presentation timestamps (90 kHz), averaged so jitter doesn't matter.
    timestamps.sort()
    guard timestamps.count >= 10, let first = timestamps.first, let last = timestamps.last, last > first,
          let fps = FrameRate.nearest(to: 90000 * Double(timestamps.count - 1) / Double(last - first)) else { return nil }

    // Frame size from the stream's parameter sets.
    var starts: [Int] = []
    var i = 0
    while i + 3 <= stream.count {
        if stream[i] == 0 && stream[i + 1] == 0 && stream[i + 2] == 1 {
            starts.append(i + 3)
            i += 3
        } else {
            i += 1
        }
    }
    var parameterSets: [Int: [UInt8]] = [:]
    for (index, unitStart) in starts.enumerated() where unitStart < stream.count {
        var unitEnd = index + 1 < starts.count ? starts[index + 1] - 3 : stream.count
        while unitEnd > unitStart && stream[unitEnd - 1] == 0 { unitEnd -= 1 }
        let type = hevc ? Int(stream[unitStart] >> 1) & 0x3F : Int(stream[unitStart]) & 0x1F
        if parameterSets[type] == nil { parameterSets[type] = Array(stream[unitStart..<unitEnd]) }
    }
    let wanted = hevc ? [32, 33, 34] : [7, 8]
    let sets = wanted.compactMap { parameterSets[$0] }
    guard sets.count == wanted.count else { return nil }
    let pointers = sets.map { set -> UnsafePointer<UInt8> in
        let copy = UnsafeMutablePointer<UInt8>.allocate(capacity: set.count)
        copy.initialize(from: set, count: set.count)
        return UnsafePointer(copy)
    }
    defer { pointers.forEach { $0.deallocate() } }
    var description: CMVideoFormatDescription?
    let status = hevc
        ? CMVideoFormatDescriptionCreateFromHEVCParameterSets(
            allocator: nil, parameterSetCount: sets.count, parameterSetPointers: pointers, parameterSetSizes: sets.map(\.count),
            nalUnitHeaderLength: 4, extensions: nil, formatDescriptionOut: &description)
        : CMVideoFormatDescriptionCreateFromH264ParameterSets(
            allocator: nil, parameterSetCount: sets.count, parameterSetPointers: pointers, parameterSetSizes: sets.map(\.count),
            nalUnitHeaderLength: 4, formatDescriptionOut: &description)
    guard status == 0, let description else { return nil }
    let size = CMVideoFormatDescriptionGetDimensions(description)
    let header = hevc ? hevcHeaderFrameRate(sps: sets[1]) : nil
    return ClipInfo(fps: fps, width: Int(size.width), height: Int(size.height),
                    claimedFPS: header.flatMap { $0.label == fps.label ? nil : $0 })
}

/// The frame rate written in an HEVC sequence header (its VUI timing info), if there is one.
func hevcHeaderFrameRate(sps: [UInt8]) -> FrameRate? {
    // Drop the emulation-prevention bytes (00 00 03 becomes 00 00).
    var payload: [UInt8] = []
    var zeros = 0
    for byte in sps {
        if zeros >= 2 && byte == 3 {
            zeros = 0
            continue
        }
        payload.append(byte)
        zeros = byte == 0 ? zeros + 1 : 0
    }
    func bits(_ start: Int, _ count: Int) -> Int {
        (start..<start + count).reduce(0) { $0 << 1 | Int(payload[$1 / 8] >> (7 - $1 % 8)) & 1 }
    }
    // num_units_in_tick and time_scale (32 bits each) sit near the end of the header at no fixed bit
    // position. Rather than parse everything before them, look there for a pair that makes a standard rate.
    let total = payload.count * 8
    var offset = total - 64
    while offset >= max(0, total - 264) {
        let tick = bits(offset, 32), timeScale = bits(offset + 32, 32)
        if (1...5000).contains(tick), timeScale > tick,
           let match = FrameRate.standard.first(where: { abs($0.value - Double(timeScale) / Double(tick)) < 0.005 }) {
            return match
        }
        offset -= 1
    }
    return nil
}

/// `<base>-1.<ext>` in `folder`, or one past the highest number already there, so an earlier file
/// for the same run is never overwritten.
func nextNumbered(in folder: URL, base: String, ext: String) -> URL {
    let last = numberedFiles(in: folder, base: base, ext: ext).last.flatMap { url -> Int? in
        Int(url.deletingPathExtension().lastPathComponent.dropFirst(base.count + 1))
    }
    return folder.appendingPathComponent("\(base)-\((last ?? 0) + 1).\(ext)")
}

// MARK: - Upright (9:16) video for Shorts, TikTok and Reels

/// A clip AVFoundation can read. `offset` is how far into the original clip this file's timeline starts.
struct ReadableClip {
    let url: URL
    let offset: Double
    let temporary: Bool
}

struct ClipTracks: @unchecked Sendable {
    let video: AVAssetTrack
    let duration: Double
}

func loadTracks(of asset: AVURLAsset) -> ClipTracks? {
    final class Box: @unchecked Sendable { var tracks: ClipTracks? }
    let box = Box()
    let loaded = DispatchSemaphore(value: 0)
    Task.detached {
        defer { loaded.signal() }
        guard let video = try? await asset.loadTracks(withMediaType: .video).first,
              let duration = try? await asset.load(.duration) else { return }
        box.tracks = ClipTracks(video: video, duration: duration.seconds)
    }
    loaded.wait()
    return box.tracks
}

/// Splits an Annex-B elementary stream into its NAL units, without their start codes.
func nalUnits(in stream: [UInt8]) -> [ArraySlice<UInt8>] {
    var starts: [Int] = []
    var i = 0
    while i + 3 <= stream.count {
        if stream[i] == 0 && stream[i + 1] == 0 && stream[i + 2] == 1 {
            starts.append(i + 3)
            i += 3
        } else {
            i += 1
        }
    }
    var units: [ArraySlice<UInt8>] = []
    for (index, start) in starts.enumerated() {
        var end = index + 1 < starts.count ? starts[index + 1] - 3 : stream.count
        while end > start && stream[end - 1] == 0 { end -= 1 }
        if end > start { units.append(stream[start..<end]) }
    }
    return units
}

func makeSampleBuffer(_ bytes: [UInt8], format: CMFormatDescription, timing: CMSampleTimingInfo, sync: Bool) -> CMSampleBuffer? {
    var block: CMBlockBuffer?
    guard CMBlockBufferCreateWithMemoryBlock(
        allocator: kCFAllocatorDefault, memoryBlock: nil, blockLength: bytes.count, blockAllocator: kCFAllocatorDefault,
        customBlockSource: nil, offsetToData: 0, dataLength: bytes.count, flags: kCMBlockBufferAssureMemoryNowFlag, blockBufferOut: &block) == noErr,
        let block, CMBlockBufferReplaceDataBytes(with: bytes, blockBuffer: block, offsetIntoDestination: 0, dataLength: bytes.count) == noErr
    else { return nil }
    var timing = timing
    var size = bytes.count
    var sample: CMSampleBuffer?
    guard CMSampleBufferCreateReady(
        allocator: kCFAllocatorDefault, dataBuffer: block, formatDescription: format, sampleCount: 1,
        sampleTimingEntryCount: 1, sampleTimingArray: &timing, sampleSizeEntryCount: 1, sampleSizeArray: &size, sampleBufferOut: &sample) == noErr,
        let sample else { return nil }
    if !sync, let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: true), CFArrayGetCount(attachments) > 0 {
        let entry = unsafeBitCast(CFArrayGetValueAtIndex(attachments, 0), to: CFMutableDictionary.self)
        CFDictionarySetValue(entry, Unmanaged.passUnretained(kCMSampleAttachmentKey_NotSync).toOpaque(), Unmanaged.passUnretained(kCFBooleanTrue).toOpaque())
    }
    return sample
}

/// Waits for a writer input to take more data. False if the writer has failed or stalled.
func waitUntilReady(_ input: AVAssetWriterInput, _ writer: AVAssetWriter) -> Bool {
    var waited = 0
    while !input.isReadyForMoreMediaData {
        if writer.status != .writing || waited > 60_000_000 { return false }
        usleep(500)
        waited += 500
    }
    return true
}

/// Rewraps the picture from the part of a transport stream (.ts) covering `start` to `end` seconds
/// as a .mov that AVFoundation can read, without re-encoding it. Sound is left behind. The caller
/// removes the temporary file.
func rewrapTransportStream(path: String, from start: Double, to end: Double) -> ReadableClip? {
    guard let data = try? Data(contentsOf: URL(fileURLWithPath: path), options: .alwaysMapped), data.count >= 376 else { return nil }

    struct Unit {
        var pts: Int
        var bytes: [UInt8] = []
    }
    var programMapPID: Int?
    var videoPID: Int?
    var hevc = false
    var origin: Int?            // first video timestamp: the clip's time zero
    var video: [Unit] = []      // from the last keyframe at or before `start`
    var open: Unit?
    var pastEnd = false

    func nalType(_ nal: ArraySlice<UInt8>) -> Int {
        hevc ? Int(nal[nal.startIndex] >> 1) & 0x3F : Int(nal[nal.startIndex]) & 0x1F
    }
    func isKeyframeType(_ type: Int) -> Bool { hevc ? (16...21).contains(type) : type == 5 }
    func close() {
        guard let unit = open, let origin else { return }
        open = nil
        let time = Double(unit.pts - origin) / 90000
        if time > end + 0.1 {
            pastEnd = true
            return
        }
        if nalUnits(in: Array(unit.bytes.prefix(2000))).contains(where: { isKeyframeType(nalType($0)) }) {
            if time <= start { video.removeAll(keepingCapacity: true) }
            video.append(unit)
        } else if !video.isEmpty {
            video.append(unit)
        }
    }

    data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
        let bytes = raw.bindMemory(to: UInt8.self)
        var offset = 0
        while offset + 188 <= bytes.count, !pastEnd {
            let packet = offset, packetEnd = offset + 188
            offset = packetEnd
            guard bytes[packet] == 0x47 else { continue }
            let unitStart = bytes[packet + 1] & 0x40 != 0
            let pid = Int(bytes[packet + 1] & 0x1F) << 8 | Int(bytes[packet + 2])
            let adaptation = (bytes[packet + 3] >> 4) & 3
            var p = packet + 4
            if adaptation & 2 != 0 { p += 1 + Int(bytes[packet + 4]) }
            guard adaptation & 1 != 0, p < packetEnd else { continue }

            if pid == 0, unitStart, programMapPID == nil {
                let section = p + 1 + Int(bytes[p])
                guard section + 12 <= packetEnd else { continue }
                programMapPID = Int(bytes[section + 10] & 0x1F) << 8 | Int(bytes[section + 11])
            } else if pid == programMapPID, unitStart, videoPID == nil {
                let section = p + 1 + Int(bytes[p])
                guard section + 12 <= packetEnd else { continue }
                let sectionLength = Int(bytes[section + 1] & 0x0F) << 8 | Int(bytes[section + 2])
                var entry = section + 12 + (Int(bytes[section + 10] & 0x0F) << 8 | Int(bytes[section + 11]))
                let entriesEnd = min(section + 3 + sectionLength - 4, packetEnd)
                while entry + 5 <= entriesEnd {
                    let streamType = bytes[entry]
                    if streamType == 0x1B || streamType == 0x24 {
                        videoPID = Int(bytes[entry + 1] & 0x1F) << 8 | Int(bytes[entry + 2])
                        hevc = streamType == 0x24
                        break
                    }
                    entry += 5 + (Int(bytes[entry + 3] & 0x0F) << 8 | Int(bytes[entry + 4]))
                }
            } else if pid == videoPID {
                if unitStart, p + 14 <= packetEnd, bytes[p] == 0, bytes[p + 1] == 0, bytes[p + 2] == 1 {
                    close()
                    if bytes[p + 7] & 0x80 != 0 {
                        let t = p + 9
                        let pts = (Int(bytes[t] >> 1) & 7) << 30 | Int(bytes[t + 1]) << 22 | Int(bytes[t + 2] >> 1) << 15
                            | Int(bytes[t + 3]) << 7 | Int(bytes[t + 4] >> 1)
                        if origin == nil { origin = pts }
                        open = Unit(pts: pts)
                    }
                    p += 9 + Int(bytes[p + 8])
                }
                guard p < packetEnd else { continue }
                open?.bytes.append(contentsOf: UnsafeBufferPointer(rebasing: bytes[p..<packetEnd]))
            }
        }
    }
    close()
    guard let origin, !video.isEmpty else { return nil }

    // Video format from the first keyframe's parameter sets.
    var parameterSets: [Int: [UInt8]] = [:]
    for nal in nalUnits(in: video[0].bytes) where parameterSets[nalType(nal)] == nil { parameterSets[nalType(nal)] = Array(nal) }
    let wanted = hevc ? [32, 33, 34] : [7, 8]
    let sets = wanted.compactMap { parameterSets[$0] }
    guard sets.count == wanted.count else { return nil }
    let pointers = sets.map { set -> UnsafePointer<UInt8> in
        let copy = UnsafeMutablePointer<UInt8>.allocate(capacity: set.count)
        copy.initialize(from: set, count: set.count)
        return UnsafePointer(copy)
    }
    defer { pointers.forEach { $0.deallocate() } }
    var format: CMVideoFormatDescription?
    let status = hevc
        ? CMVideoFormatDescriptionCreateFromHEVCParameterSets(
            allocator: nil, parameterSetCount: sets.count, parameterSetPointers: pointers, parameterSetSizes: sets.map(\.count),
            nalUnitHeaderLength: 4, extensions: nil, formatDescriptionOut: &format)
        : CMVideoFormatDescriptionCreateFromH264ParameterSets(
            allocator: nil, parameterSetCount: sets.count, parameterSetPointers: pointers, parameterSetSizes: sets.map(\.count),
            nalUnitHeaderLength: 4, formatDescriptionOut: &format)
    guard status == noErr, let format else { return nil }

    let url = FileManager.default.temporaryDirectory.appendingPathComponent("laptimer-\(UUID().uuidString).mov")
    guard let writer = try? AVAssetWriter(outputURL: url, fileType: .mov) else { return nil }
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: nil, sourceFormatHint: format)
    input.expectsMediaDataInRealTime = false
    guard writer.canAdd(input) else { return nil }
    writer.add(input)
    guard writer.startWriting() else { return nil }
    func time(_ ticks: Int) -> CMTime { CMTime(value: CMTimeValue(ticks), timescale: 90000) }
    let firstTicks = video[0].pts - origin
    writer.startSession(atSourceTime: time(firstTicks))

    var ok = true
    for (index, unit) in video.enumerated() where ok {
        // Length-prefixed NAL units; parameter sets and delimiters live in the format description instead.
        var framed: [UInt8] = []
        framed.reserveCapacity(unit.bytes.count + 16)
        var sync = false
        for nal in nalUnits(in: unit.bytes) {
            let type = nalType(nal)
            if hevc ? (32...38).contains(type) : (7...9).contains(type) { continue }
            if isKeyframeType(type) { sync = true }
            let count = UInt32(nal.count)
            framed += [UInt8(count >> 24), UInt8(count >> 16 & 0xFF), UInt8(count >> 8 & 0xFF), UInt8(count & 0xFF)]
            framed += nal
        }
        let duration = index + 1 < video.count ? max(1, video[index + 1].pts - unit.pts) : 1500
        let timing = CMSampleTimingInfo(duration: time(duration), presentationTimeStamp: time(unit.pts - origin), decodeTimeStamp: .invalid)
        if let sample = makeSampleBuffer(framed, format: format, timing: timing, sync: sync), waitUntilReady(input, writer) {
            ok = input.append(sample)
        } else {
            ok = false
        }
    }
    input.markAsFinished()
    let finished = DispatchSemaphore(value: 0)
    writer.finishWriting { finished.signal() }
    finished.wait()
    guard ok, writer.status == .completed else {
        try? FileManager.default.removeItem(at: url)
        return nil
    }
    return ReadableClip(url: url, offset: Double(firstTicks) / 90000, temporary: true)
}

/// The sound for a run's upright video: a file named after the run in a "music" folder beside the marker folder.
func findMusic(forMarkers path: String, run: String) -> URL? {
    let track = URL(fileURLWithPath: path).standardizedFileURL.deletingLastPathComponent().deletingLastPathComponent()
    let formats: Set<String> = ["mp3", "m4a", "aac", "wav", "aif", "aiff", "caf", "flac"]
    for folder in subfolders(of: track.path) where (folder as NSString).lastPathComponent.lowercased() == "music" {
        for item in ((try? FileManager.default.contentsOfDirectory(atPath: folder)) ?? []).sorted() {
            let url = URL(fileURLWithPath: folder).appendingPathComponent(item)
            if formats.contains(url.pathExtension.lowercased()), url.deletingPathExtension().lastPathComponent.lowercased() == run.lowercased() {
                return url
            }
        }
    }
    return nil
}

struct SoundTrack: @unchecked Sendable {
    let track: AVAssetTrack
    let duration: Double
}

func loadSound(of asset: AVURLAsset) -> SoundTrack? {
    final class Box: @unchecked Sendable { var sound: SoundTrack? }
    let box = Box()
    let loaded = DispatchSemaphore(value: 0)
    Task.detached {
        defer { loaded.signal() }
        guard let track = try? await asset.loadTracks(withMediaType: .audio).first,
              let duration = try? await asset.load(.duration) else { return }
        box.sound = SoundTrack(track: track, duration: duration.seconds)
    }
    loaded.wait()
    return box.sound
}

/// Where a race clip sits on its Premiere timeline, read from a saved project file.
struct TimelinePlacement {
    let project: String
    let sequence: String
    /// The clip time showing at the very start of the sequence.
    let clipTimeAtSequenceStart: Double
    /// The same for the run's timer overlay, if it is on the timeline. An overlay is made in the clip's
    /// own time, so the two agree unless the overlay has been slid along the clip.
    let timerTimeAtSequenceStart: Double?
    let sequenceDuration: Double

    /// How far the timer overlay has been slid from the laps it measured.
    var timerSlip: Double { timerTimeAtSequenceStart.map { $0 - clipTimeAtSequenceStart } ?? 0 }
}

/// Unpacks a gzip file, which is what a .prproj is.
func gunzipped(_ data: Data) -> Data? {
    let bytes = [UInt8](data.prefix(1024))
    guard data.count > 18, bytes[0] == 0x1F, bytes[1] == 0x8B, bytes[2] == 8 else { return nil }
    let flags = bytes[3]
    var index = 10
    if flags & 0x04 != 0 { index += 2 + Int(bytes[index]) + Int(bytes[index + 1]) << 8 }
    for flag in [UInt8(0x08), 0x10] where flags & flag != 0 {
        while index < bytes.count, bytes[index] != 0 { index += 1 }
        index += 1
    }
    if flags & 0x02 != 0 { index += 2 }
    guard index < bytes.count, index < data.count - 8 else { return nil }
    return try? (data.subdata(in: index..<data.count - 8) as NSData).decompressed(using: .zlib) as Data
}

/// Finds the sequence that uses `clipPath` in a Premiere project and reports where the clip sits in it.
func timelinePlacement(ofClip clipPath: String, inProject file: URL) -> TimelinePlacement? {
    guard let packed = try? Data(contentsOf: file), let xml = gunzipped(packed),
          let document = try? XMLDocument(data: xml), let root = document.rootElement() else { return nil }
    // A project is a flat list of objects that point at each other by id.
    var byID: [String: XMLElement] = [:]
    var byUID: [String: XMLElement] = [:]
    for case let element as XMLElement in root.children ?? [] {
        if let id = element.attribute(forName: "ObjectID")?.stringValue { byID[id] = element }
        if let uid = element.attribute(forName: "ObjectUID")?.stringValue { byUID[uid] = element }
    }
    func inside(_ element: XMLElement, _ name: String) -> [XMLElement] {
        ((try? element.nodes(forXPath: ".//\(name)")) ?? []).compactMap { $0 as? XMLElement }
    }
    func target(_ element: XMLElement) -> XMLElement? {
        if let id = element.attribute(forName: "ObjectRef")?.stringValue { return byID[id] }
        if let uid = element.attribute(forName: "ObjectURef")?.stringValue { return byUID[uid] }
        return nil
    }
    // Premiere counts time in ticks.
    func seconds(_ element: XMLElement, _ name: String) -> Double {
        (inside(element, name).first?.stringValue).flatMap { Double($0) }.map { $0 / 254_016_000_000 } ?? 0
    }
    let clipName = (clipPath as NSString).lastPathComponent.lowercased()
    let wanted = ((clipName as NSString).deletingPathExtension, clipName)
    var found: [TimelinePlacement] = []
    for sequence in root.elements(forName: "Sequence") {
        var duration = 0.0
        var clipTimeAtStart: Double?
        var timerTimeAtStart: Double?
        // Sequence > track groups > tracks > the items on each track.
        for group in inside(sequence, "Second").compactMap(target) {
            for track in inside(group, "Track").compactMap(target) {
                for item in inside(track, "TrackItem").compactMap(target) {
                    let start = seconds(item, "Start")
                    duration = max(duration, seconds(item, "End"))
                    guard item.name == "VideoClipTrackItem",
                          let subclip = inside(item, "SubClip").first.flatMap(target),
                          let clip = subclip.elements(forName: "Clip").first.flatMap(target),
                          let source = inside(clip, "Source").first.flatMap(target),
                          let media = inside(source, "Media").first.flatMap(target) else { continue }
                    let path = media.elements(forName: "ActualMediaFilePath").first?.stringValue
                        ?? media.elements(forName: "FilePath").first?.stringValue ?? ""
                    let file = (path as NSString).lastPathComponent.lowercased()
                    if file == clipName, clipTimeAtStart == nil {
                        clipTimeAtStart = seconds(clip, "InPoint") - start
                    } else if file.hasPrefix(wanted.0 + "-"), file.hasSuffix(".mov"), timerTimeAtStart == nil {
                        timerTimeAtStart = seconds(clip, "InPoint") - start
                    }
                }
            }
        }
        if let clipTimeAtStart {
            let name = sequence.elements(forName: "Name").first?.stringValue ?? inside(sequence, "Name").first?.stringValue ?? "the"
            found.append(TimelinePlacement(project: file.lastPathComponent, sequence: name, clipTimeAtSequenceStart: clipTimeAtStart,
                                           timerTimeAtSequenceStart: timerTimeAtStart, sequenceDuration: duration))
        }
    }
    // A sequence named after the clip wins over any other that happens to use it.
    return found.first { [wanted.0, wanted.1].contains($0.sequence.lowercased()) } ?? found.first
}

/// The saved Premiere projects around a marker file, newest first, auto-saves included.
func projectFiles(near markersPath: String) -> [URL] {
    var folder = URL(fileURLWithPath: markersPath).standardizedFileURL.deletingLastPathComponent()
    var files: [URL] = []
    for _ in 0..<3 {
        folder = folder.deletingLastPathComponent()
        for place in [folder, folder.appendingPathComponent("Adobe Premiere Pro Auto-Save")] {
            files += ((try? FileManager.default.contentsOfDirectory(at: place, includingPropertiesForKeys: [.contentModificationDateKey])) ?? [])
                .filter { $0.pathExtension.lowercased() == "prproj" }
        }
    }
    func modified(_ url: URL) -> Date { (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast }
    return Array(files.sorted { modified($0) > modified($1) }.prefix(4))
}

/// The file names of everything imported into the newest Premiere project near a marker file, in lower case.
func premiereMediaNames(near markersPath: String) -> [String] {
    guard let file = projectFiles(near: markersPath).first, let packed = try? Data(contentsOf: file), let xml = gunzipped(packed),
          let pattern = try? NSRegularExpression(pattern: "<ActualMediaFilePath>([^<]*)</ActualMediaFilePath>") else { return [] }
    let text = String(decoding: xml, as: UTF8.self)
    var names = Set<String>()
    for match in pattern.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
        if let range = Range(match.range(at: 1), in: text) { names.insert((String(text[range]) as NSString).lastPathComponent.lowercased()) }
    }
    return names.sorted()
}

/// Shifts a sample buffer's timestamps.
func retimed(_ buffer: CMSampleBuffer, by shift: CMTime) -> CMSampleBuffer? {
    var count: CMItemCount = 0
    CMSampleBufferGetSampleTimingInfoArray(buffer, entryCount: 0, arrayToFill: nil, entriesNeededOut: &count)
    var timing = [CMSampleTimingInfo](repeating: CMSampleTimingInfo(), count: count)
    CMSampleBufferGetSampleTimingInfoArray(buffer, entryCount: count, arrayToFill: &timing, entriesNeededOut: &count)
    for index in timing.indices {
        timing[index].presentationTimeStamp = timing[index].presentationTimeStamp + shift
        if timing[index].decodeTimeStamp.isValid { timing[index].decodeTimeStamp = timing[index].decodeTimeStamp + shift }
    }
    var moved: CMSampleBuffer?
    CMSampleBufferCreateCopyWithNewTiming(allocator: kCFAllocatorDefault, sampleBuffer: buffer, sampleTimingEntryCount: count, sampleTimingArray: &timing, sampleBufferOut: &moved)
    return moved
}

/// The part of a frame that holds picture, in Core Image coordinates: FPV recordings are often a 4:3
/// picture with black bars either side.
func pictureRect(in frame: CVPixelBuffer) -> CGRect {
    let full = CGRect(x: 0, y: 0, width: CVPixelBufferGetWidth(frame), height: CVPixelBufferGetHeight(frame))
    guard CVPixelBufferIsPlanar(frame) else { return full }
    CVPixelBufferLockBaseAddress(frame, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(frame, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddressOfPlane(frame, 0) else { return full }
    let width = CVPixelBufferGetWidthOfPlane(frame, 0), height = CVPixelBufferGetHeightOfPlane(frame, 0)
    let stride = CVPixelBufferGetBytesPerRowOfPlane(frame, 0)
    let luma = base.assumingMemoryBound(to: UInt8.self)
    func isBlack(column x: Int) -> Bool {
        var sum = 0, count = 0, y = 0
        while y < height {
            sum += Int(luma[y * stride + x])
            count += 1
            y += 4
        }
        return sum / max(count, 1) < 28
    }
    let limit = width / 4
    var left = 0
    while left < limit && isBlack(column: left) { left += 1 }
    var right = 0
    while right < limit && isBlack(column: width - 1 - right) { right += 1 }
    // A dark frame reads as all bar, and a sliver isn't worth cropping: leave both alone.
    let bar = min(left, right) & ~1
    guard bar >= 8, left < limit, right < limit else { return full }
    return CGRect(x: bar, y: 0, width: width - 2 * bar, height: height)
}

/// The finished videos the tool can make from a run.
enum VideoShape {
    /// 1920x1080 for YouTube: the whole frame with the timer box in its corner.
    case landscape
    /// 1080x1920 for Shorts, TikTok and Reels: heading, picture, then the timer underneath.
    case upright

    var name: String { self == .landscape ? "16:9" : "9:16" }
    var folder: String { self == .landscape ? "landscape" : "vertical" }
    var canvas: CGRect {
        self == .landscape ? CGRect(x: 0, y: 0, width: 1920, height: 1080) : CGRect(x: 0, y: 0, width: 1080, height: 1920)
    }
}

/// Where a run's finished videos of one shape go: a folder named for the shape, beside "overlays".
func finishedFolder(_ shape: VideoShape, forOverlayFolder folder: URL) -> URL {
    let parent = folder.lastPathComponent.lowercased() == "overlays" ? folder.deletingLastPathComponent() : folder
    return parent.appendingPathComponent(shape.folder, isDirectory: true)
}

/// Writes a finished H.264 .mp4 of one run in the given shape, with the timer and pilot heading
/// drawn in. `sound` is a music file and the clip time its first moment belongs at; without it the
/// video is silent. Returns what went wrong, or nil.
func writeFinishedVideo(shape: VideoShape, clip: ReadableClip, race: Race, from start: Double, to end: Double, accent: [CGFloat],
                        title: String?, badge: String?, event: String?, track: String?,
                        sound: (url: URL, clipTimeAtStart: Double)?, options: Options, to output: URL, label: String) -> String? {
    let asset = AVURLAsset(url: clip.url)
    guard let tracks = loadTracks(of: asset) else { return "the clip can't be read" }
    let first = CMTime(seconds: max(0, start - clip.offset), preferredTimescale: 90000)
    let last = CMTime(seconds: min(end - clip.offset, tracks.duration), preferredTimescale: 90000)
    guard last > first else { return "the markers fall outside the clip" }

    guard let reader = try? AVAssetReader(asset: asset) else { return "the clip can't be read" }
    reader.timeRange = CMTimeRange(start: first, end: last)
    let frames = AVAssetReaderTrackOutput(track: tracks.video, outputSettings: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
    ])
    frames.alwaysCopiesSampleData = false
    guard reader.canAdd(frames) else { return "the clip can't be decoded" }
    reader.add(frames)

    let canvas = shape.canvas
    try? FileManager.default.removeItem(at: output)
    guard let writer = try? AVAssetWriter(outputURL: output, fileType: .mp4) else { return "the output file can't be created" }
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: Int(canvas.width),
        AVVideoHeightKey: Int(canvas.height),
        AVVideoColorPropertiesKey: [
            AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
            AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
            AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
        ],
        AVVideoCompressionPropertiesKey: [
            AVVideoAverageBitRateKey: shape == .landscape ? 16_000_000 : 14_000_000,
            AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
            AVVideoMaxKeyFrameIntervalKey: 120,
            AVVideoExpectedSourceFrameRateKey: 60,
        ],
    ])
    input.expectsMediaDataInRealTime = false
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: Int(canvas.width),
        kCVPixelBufferHeightKey as String: Int(canvas.height),
        kCVPixelBufferIOSurfacePropertiesKey as String: [String: Any](),
    ])
    guard writer.canAdd(input) else { return "this Mac can't encode the video" }
    writer.add(input)

    // Sound: the stretch of the music file that plays under this video, faded out over the last second.
    var soundReader: AVAssetReader?
    var soundOutput: AVAssetReaderAudioMixOutput?
    var soundInput: AVAssetWriterInput?
    var soundShift = CMTime.zero
    if let sound {
        let music = AVURLAsset(url: sound.url)
        // Music time and this file's time differ by a fixed amount.
        let shift = sound.clipTimeAtStart - clip.offset
        let from = max(0, first.seconds - shift)
        if let loaded = loadSound(of: music), let musicReader = try? AVAssetReader(asset: music) {
            let to = min(loaded.duration, last.seconds - shift)
            if to > from {
                func at(_ seconds: Double) -> CMTime { CMTime(seconds: seconds, preferredTimescale: 48000) }
                musicReader.timeRange = CMTimeRange(start: at(from), end: at(to))
                let mixed = AVAssetReaderAudioMixOutput(audioTracks: [loaded.track], audioSettings: [
                    AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false,
                    AVLinearPCMIsBigEndianKey: false, AVLinearPCMIsNonInterleaved: false, AVSampleRateKey: 48000, AVNumberOfChannelsKey: 2,
                ])
                let levels = AVMutableAudioMixInputParameters(track: loaded.track)
                if from > 0.05 { levels.setVolumeRamp(fromStartVolume: 0, toEndVolume: 1, timeRange: CMTimeRange(start: at(from), duration: at(0.4))) }
                let fade = min(1, (to - from) / 2)
                levels.setVolumeRamp(fromStartVolume: 1, toEndVolume: 0, timeRange: CMTimeRange(start: at(to - fade), duration: at(fade)))
                let mix = AVMutableAudioMix()
                mix.inputParameters = [levels]
                mixed.audioMix = mix
                let encoded = AVAssetWriterInput(mediaType: .audio, outputSettings: [
                    AVFormatIDKey: kAudioFormatMPEG4AAC, AVNumberOfChannelsKey: 2, AVSampleRateKey: 48000, AVEncoderBitRateKey: 192_000,
                ])
                encoded.expectsMediaDataInRealTime = false
                if musicReader.canAdd(mixed), writer.canAdd(encoded) {
                    musicReader.add(mixed)
                    writer.add(encoded)
                    soundReader = musicReader
                    soundOutput = mixed
                    soundInput = encoded
                    soundShift = at(shift)
                }
            }
        }
        if soundInput == nil { print("The music in \(sound.url.lastPathComponent) couldn't be used, so this video is silent.") }
    }

    guard reader.startReading() else { return reader.error?.localizedDescription ?? "the clip can't be read" }
    guard writer.startWriting() else { return writer.error?.localizedDescription ?? "the output file can't be written" }
    writer.startSession(atSourceTime: first)

    // The sound is fed from its own queue, so neither stream has to wait for the other to be handed over.
    let soundDone = DispatchSemaphore(value: 0)
    if let soundReader, let soundOutput, let soundInput, soundReader.startReading() {
        let shift = soundShift
        soundInput.requestMediaDataWhenReady(on: DispatchQueue(label: "laptimer.sound")) {
            while soundInput.isReadyForMoreMediaData {
                guard let buffer = soundOutput.copyNextSampleBuffer(), let moved = retimed(buffer, by: shift), soundInput.append(moved) else {
                    soundInput.markAsFinished()
                    soundDone.signal()
                    return
                }
            }
        }
    } else {
        soundInput?.markAsFinished()
        soundInput = nil
    }
    guard let pool = adaptor.pixelBufferPool else { return "could not allocate video frames" }

    // Upright, top-down: heading, picture, timer. The bottom fifth is left clear for the apps' own captions.
    // Landscape: the whole frame with the timer box in its corner, the way the Premiere overlay sits.
    // The banner grows upwards, so the picture stays put whatever is in it.
    let pictureTop: CGFloat = 409
    let eyebrow = [event, track].compactMap { $0 }.joined(separator: "  ·  ")
    let banner = shape == .landscape ? nil
        : uprightHeading(title: title, badge: badge, eyebrow: eyebrow.isEmpty ? nil : eyebrow, accent: accent, width: Int(canvas.width))
    let heading = banner.map { image in
        CIImage(cgImage: image).transformed(by: CGAffineTransform(translationX: 0, y: canvas.height - pictureTop + 24))
    }
    let panel = shape == .upright
        ? Panel(race: race, scale: 880.0 / 560, accent: accent, title: nil, maxRows: 3, layout: .wide)
        : Panel(race: race, scale: CGFloat(options.userScale), accent: accent, title: title, badge: badge,
                event: event, track: track, maxRows: options.maxRows)
    let corner = shape == .landscape
        ? place(panel: panel, frameWidth: Int(canvas.width), frameHeight: Int(canvas.height), position: options.position, margin: CGFloat(options.margin))
        : nil
    let renderer = CIContext(options: [.cacheIntermediates: false])
    let colorSpace = CGColorSpace(name: CGColorSpace.itur_709)!
    let dim = ["inputRVector": CIVector(x: 0.32, y: 0, z: 0, w: 0), "inputGVector": CIVector(x: 0, y: 0.32, z: 0, w: 0),
               "inputBVector": CIVector(x: 0, y: 0, z: 0.34, w: 0)]

    var problem: String?
    var picture: CGRect?
    var lastPercent = -1
    let span = max(last.seconds - first.seconds, 0.001)
    while problem == nil, let sample = frames.copyNextSampleBuffer() {
        autoreleasepool {
            guard let frame = CMSampleBufferGetImageBuffer(sample) else { return }
            let time = CMSampleBufferGetPresentationTimeStamp(sample)
            panel.draw(at: time.seconds + clip.offset)
            let timer = CIImage(cgImage: panel.image())
            var image: CIImage
            if let corner {
                // The whole frame, scaled to fit, on black.
                let source = CIImage(cvPixelBuffer: frame)
                let fit = min(canvas.width / source.extent.width, canvas.height / source.extent.height)
                let scaled = source.transformed(by: CGAffineTransform(scaleX: fit, y: fit))
                image = scaled
                    .transformed(by: CGAffineTransform(translationX: (canvas.width - scaled.extent.width) / 2, y: (canvas.height - scaled.extent.height) / 2))
                    .composited(over: CIImage(color: .black).cropped(to: canvas))
                image = timer
                    .transformed(by: CGAffineTransform(translationX: CGFloat(corner.x), y: canvas.height - CGFloat(corner.y) - CGFloat(panel.pixelHeight)))
                    .composited(over: image)
            } else {
            if picture == nil { picture = pictureRect(in: frame) }
            guard let rect = picture else { return }

            let cropped = CIImage(cvPixelBuffer: frame).cropped(to: rect)
                .transformed(by: CGAffineTransform(translationX: -rect.minX, y: -rect.minY))
            let fit = canvas.width / rect.width
            let pictureHeight = (rect.height * fit).rounded()
            let foreground = cropped.transformed(by: CGAffineTransform(scaleX: fit, y: fit))
                .transformed(by: CGAffineTransform(translationX: 0, y: canvas.height - pictureTop - pictureHeight))
            // Background: the same picture filling the frame, blurred and dimmed. Blurred at quarter size to keep it cheap.
            let small = CGRect(x: 0, y: 0, width: canvas.width / 4, height: canvas.height / 4)
            let fill = max(small.width / rect.width, small.height / rect.height)
            let background = cropped.transformed(by: CGAffineTransform(scaleX: fill, y: fill))
                .transformed(by: CGAffineTransform(translationX: (small.width - rect.width * fill) / 2, y: (small.height - rect.height * fill) / 2))
                .cropped(to: small).clampedToExtent().applyingGaussianBlur(sigma: 9).cropped(to: small)
                .transformed(by: CGAffineTransform(scaleX: 4, y: 4))
                .applyingFilter("CIColorMatrix", parameters: dim)

            let panelTop = pictureTop + pictureHeight + 26
            image = foreground.composited(over: background)
            image = timer
                .transformed(by: CGAffineTransform(translationX: 40, y: canvas.height - panelTop - CGFloat(panel.pixelHeight)))
                .composited(over: image)
            if let heading { image = heading.composited(over: image) }
            }

            var buffer: CVPixelBuffer?
            CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer)
            guard let buffer else {
                problem = "could not allocate a video frame"
                return
            }
            renderer.render(image, to: buffer, bounds: canvas, colorSpace: colorSpace)
            guard waitUntilReady(input, writer), adaptor.append(buffer, withPresentationTime: time) else {
                problem = writer.error?.localizedDescription ?? "the video couldn't be written"
                return
            }
            let percent = min(100, Int((time.seconds - first.seconds) / span * 100))
            if percent != lastPercent {
                lastPercent = percent
                print("\r\(label)… \(percent)%", terminator: "")
                fflush(stdout)
            }
        }
    }
    if problem == nil, reader.status == .failed { problem = reader.error?.localizedDescription ?? "the clip couldn't be decoded" }
    print("\r\(label)… 100%")
    if problem != nil {
        writer.cancelWriting()
        try? FileManager.default.removeItem(at: output)
        return problem
    }
    input.markAsFinished()
    if soundInput != nil { soundDone.wait() }
    let finished = DispatchSemaphore(value: 0)
    writer.finishWriting { finished.signal() }
    finished.wait()
    if problem == nil, writer.status != .completed { problem = writer.error?.localizedDescription ?? "the video couldn't be finished" }
    if problem != nil { try? FileManager.default.removeItem(at: output) }
    return problem
}

// MARK: - Options

/// A marker export together with what its matching race clip says about the sequence it came from.
struct Source {
    let markersPath: String
    /// The race clip with the same name as the marker file, when there's one nearby.
    var clipPath: String?
    var width: Int?
    var height: Int?
    /// Sequence frame rate, when the clip settles it.
    var fps: FrameRate?
    /// Set when the clip's header disagrees with its real frame spacing and the markers don't settle which
    /// of the two the sequence uses.
    var undecided: (actual: FrameRate, claimed: FrameRate)?

    var name: String { runName(forMarkers: markersPath) }
}

/// A marker file's name without ".csv", and without the clip's extension when the export was named
/// after the whole clip file, as Premiere does for a sequence made from a clip ("hdz_0012.ts.csv").
func runName(forMarkers path: String) -> String {
    let name = URL(fileURLWithPath: path).deletingPathExtension().lastPathComponent
    let inner = (name as NSString).pathExtension.lowercased()
    return videoExtensions.contains(inner) ? (name as NSString).deletingPathExtension : name
}

struct Options {
    var markersPaths: [String] = []
    var timeTokens: [String] = []
    var lapTokens: [String] = []
    var firstCrossing: String?
    var sequenceStart: String?
    var fps: FrameRate?
    var fpsExplicit = false
    var claimedFPS: FrameRate?
    /// Timebase chosen for sequences whose clip's header disagrees with its real frame spacing.
    var mismatchFPS: FrameRate?
    var sizeExplicit = false
    var sources: [Source] = []
    var width: Int?
    var height: Int?
    var output: String?
    /// The race clip, when given: the overlay is named after it.
    var clipPath: String?
    var position = "tr"
    var userScale = 1.0
    var margin = 54.0
    var decimals = 3
    var window = 3
    var maxRows = 8
    var hold = 8.0
    var leadIn = 3.0
    var accent = "#FFD60A"
    /// Pilot name shown as the timer's heading.
    var title: String?
    var titleFromFile = false
    var pilotID: String?
    var idLabel = "ID"
    /// The competition, shown with the track on the timer.
    var event: String?
    /// Overrides the track name, which otherwise comes from the track folder.
    var trackName: String?
    var onlyBest: Int?
    var summaryOnly = false
    var json = false
    var makeOverlay = true
    var makeUpright = false
    var makeLandscape = false
    var stillTime: String?
    var stillPath: String?
    var stillBackground: String?
    var compact = false
    var interactive = false
    /// A race clip to write a playable copy of, for the app's marker editor.
    var previewClip: String?
    /// The stretch of the clip a finished video covers, when it was chosen in the app.
    var videoStart: Double?
    var videoEnd: Double?
    /// A song chosen in the app, and the clip time its first moment belongs at.
    var musicPath: String?
    var musicStart: Double?
    var noMusic = false

    /// The ID line beside the pilot name, such as "RaceGOW ID 042".
    var badge: String? {
        guard let pilotID, !pilotID.isEmpty else { return nil }
        return idLabel.isEmpty ? pilotID : "\(idLabel) \(pilotID)"
    }
}

/// Options starting from settings.json beside this tool: pilot, id, idLabel, corner.
func baseOptions() -> Options {
    var options = Options()
    let tool = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath()
    let file = tool.deletingLastPathComponent().appendingPathComponent("settings.json")
    guard let data = try? Data(contentsOf: file), let settings = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return options }
    func text(_ key: String) -> String? {
        guard let value = (settings[key] as? String)?.trimmed, !value.isEmpty else { return nil }
        return value
    }
    options.title = text("pilot")
    options.pilotID = text("id")
    options.idLabel = text("idLabel") ?? options.idLabel
    options.event = text("event")
    options.position = text("corner") ?? options.position
    options.accent = text("accent") ?? options.accent
    return options
}

let usage = """
laptimer — lap timer overlay for Premiere Pro (transparent ProRes 4444 .mov)

Run with no arguments to be asked for everything, or:

  laptimer --markers "Track 1"
  laptimer --markers Markers.csv --match race.mp4
  laptimer --markers Markers.csv --fps 59.94 --size 1920x1080 -o overlay.mov
  laptimer --markers "Track 1" --only-best 1 --landscape --upright --no-overlay
  laptimer --times 00:00:05:10 00:00:29:41 00:00:53:40 00:01:17:47 --fps 59.94
  laptimer --laps 24.512 23.981 24.110 --first-crossing 5.2 --fps 59.94

Where the laps come from (pick one):
  --markers FILE ...    Premiere marker exports (File > Export > Markers, CSV), one marker per
                        start/finish gate crossing; the first marker starts lap 1. Give several
                        files, or a folder of them, for a batch: a ranking plus one overlay each.
                        Marker files saved by the app's marker editor work the same way.
                        A marker file named after its race clip (hdz_0008.csv for hdz_0008.ts, in
                        the same folder or a neighbouring one) takes its frame rate and size from
                        that clip, so nothing below is needed.
  --times T T T ...     The same crossings typed in, as sequence timecode or seconds.
  --laps L L L ...      Known lap times, with --first-crossing T for where lap 1 starts.

Sequence (for marker files with no clip of the same name; --fps and --size override the clips):
  --match VIDEO         Take frame rate and frame size from a race clip. A single marker file's
                        overlay is then named after that clip instead of the marker file.
  --fps RATE            Sequence frame rate: 23.976, 24, 25, 29.97, 30, 50, 59.94, 60, 119.88, 120 ...
  --size WxH            Sequence frame size (default 1920x1080).
  --mismatch-fps RATE   Timebase of sequences made from clips whose header frame rate disagrees
                        with their real one (Premiere goes by the header).
  --sequence-start TC   Sequence start timecode if it isn't 00:00:00:00.

Look (pilot, id, idLabel, event, corner and accent can also be set in settings.json beside this tool):
  --position P          tl, tr, bl, br, tc, bc (default tr).
  --pilot NAME          Pilot name shown as the timer's heading. --title is the same thing.
  --id TEXT             ID shown beside the pilot name, and --id-label TEXT for the word before it.
  --event TEXT          Competition name shown across the top of the timer, such as RaceGOW6.
  --track TEXT          Track name shown beside it. By default it is the name of the track folder
                        (the folder that holds the marker folder).
  --title-from-file     Use each marker file's name as its heading.
  --scale N             Panel size multiplier (default 1).
  --margin N            Distance from the frame edge, in 1080p pixels (default 54).
  --accent HEX          Highlight colour (default #FFD60A).
  --decimals N          Decimal places, 0-3 (default 3).
  --best N              Consecutive laps to combine (default 3).
  --max-rows N          Most lap rows shown at once (default 8).
  --hold SECONDS        How long the result stays up after the last lap (default 8).

Output:
  -o, --output PATH     Where to write the .mov, or for a batch the folder to put them in.
                        By default each overlay is named after its marker file with a number:
                        hdz_0008.csv gives hdz_0008-1.mov, then hdz_0008-2.mov next time, and
                        nothing is overwritten. It goes in an "overlays" folder beside the marker
                        folder if there is one, otherwise next to the marker file.
  --landscape           Also write a finished 16:9 video of each run (1920x1080 .mp4, the timer in
                        its corner), into a "landscape" folder: ready for YouTube.
  --upright             Also write a finished 9:16 video of each run (1080x1920 .mp4 with the pilot
                        heading above the picture and the timer below), into a "vertical" folder:
                        ready for Shorts, TikTok and Reels.
                        Both need the race clip, and markers in the clip's own time (exported while
                        the clip started at the start of the sequence).
                        Sound: a file named after the run in a "music" folder (music/hdz_0008.mp3),
                        taken as the audio exported from the run's Premiere sequence. The videos
                        then cover the same stretch as that sequence.
  --no-overlay          With --landscape or --upright: skip the Premiere overlay.
  --lead-in SECONDS     How long before lap 1 a finished video starts (default 3).
  --video-start SECONDS, --video-end SECONDS
                        The stretch of the clip a finished video covers, in clip time, instead of
                        working it out from the laps.
  --music FILE          Sound for the finished videos from any audio file, instead of the one in the
                        music folder. --music-start SECONDS is the clip time its first moment belongs
                        at (it can be negative: the song is then already under way when the clip
                        starts). Without it the song starts with the video.
  --no-music            Make the finished videos silent even if there is a music file.
  --only-best N         In a batch, only make files for the N fastest runs.
  --summary             Print the lap times and ranking without making anything.
  --json                The same as machine-readable JSON.
  --compact             Write a panel-sized clip instead of a full-frame one: roughly 60% smaller,
                        but you move it into place in Premiere (Effect Controls > Motion).
  --still T FILE.png    Write one frame at sequence time T as a PNG instead of a movie.
  --version             Print this tool's version.
  --preview CLIP        Nothing to do with laps: write a copy of a race clip that macOS can play, to
                        the .mov named with -o, without re-encoding it, and print the clip's frame
                        rate and size as JSON. A clip macOS can already play is left as it is. The
                        app's marker editor plays this copy.
"""

func parseArguments(_ arguments: [String]) -> Options {
    var options = baseOptions()
    var index = 0
    func value(for flag: String) -> String {
        index += 1
        guard index < arguments.count else { fail("\(flag) needs a value.") }
        return arguments[index]
    }
    func values(for flag: String) -> [String] {
        var result: [String] = []
        while index + 1 < arguments.count, !arguments[index + 1].hasPrefix("-") {
            index += 1
            result.append(arguments[index])
        }
        if result.isEmpty { fail("\(flag) needs at least one value.") }
        return result
    }
    func number(for flag: String) -> Double {
        guard let number = Double(value(for: flag)) else { fail("\(flag) needs a number.") }
        return number
    }
    func rate(for flag: String) -> FrameRate {
        guard let fps = FrameRate.parse(value(for: flag)) else { fail("\(flag) needs a frame rate such as 59.94.") }
        return fps
    }
    while index < arguments.count {
        let flag = arguments[index]
        switch flag {
        case "-h", "--help":
            print(usage)
            exit(0)
        case "--version":
            print("laptimer \(toolVersion)")
            exit(0)
        case "--markers": options.markersPaths = values(for: flag).map { ($0 as NSString).expandingTildeInPath }
        case "--times": options.timeTokens = values(for: flag)
        case "--laps": options.lapTokens = values(for: flag)
        case "--first-crossing": options.firstCrossing = value(for: flag)
        case "--sequence-start": options.sequenceStart = value(for: flag)
        case "--match":
            let path = value(for: flag)
            guard let info = videoInfo(path: path) else { fail("Could not read a video track from \(path).") }
            options.clipPath = (path as NSString).expandingTildeInPath
            options.claimedFPS = info.claimedFPS
            if !options.fpsExplicit { options.fps = info.fps }
            if !options.sizeExplicit {
                options.width = info.width
                options.height = info.height
            }
        case "--fps":
            options.fps = rate(for: flag)
            options.fpsExplicit = true
        case "--mismatch-fps": options.mismatchFPS = rate(for: flag)
        case "--size":
            guard let size = parseSize(value(for: flag)) else { fail("--size needs a value such as 1920x1080.") }
            (options.width, options.height) = size
            options.sizeExplicit = true
        case "-o", "--output": options.output = value(for: flag)
        case "--only-best": options.onlyBest = Int(number(for: flag))
        case "--summary": options.summaryOnly = true
        case "--json": options.json = true
        case "--upright": options.makeUpright = true
        case "--landscape": options.makeLandscape = true
        case "--no-overlay": options.makeOverlay = false
        case "--lead-in": options.leadIn = number(for: flag)
        case "--video-start": options.videoStart = number(for: flag)
        case "--video-end": options.videoEnd = number(for: flag)
        case "--music": options.musicPath = (value(for: flag) as NSString).expandingTildeInPath
        case "--music-start": options.musicStart = number(for: flag)
        case "--no-music": options.noMusic = true
        case "--preview": options.previewClip = (value(for: flag) as NSString).expandingTildeInPath
        case "--compact": options.compact = true
        case "--position": options.position = value(for: flag)
        case "--scale": options.userScale = number(for: flag)
        case "--margin": options.margin = number(for: flag)
        case "--accent": options.accent = value(for: flag)
        case "--title", "--pilot": options.title = value(for: flag)
        case "--id": options.pilotID = value(for: flag)
        case "--id-label": options.idLabel = value(for: flag)
        case "--event": options.event = value(for: flag)
        case "--track": options.trackName = value(for: flag)
        case "--title-from-file": options.titleFromFile = true
        case "--decimals": options.decimals = Int(number(for: flag))
        case "--best": options.window = Int(number(for: flag))
        case "--max-rows": options.maxRows = Int(number(for: flag))
        case "--hold": options.hold = number(for: flag)
        case "--still":
            options.stillTime = value(for: flag)
            options.stillPath = value(for: flag)
        case "--still-background": options.stillBackground = value(for: flag)
        default: fail("Unknown option \(flag). Run with --help to see the options.")
        }
        index += 1
    }
    if let claimed = options.claimedFPS, let actual = options.fps, !options.fpsExplicit {
        fail("That clip's frames are \(actual.label) per second, but its header says \(claimed.label) and Premiere goes by the header, "
            + "so the sequence may be either. Check Sequence > Sequence Settings > Timebase in Premiere and add --fps with that value.")
    }
    if !options.makeOverlay && !options.makeUpright && !options.makeLandscape { fail("--no-overlay only makes sense together with --landscape or --upright.") }
    return options
}

func parseSize(_ text: String) -> (Int, Int)? {
    let parts = text.lowercased().split(whereSeparator: { "x×* ".contains($0) })
    guard parts.count == 2, let width = Int(parts[0]), let height = Int(parts[1]), width >= 320, height >= 240,
          width % 2 == 0, height % 2 == 0 else { return nil }
    return (width, height)
}

// MARK: - Finding marker files and their clips

func subfolders(of folder: String) -> [String] {
    ((try? FileManager.default.contentsOfDirectory(atPath: folder)) ?? [])
        .filter { !$0.hasPrefix(".") }
        .sorted { $0.localizedStandardCompare($1) == .orderedAscending }
        .map { (folder as NSString).appendingPathComponent($0) }
        .filter { path in
            var isDirectory: ObjCBool = false
            return FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory) && isDirectory.boolValue
        }
}

/// Replaces any folder with the marker exports (.csv or .txt) in it or, when it has none of its own,
/// in the folders directly inside it, so a whole track folder can be given.
func expandMarkerPaths(_ paths: [String]) -> [String] {
    func exports(in folder: String) -> [String] {
        ((try? FileManager.default.contentsOfDirectory(atPath: folder)) ?? [])
            .filter { !$0.hasPrefix(".") && ["csv", "txt"].contains(($0 as NSString).pathExtension.lowercased()) }
            .sorted { $0.localizedStandardCompare($1) == .orderedAscending }
            .map { (folder as NSString).appendingPathComponent($0) }
    }
    var files: [String] = []
    for path in paths {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory) else { fail("Can't find \(path).") }
        guard isDirectory.boolValue else {
            files.append(path)
            continue
        }
        var found = exports(in: path)
        if found.isEmpty { found = subfolders(of: path).flatMap(exports(in:)) }
        if found.isEmpty { fail("There are no .csv marker exports in \(path).") }
        files += found
    }
    return files
}

let videoExtensions: Set<String> = ["ts", "mts", "m2ts", "mp4", "m4v", "mov", "mkv", "avi", "mxf"]

/// A video with the same name as the marker file: beside it, or in a folder beside its folder.
func findClip(forMarkers path: String) -> String? {
    let file = URL(fileURLWithPath: path).standardizedFileURL
    let name = runName(forMarkers: path).lowercased()
    let folder = file.deletingLastPathComponent()
    let parent = folder.deletingLastPathComponent()
    var folders = [folder.path]
    // Markers saved loose in Downloads or Documents have the whole home folder as neighbours: leave those alone.
    if parent.path != NSHomeDirectory() && parent.pathComponents.count > 3 {
        // Folders the tool writes to hold overlays and finished videos, never race clips.
        folders += subfolders(of: parent.path).filter { $0 != folder.path && !["overlays", "vertical", "landscape", "music"].contains(($0 as NSString).lastPathComponent.lowercased()) }
    }
    for candidate in folders {
        for item in ((try? FileManager.default.contentsOfDirectory(atPath: candidate)) ?? []).sorted() {
            let url = URL(fileURLWithPath: candidate).appendingPathComponent(item)
            if videoExtensions.contains(url.pathExtension.lowercased()),
               url.deletingPathExtension().lastPathComponent.lowercased() == name {
                return url.path
            }
        }
    }
    return nil
}

/// The track a marker file belongs to: the folder above its marker folder, when it is laid out that way.
func trackName(forMarkers path: String) -> String? {
    let folder = URL(fileURLWithPath: path).standardizedFileURL.deletingLastPathComponent()
    guard folder.lastPathComponent.lowercased().contains("marker") else { return nil }
    return folder.deletingLastPathComponent().lastPathComponent
}

/// Where a marker file's overlay goes: an "overlays" folder beside the marker folder if there is
/// one, otherwise next to the marker file.
func overlayFolder(forMarkers path: String) -> URL {
    let folder = URL(fileURLWithPath: path).standardizedFileURL.deletingLastPathComponent()
    let sibling = folder.deletingLastPathComponent().appendingPathComponent("overlays", isDirectory: true)
    var isDirectory: ObjCBool = false
    let exists = FileManager.default.fileExists(atPath: sibling.path, isDirectory: &isDirectory) && isDirectory.boolValue
    return exists ? sibling : folder
}

/// The files already made for a run: `<base>-<number>.<ext>` in `folder`, lowest number first.
func numberedFiles(in folder: URL, base: String, ext: String) -> [URL] {
    let prefix = base + "-", suffix = "." + ext
    return ((try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []).compactMap { name -> (Int, URL)? in
        guard name.hasPrefix(prefix), name.lowercased().hasSuffix(suffix),
              let number = Int(name.dropFirst(prefix.count).dropLast(suffix.count)) else { return nil }
        return (number, folder.appendingPathComponent(name))
    }.sorted { $0.0 < $1.0 }.map(\.1)
}

func scanSource(markersPath: String) -> Source {
    var source = Source(markersPath: markersPath)
    guard let clip = findClip(forMarkers: markersPath), let info = videoInfo(path: clip) else { return source }
    source.clipPath = clip
    source.width = info.width
    source.height = info.height
    guard let claimed = info.claimedFPS else {
        source.fps = info.fps
        return source
    }
    let text = readText(at: markersPath) ?? ""
    // Markers placed in the app never went through a Premiere sequence, so the header doesn't come into it.
    if markersAreInClipTime(text) {
        source.fps = info.fps
        return source
    }
    // Premiere may have built the sequence at either rate. A marker whose frame number is too high
    // for one of them settles it; otherwise it has to be asked.
    let tokens = markerTokens(inFile: text)
    let highestFrame = tokens.compactMap { Timecode.first(in: $0)?.frames }.max() ?? 0
    let possible = [info.fps, claimed].filter { $0.timebase > highestFrame }
    if possible.count == 1 {
        source.fps = possible[0]
    } else {
        source.undecided = (info.fps, claimed)
    }
    return source
}

// MARK: - Interactive mode

func ask(_ prompt: String, default fallback: String? = nil) -> String {
    print(prompt + (fallback.map { " [\($0)]" } ?? "") + ": ", terminator: "")
    fflush(stdout)
    let answer = (readLine() ?? "").trimmed
    return answer.isEmpty ? (fallback ?? "") : answer
}

/// Splits what was typed or dragged into Terminal into plain paths. Terminal separates dragged files
/// with spaces and backslash-escapes (or quotes) anything awkward inside each one.
func splitPaths(_ line: String) -> [String] {
    let whole = (line.trimmed as NSString).expandingTildeInPath
    if FileManager.default.fileExists(atPath: whole) { return [whole] }
    var paths: [String] = []
    var current = ""
    var started = false
    var quote: Character?
    var escaped = false
    for character in line {
        if escaped {
            current.append(character)
            escaped = false
        } else if let open = quote {
            if character == open { quote = nil } else { current.append(character) }
        } else if character == "\\" {
            escaped = true
            started = true
        } else if character == "'" || character == "\"" {
            quote = character
            started = true
        } else if character.isWhitespace {
            if started { paths.append(current) }
            current = ""
            started = false
        } else {
            current.append(character)
            started = true
        }
    }
    if started { paths.append(current) }
    return paths.map { ($0 as NSString).expandingTildeInPath }
}

func askOptions() -> Options {
    var options = baseOptions()
    options.interactive = true
    print("""
    Drone Lap Timer — overlay maker for Premiere Pro

    For each run, in Premiere:
      1. Put a marker (M) on the timeline at every start/finish gate crossing.
         The first marker starts lap 1; each later marker ends a lap.
      2. File > Export > Markers…, choose CSV, and save it under the race clip's name
         (hdz_0008.csv for hdz_0008.ts) in the track's "csv markers" folder.
    Then drag that folder in here. The runs get ranked and the timers go in the "overlays" folder.

    """)
    options.markersPaths = expandMarkerPaths(splitPaths(ask("Drag in the folder of marker CSVs (or a single CSV) and press Return")))
    guard !options.markersPaths.isEmpty else { fail("No marker file given.") }
    options.sources = options.markersPaths.map(scanSource(markersPath:))
    let batch = options.sources.count > 1
    let unmatched = options.sources.filter { $0.clipPath == nil }
    let matchedCount = options.sources.count - unmatched.count
    if batch {
        let clips = matchedCount == 0 ? "" : matchedCount == options.sources.count
            ? ", and the race clip for each one" : ", and the race clip for \(matchedCount) of them"
        print("Found \(options.sources.count) marker files\(clips).")
    } else if let clip = options.sources[0].clipPath {
        print("Found its race clip, \((clip as NSString).lastPathComponent).")
    }

    if !unmatched.isEmpty {
        print("\nThe overlay has to match the sequence's frame rate and frame size.")
        if batch {
            print("There's no clip named like these marker files, so I need those for: " + unmatched.map(\.name).joined(separator: ", "))
        }
        let clip = splitPaths(ask(batch
            ? "Drag a race clip from one of those sequences here to read them (or press Return to type them)"
            : "Drag the race clip from the sequence here: it gives those and names the overlay (or press Return to type them)")).first ?? ""
        var fpsDefault: String? = "59.94"
        var sizeDefault = "1920x1080"
        if !clip.isEmpty {
            guard FileManager.default.fileExists(atPath: clip) else { fail("Can't find \(clip).") }
            options.clipPath = clip
            if let info = videoInfo(path: clip) {
                sizeDefault = "\(info.width)x\(info.height)"
                if let claimed = info.claimedFPS {
                    fpsDefault = nil
                    print("""
                    That clip is \(sizeDefault). Careful with its frame rate: the frames are \(info.fps.label) per second, but the
                    file's header says \(claimed.label) and Premiere goes by the header, so your sequence may be either.
                    Look at Sequence > Sequence Settings > Timebase in Premiere and type what it says.
                    """)
                } else {
                    fpsDefault = info.fps.label
                    print("That clip is \(sizeDefault) at \(info.fps.label) fps. Press Return to use these, or type your sequence's own.")
                }
            } else {
                print("Couldn't read that clip, so type the values instead (they're in Sequence > Sequence Settings).")
            }
        }
        guard let fps = FrameRate.parse(ask(fpsDefault == nil ? "Sequence frame rate (the Timebase)" : "Sequence frame rate (\"60\" from a GoPro or DJI is usually 59.94)", default: fpsDefault)) else {
            fail("That isn't a frame rate.")
        }
        guard let size = parseSize(ask("Sequence frame size", default: sizeDefault)) else { fail("That isn't a frame size like 1920x1080.") }
        options.fps = fps
        (options.width, options.height) = size
    }

    let undecided = options.sources.filter { $0.undecided != nil }
    if let rates = undecided.first?.undecided {
        print("""

        Careful with the frame rate for \(undecided.map(\.name).joined(separator: ", ")):
        the frames are \(rates.actual.label) per second, but the file header says \(rates.claimed.label) and Premiere goes by the header,
        so a sequence made from one of these clips is normally \(rates.claimed.label) fps. Check Sequence > Sequence Settings > Timebase.
        """)
        let question = undecided.count == 1 ? "Timebase of that sequence" : "Timebase of those sequences"
        guard let fps = FrameRate.parse(ask(question, default: rates.claimed.label)) else { fail("That isn't a frame rate.") }
        options.mismatchFPS = fps
    }

    let corners = ["tl": "top-left", "tr": "top-right", "bl": "bottom-left", "br": "bottom-right", "tc": "top-centre", "bc": "bottom-centre"]
    let look = [corners[options.position.lowercased()].map { "\($0) corner" }, options.event, options.title, options.badge].compactMap { $0 }
    print("\nTimer: " + look.joined(separator: ", ") + ". (Corner, event, pilot name and ID come from settings.json beside this tool.)\n")
    return options
}

// MARK: - Runs

/// One timed run: a sequence's worth of gate crossings and where its overlay goes.
struct Run {
    /// Marker file name without its extension; empty when the times were typed in.
    let name: String
    let race: Race
    /// Set when every marker sits on a step of several frames, i.e. wasn't placed to the exact frame.
    let coarseStep: Int?
    let outputURL: URL
    let fps: FrameRate
    let width: Int
    let height: Int
    var markersPath: String?
    var clipPath: String?
    /// The track this run belongs to, for the timer.
    var track: String?

    var bestTotal: Int? { race.best(afterLaps: race.lapCount)?.total }
    var sequence: String { "\(width)x\(height) at \(fps.label) fps" }
}

/// Why a marker file can't be timed.
struct Unusable: Error {
    let reason: String
}

func makeRace(crossings: [Double], options: Options) throws -> Race {
    if crossings.contains(where: { $0 < 0 }) {
        throw Unusable(reason: "a marker falls before the start of the sequence (check --sequence-start)")
    }
    let unitsPerSecond = Double(pow10(options.decimals))
    let bounds = Array(Set(crossings.map { Int(($0 * unitsPerSecond).rounded()) })).sorted()
    guard bounds.count >= 2 else {
        throw Unusable(reason: "at least two markers are needed (where lap 1 starts, then the end of each lap), found \(bounds.count)")
    }
    return Race(bounds: bounds, decimals: options.decimals, window: options.window)
}

func crossings(inMarkerFile path: String, fps: FrameRate, sequenceStart: String?) throws -> [Double] {
    guard let text = readText(at: path) else { throw Unusable(reason: "the file can't be read") }
    let seconds = markerTokens(inFile: text).compactMap { markerSeconds($0, fps: fps) }
    if seconds.isEmpty { throw Unusable(reason: "no marker times found") }
    guard let start = sequenceStart else { return seconds }
    guard let offset = markerSeconds(start, fps: fps) else { fail("--sequence-start isn't a timecode.") }
    return seconds.map { $0 - offset }
}

/// The frame rate and frame size of the sequence a marker file came from.
func sequenceSettings(for source: Source, options: Options) throws -> (fps: FrameRate, width: Int, height: Int) {
    let width = (options.sizeExplicit ? options.width : source.width ?? options.width) ?? 1920
    let height = (options.sizeExplicit ? options.height : source.height ?? options.height) ?? 1080
    if options.fpsExplicit, let fps = options.fps { return (fps, width, height) }
    if let rates = source.undecided {
        guard let fps = options.mismatchFPS else {
            throw Unusable(reason: "its clip's frames are \(rates.actual.label) per second, but the clip's header says \(rates.claimed.label) and Premiere goes by "
                + "the header, so the sequence may be either. Check Sequence > Sequence Settings > Timebase in Premiere and add --mismatch-fps with that value")
        }
        return (fps, width, height)
    }
    guard let fps = source.fps ?? options.fps else {
        throw Unusable(reason: "there's no clip with that name to read the sequence frame rate from. Add --fps 59.94 (or whatever the sequence uses) or --match yourclip.mp4")
    }
    return (fps, width, height)
}

/// Markers dropped during playback or by dragging the playhead tend to land on a coarse step rather
/// than the exact frame, which shows up as every gap between them sharing a common factor.
func coarseStep(crossings: [Double], fps: FrameRate) -> Int? {
    guard crossings.count >= 4 else { return nil }
    func gcd(_ a: Int, _ b: Int) -> Int { b == 0 ? a : gcd(b, a % b) }
    let frames = crossings.map { Int(($0 * fps.value).rounded()) }.sorted()
    let gaps = zip(frames, frames.dropFirst()).map { $1 - $0 }
    let step = gaps.reduce(0, gcd)
    // Frame-accurate markers share a factor by chance about once in step^gaps tries; only speak up when that's rare.
    return step >= 3 && pow(Double(step), Double(gaps.count)) >= 500 ? step : nil
}

func printLaps(_ run: Run) {
    let race = run.race
    let lapTimes = (0..<race.lapCount).map { race.time(race.lap($0)) }
    let lapTimeWidth = lapTimes.map(\.count).max() ?? 0
    for (lap, time) in lapTimes.enumerated() {
        let label = "Lap \(lap + 1)".padding(toLength: 8, withPad: " ", startingAt: 0)
        print("  \(label) " + String(repeating: " ", count: lapTimeWidth - time.count) + time)
    }
    if let best = race.best(afterLaps: race.lapCount) {
        let which = race.lapCount == race.window ? "" : " (laps \(best.start + 1)–\(best.start + race.window))"
        print("  \(race.lapCount == race.window ? "" : "Best ")\(race.window) consecutive laps: \(race.time(best.total, minutes: true))\(which)")
    } else {
        print("  Total: \(race.time(race.bounds.last! - race.bounds[0], minutes: true)) (fewer than \(race.window) laps marked)")
    }
    if let step = run.coarseStep {
        let stepTime = formatTime(Int((Double(step) / run.fps.value * 1000).rounded()), decimals: 3, minutes: false)
        print("""

          Heads up: every marker sits on a \(step)-frame step, so these times are only good to about \(stepTime) s.
          For frame-accurate times, park on each gate crossing with the Left/Right arrow keys (one frame
          per press) before pressing M, then export the markers again.
        """)
    }
}

/// Prints the runs as a table, in the order given.
func printRanking(_ runs: [Run]) {
    let window = runs[0].race.window
    var rows = [["#", "Run", "Best \(window) in a row", "Best lap", "All laps"]]
    for (index, run) in runs.enumerated() {
        let race = run.race
        let laps = (0..<race.lapCount).map { race.lap($0) }
        var best = "needs \(window) laps"
        if let found = race.best(afterLaps: race.lapCount) {
            best = race.time(found.total, minutes: true)
            if race.lapCount > window { best += "  laps \(found.start + 1)–\(found.start + window)" }
        }
        rows.append([
            run.bestTotal == nil ? "–" : "\(index + 1)",
            run.name + (run.coarseStep == nil ? "" : " *"),
            best,
            race.time(laps.min()!),
            laps.map { race.time($0) }.joined(separator: "  "),
        ])
    }
    let widths = (0..<4).map { column in rows.map { $0[column].count }.max()! }
    for row in rows {
        print("  " + (0..<4).map { row[$0].padding(toLength: widths[$0] + 3, withPad: " ", startingAt: 0) }.joined() + row[4])
    }
    if runs.contains(where: { $0.coarseStep != nil }) {
        print("""

          * These markers sit on a step of several frames instead of exact frames, so the times are
            approximate. Park on each gate crossing with the Left/Right arrow keys before pressing M.
        """)
    }
}

/// Everything about the runs as JSON, for the app.
func printJSON(runs: [Run], skipped: [(file: String, reason: String)], undecided: [Source]) {
    func seconds(_ units: Int, _ race: Race) -> String { formatTime(units, decimals: race.decimals, minutes: false, plain: true) }
    let list: [[String: Any]] = runs.map { run in
        let race = run.race
        let laps = (0..<race.lapCount).map { race.lap($0) }
        var entry: [String: Any] = [
            "name": run.name,
            "markers": run.markersPath.map { URL(fileURLWithPath: $0).standardizedFileURL.path } ?? "",
            "clip": run.clipPath ?? "",
            "fps": run.fps.label,
            "width": run.width,
            "height": run.height,
            "laps": laps.map { seconds($0, race) },
            "bestLap": seconds(laps.min() ?? 0, race),
            "firstCrossing": Double(race.bounds[0]) / Double(race.unitsPerSecond),
            "lastCrossing": Double(race.bounds[race.lapCount]) / Double(race.unitsPerSecond),
            "crossings": race.bounds.map { Double($0) / Double(race.unitsPerSecond) },
            "coarseStep": run.coarseStep ?? 0,
            "track": run.track ?? "",
            "music": run.markersPath.flatMap { findMusic(forMarkers: $0, run: run.name)?.path } ?? "",
        ]
        if let best = race.best(afterLaps: race.lapCount) {
            entry["best"] = ["seconds": seconds(best.total, race), "firstLap": best.start + 1, "lastLap": best.start + race.window]
        }
        let overlays = run.outputURL.deletingLastPathComponent()
        entry["overlays"] = numberedFiles(in: overlays, base: run.name, ext: "mov").map(\.path)
        entry["uprights"] = numberedFiles(in: finishedFolder(.upright, forOverlayFolder: overlays), base: run.name, ext: "mp4").map(\.path)
        entry["landscapes"] = numberedFiles(in: finishedFolder(.landscape, forOverlayFolder: overlays), base: run.name, ext: "mp4").map(\.path)
        return entry
    }
    let payload: [String: Any] = [
        "window": runs.first?.race.window ?? 3,
        "premiereMedia": runs.first?.markersPath.map(premiereMediaNames(near:)) ?? [],
        "runs": list,
        "skipped": skipped.map { ["file": $0.file, "reason": $0.reason] },
        "undecided": undecided.map { ["name": $0.name, "actual": $0.undecided?.actual.label ?? "", "claimed": $0.undecided?.claimed.label ?? ""] },
    ]
    let data = (try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])) ?? Data("{}".utf8)
    print(String(decoding: data, as: UTF8.self))
}

// MARK: - Main

let arguments = Array(CommandLine.arguments.dropFirst())
var options = arguments.isEmpty ? askOptions() : parseArguments(arguments)

// A playable copy of a race clip, for the app's marker editor.
if let clipPath = options.previewClip {
    let name = (clipPath as NSString).lastPathComponent
    guard let info = videoInfo(path: clipPath) else { fail("\(name) can't be read as a video.") }
    var playable = URL(fileURLWithPath: clipPath)
    if loadTracks(of: AVURLAsset(url: playable)) == nil {
        guard let output = options.output else { fail("--preview needs -o with where to write the playable copy.") }
        guard let wrapped = rewrapTransportStream(path: clipPath, from: 0, to: .infinity) else { fail("\(name) can't be read as a video.") }
        let destination = URL(fileURLWithPath: (output as NSString).expandingTildeInPath)
        do {
            try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? FileManager.default.removeItem(at: destination)
            try FileManager.default.moveItem(at: wrapped.url, to: destination)
        } catch {
            try? FileManager.default.removeItem(at: wrapped.url)
            fail("Can't write \(destination.path): \(error.localizedDescription)")
        }
        playable = destination
    }
    let payload: [String: Any] = ["file": playable.path, "fps": info.fps.label, "num": info.fps.num, "den": info.fps.den,
                                  "width": info.width, "height": info.height]
    let data = (try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])) ?? Data("{}".utf8)
    print(String(decoding: data, as: UTF8.self))
    exit(0)
}

guard (0...3).contains(options.decimals) else { fail("--decimals must be between 0 and 3.") }
guard options.window >= 1 else { fail("--best must be at least 1.") }
guard options.userScale > 0, options.hold >= 0, options.leadIn >= 0 else { fail("--scale, --hold and --lead-in must be positive.") }
guard let accentRGB = parseHexColor(options.accent) else { fail("--accent needs a colour such as #FFD60A.") }
let unitsPerSecond = Double(pow10(options.decimals))

var runs: [Run] = []
var skipped: [(file: String, reason: String)] = []
var undecidedSources: [Source] = []
if !options.lapTokens.isEmpty || !options.timeTokens.isEmpty {
    // Gate crossings typed in, as seconds from the start of the sequence.
    guard let fps = options.fps else {
        fail("The sequence frame rate is needed: add --fps 59.94 (or whatever your sequence uses) or --match yourclip.mp4.")
    }
    var seconds: [Double] = []
    if !options.lapTokens.isEmpty {
        guard let first = markerSeconds(options.firstCrossing ?? "0", fps: fps) else { fail("--first-crossing isn't a time.") }
        seconds = [first]
        for token in options.lapTokens {
            guard let lap = parseSeconds(token), lap > 0 else { fail("\"\(token)\" isn't a lap time.") }
            seconds.append(seconds.last! + lap)
        }
    } else {
        for token in options.timeTokens {
            guard let time = markerSeconds(token, fps: fps) else { fail("\"\(token)\" isn't a timecode or a time.") }
            seconds.append(time)
        }
        if let start = options.sequenceStart {
            guard let offset = markerSeconds(start, fps: fps) else { fail("--sequence-start isn't a timecode.") }
            seconds = seconds.map { $0 - offset }
        }
    }
    do {
        let race = try makeRace(crossings: seconds, options: options)
        var output = URL(fileURLWithPath: ((options.output ?? "Lap Overlay.mov") as NSString).expandingTildeInPath)
        if options.output == nil, let clip = options.clipPath {
            let here = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            let base = URL(fileURLWithPath: clip).deletingPathExtension().lastPathComponent
            output = nextNumbered(in: here, base: base, ext: "mov")
        }
        let step = options.lapTokens.isEmpty ? coarseStep(crossings: seconds, fps: fps) : nil
        runs = [Run(name: "", race: race, coarseStep: step, outputURL: output, fps: fps,
                    width: options.width ?? 1920, height: options.height ?? 1080, markersPath: nil, clipPath: options.clipPath,
                    track: options.trackName)]
    } catch {
        let reason = (error as? Unusable)?.reason ?? error.localizedDescription
        fail(reason.prefix(1).uppercased() + reason.dropFirst() + ".")
    }
} else {
    if options.sources.isEmpty { options.sources = expandMarkerPaths(options.markersPaths).map(scanSource(markersPath:)) }
    let sources = options.sources
    if sources.isEmpty { fail("Nothing to time. Give --markers, --times or --laps, or run with --help.") }
    // With several marker files, -o names the folder the overlays go in.
    var outputFolder: URL?
    if sources.count > 1, let output = options.output {
        let folder = URL(fileURLWithPath: (output as NSString).expandingTildeInPath, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        } catch {
            fail("Can't use \(folder.path) as the output folder: \(error.localizedDescription)")
        }
        outputFolder = folder
    }
    for source in sources {
        let fileName = (source.markersPath as NSString).lastPathComponent
        do {
            if options.json, source.undecided != nil, options.mismatchFPS == nil, !options.fpsExplicit {
                undecidedSources.append(source)
                continue
            }
            let settings = try sequenceSettings(for: source, options: options)
            let seconds = try crossings(inMarkerFile: source.markersPath, fps: settings.fps, sequenceStart: options.sequenceStart)
            let race = try makeRace(crossings: seconds, options: options)
            // Named after the marker file, which is the clip's name when the two match. A lone marker
            // file with some other name takes the name of the clip that was given with it.
            var base = source.name
            if sources.count == 1, source.clipPath == nil, let clip = options.clipPath {
                base = URL(fileURLWithPath: clip).deletingPathExtension().lastPathComponent
            }
            var output = nextNumbered(in: outputFolder ?? overlayFolder(forMarkers: source.markersPath), base: base, ext: "mov")
            if sources.count == 1, let chosen = options.output {
                output = URL(fileURLWithPath: (chosen as NSString).expandingTildeInPath)
            }
            let clip = source.clipPath ?? (sources.count == 1 ? options.clipPath : nil)
            runs.append(Run(name: base, race: race, coarseStep: coarseStep(crossings: seconds, fps: settings.fps),
                            outputURL: output, fps: settings.fps, width: settings.width, height: settings.height,
                            markersPath: source.markersPath, clipPath: clip,
                            track: options.trackName ?? trackName(forMarkers: source.markersPath)))
        } catch let problem as Unusable {
            if sources.count == 1 && !options.json { fail("\(fileName): \(problem.reason).") }
            skipped.append((fileName, problem.reason))
            if !options.json { print("Skipped \(fileName): \(problem.reason).") }
        } catch {
            fail("\(fileName): \(error.localizedDescription)")
        }
    }
    if runs.isEmpty && !options.json { fail("None of those files had usable markers.") }
}

// Fastest first; runs too short to have a combined time keep their order at the bottom.
runs = runs.enumerated().sorted { a, b in
    switch (a.element.bestTotal, b.element.bestTotal) {
    case let (x?, y?) where x != y: return x < y
    case (_?, nil): return true
    case (nil, _?): return false
    default: return a.offset < b.offset
    }
}.map(\.element)

if options.json {
    printJSON(runs: runs, skipped: skipped, undecided: undecidedSources)
    exit(0)
}

// Sequence settings: one line when every run shares them, otherwise who has what.
var sequenceGroups: [(settings: String, names: [String])] = []
for run in runs {
    if let index = sequenceGroups.firstIndex(where: { $0.settings == run.sequence }) {
        sequenceGroups[index].names.append(run.name)
    } else {
        sequenceGroups.append((run.sequence, [run.name]))
    }
}
if sequenceGroups.count == 1 {
    print("Sequence\(runs.count == 1 ? "" : "s"): \(sequenceGroups[0].settings)")
} else {
    print("Sequences:")
    for group in sequenceGroups { print("  \(group.settings): \(group.names.joined(separator: ", "))") }
}

if runs.count == 1 {
    printLaps(runs[0])
} else {
    print("\(runs.count) runs, fastest first:\n")
    printRanking(runs)
}
if options.summaryOnly { exit(0) }

// Which runs get files made.
var selected = runs
if runs.count > 1 {
    var limit = options.onlyBest
    if options.interactive {
        let answer = ask("\nHow many timers should I make, starting from the fastest? Type a number or \"all\"", default: "\(min(3, runs.count))")
        if !answer.lowercased().hasPrefix("a") {
            guard let number = Int(answer) else { fail("That isn't a number.") }
            limit = number
        }
    }
    if let limit {
        guard limit >= 1 else { fail("The number of runs to make must be at least 1.") }
        selected = Array(runs.prefix(limit))
    }
}
if options.interactive {
    let answer = ask("Finished videos to make as well: none, 16:9 (YouTube), 9:16 (Shorts, TikTok, Reels) or both", default: "none").lowercased()
    options.makeLandscape = answer.contains("16:9") || answer.contains("16x9") || answer.hasPrefix("b")
    options.makeUpright = answer.contains("9:16") || answer.contains("9x16") || answer.hasPrefix("b")
}

struct Job {
    let run: Run
    let panel: Panel
    var placement: Placement
    let frameCount: Int
}

var jobs = selected.map { run -> Job in
    let title = options.titleFromFile && !run.name.isEmpty ? run.name : options.title
    let scale = CGFloat(min(run.width, run.height)) / 1080 * CGFloat(options.userScale)
    let panel = Panel(race: run.race, scale: scale, accent: accentRGB, title: title, badge: options.badge,
                      event: options.event, track: run.track, maxRows: options.maxRows)
    let placement = place(panel: panel, frameWidth: run.width, frameHeight: run.height, position: options.position, margin: CGFloat(options.margin))
    let endSeconds = Double(run.race.bounds.last!) / unitsPerSecond + options.hold
    return Job(run: run, panel: panel, placement: placement, frameCount: Int((endSeconds * run.fps.value).rounded(.up)) + 1)
}

if let stillPath = options.stillPath, let stillTime = options.stillTime {
    guard jobs.count == 1 else { fail("--still works on one run at a time. Add --only-best 1 or give a single marker file.") }
    guard let seconds = markerSeconds(stillTime, fps: jobs[0].run.fps) else { fail("--still needs a time.") }
    let background = options.stillBackground.flatMap(parseHexColor)
    writeStill(to: URL(fileURLWithPath: stillPath), panel: jobs[0].panel, placement: jobs[0].placement, seconds: seconds, background: background)
    print("Wrote \(stillPath)")
    exit(0)
}

var compact = options.compact
if options.makeOverlay {
    // ProRes 4444 costs roughly 0.34 bytes per pixel of panel and 0.045 per pixel of empty frame.
    func gigabytes(_ job: Job, compact: Bool) -> Double {
        let panelPixels = Double(job.panel.pixelWidth * job.panel.pixelHeight)
        let emptyPixels = compact ? 0 : Double(job.run.width * job.run.height) - panelPixels
        return (0.34 * panelPixels + 0.045 * emptyPixels) * Double(job.frameCount) / 1e9
    }
    let fullFrameGigabytes = jobs.map { gigabytes($0, compact: false) }.reduce(0, +)
    let compactGigabytes = jobs.map { gigabytes($0, compact: true) }.reduce(0, +)
    if options.interactive && !compact && fullFrameGigabytes > 2 {
        let subject = jobs.count == 1 ? "A full-frame overlay for this sequence" : "Full-frame overlays for these \(jobs.count) runs"
        print(String(format: "\n\(subject) will come to about %.1f GB. Panel-sized clips would be about\n%.1f GB, but you'd move them into the corner yourself in Premiere.", fullFrameGigabytes, compactGigabytes))
        compact = ask("Make the smaller kind? (y/n)", default: "n").lowercased().hasPrefix("y")
    }
    if compact {
        for index in jobs.indices {
            let panel = jobs[index].panel
            jobs[index].placement = Placement(frameWidth: panel.pixelWidth + panel.pixelWidth % 2, frameHeight: panel.pixelHeight + panel.pixelHeight % 2, x: 0, y: 0)
        }
    }

    // Stop before filling the disk rather than part-way through a batch.
    let neededGigabytes = compact ? compactGigabytes : fullFrameGigabytes
    let volume = jobs[0].run.outputURL.deletingLastPathComponent()
    if let free = try? volume.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]).volumeAvailableCapacityForImportantUsage,
       Double(free) / 1e9 < neededGigabytes * 1.1 {
        fail(String(format: "Not enough disk space: this needs about %.1f GB and %.1f GB is free. Free some space, make fewer runs (--only-best), or use --compact.", neededGigabytes, Double(free) / 1e9))
    }

    for (index, job) in jobs.enumerated() {
        let label = jobs.count == 1 ? "Rendering overlay" : "Rendering overlay \(index + 1) of \(jobs.count), \(job.run.name)"
        writeMovie(to: job.run.outputURL, panel: job.panel, placement: job.placement, fps: job.run.fps, frameCount: job.frameCount, label: label)
    }

    let sequenceStart = options.sequenceStart ?? "00:00:00:00"
    let destination = jobs[0].run.outputURL.deletingLastPathComponent()
    if jobs.count == 1 {
        print("""
        Wrote \(jobs[0].run.outputURL.path)

        In Premiere: import that file and put it on a track above your footage, starting at the very
        beginning of the sequence (\(sequenceStart)). It lines up with your markers from there.
        """)
    } else {
        let oneFolder = jobs.allSatisfy { $0.run.outputURL.deletingLastPathComponent() == destination }
        print("Wrote \(jobs.count) overlays" + (oneFolder ? " in \(destination.path):" : ":"))
        for job in jobs { print("  " + (oneFolder ? job.run.outputURL.lastPathComponent : job.run.outputURL.path)) }
        print("""

        In Premiere: import them and put each one on a track above the footage in its own sequence,
        starting at the very beginning of that sequence (\(sequenceStart)). Each lines up with its markers from there.
        """)
    }
    if compact {
        print("These are panel-sized clips, so they land in the middle of the frame: select one and change\nEffect Controls > Motion > Position to move it where you want it.")
    }
}

// Finished videos, cut from just before lap 1 to just after the last lap.
var finishedVideos: [URL] = []
let shapes: [VideoShape] = (options.makeLandscape ? [.landscape] : []) + (options.makeUpright ? [.upright] : [])
if !shapes.isEmpty {
    for (index, job) in jobs.enumerated() {
        let run = job.run
        guard let clipPath = run.clipPath else {
            print("No finished video for \(run.name.isEmpty ? "this run" : run.name): there's no race clip with that name to make it from.")
            continue
        }
        let gate = Double(run.race.bounds[0]) / unitsPerSecond
        var start = max(0, gate - options.leadIn)
        var end = Double(run.race.bounds.last!) / unitsPerSecond + options.hold
        var sound: (url: URL, clipTimeAtStart: Double)?
        if options.noMusic {
            // Silent on request, whatever is in the music folder.
        } else if let chosen = options.musicPath {
            // A song placed against the clip in the app.
            let music = URL(fileURLWithPath: chosen)
            sound = (music, options.musicStart ?? options.videoStart ?? start)
            print("Sound: \(music.lastPathComponent), placed where you put it in Markers & music.")
        } else if let markers = run.markersPath, let music = findMusic(forMarkers: markers, run: run.name),
           let length = loadSound(of: AVURLAsset(url: music))?.duration {
            // A music file named after the run is taken to be the sound of the run's Premiere sequence, so it
            // belongs wherever that sequence starts in the clip. A saved project that matches the file says
            // exactly where; failing that, the sequence is assumed to end when the timer overlay does.
            let placement = projectFiles(near: markers).lazy
                .compactMap { timelinePlacement(ofClip: clipPath, inProject: $0) }
                .first { abs($0.sequenceDuration - length) < 0.4 }
            // The timer overlay is the anchor when it's on the timeline: the music keeps its place against the timer.
            let musicStart = placement.map { $0.timerTimeAtSequenceStart ?? $0.clipTimeAtSequenceStart } ?? end + 1 / run.fps.value - length
            sound = (music, musicStart)
            if musicStart <= gate - 0.25 { start = max(0, musicStart) }
            if let placement {
                print("Sound: \(music.lastPathComponent), lined up from the \(placement.sequence) sequence in Premiere.")
                if abs(placement.timerSlip) > 0.05 {
                    let direction = placement.timerSlip > 0 ? "early" : "late"
                    print(String(format: "Note: in that Premiere sequence the timer overlay runs %.1f seconds \(direction) against the clip, so it is showing over different laps from the ones it timed. This video uses the laps that were timed.", abs(placement.timerSlip)))
                }
            } else {
                print("Sound: \(music.lastPathComponent), lined up to end when the timer does.")
                print("Note: the saved Premiere project doesn't match that music file, so the line-up is a best guess. Save the project in Premiere and make the video again for an exact one.")
            }
        }
        // A stretch chosen in the app wins over one worked out from the laps or the music.
        if let chosen = options.videoStart { start = max(0, chosen) }
        if let chosen = options.videoEnd { end = chosen }
        guard end > start else {
            print("No finished video for \(run.name.isEmpty ? "this run" : run.name): the stretch to show ends before it starts.")
            continue
        }
        let direct = URL(fileURLWithPath: clipPath)
        let clip = loadTracks(of: AVURLAsset(url: direct)) != nil
            ? ReadableClip(url: direct, offset: 0, temporary: false)
            : rewrapTransportStream(path: clipPath, from: start, to: end)
        guard let clip else {
            print("No finished video for \(run.name): \(direct.lastPathComponent) can't be read.")
            continue
        }
        let base = run.name.isEmpty ? direct.deletingPathExtension().lastPathComponent : run.name
        let title = options.titleFromFile && !run.name.isEmpty ? run.name : options.title
        for shape in shapes {
            let folder = finishedFolder(shape, forOverlayFolder: run.outputURL.deletingLastPathComponent())
            try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let output = nextNumbered(in: folder, base: base, ext: "mp4")
            let label = jobs.count == 1 ? "Rendering \(shape.name) video" : "Rendering \(shape.name) video \(index + 1) of \(jobs.count), \(run.name)"
            let problem = writeFinishedVideo(shape: shape, clip: clip, race: run.race, from: start, to: end, accent: accentRGB,
                                             title: title, badge: options.badge, event: options.event, track: run.track,
                                             sound: sound, options: options, to: output, label: label)
            if let problem {
                print("No \(shape.name) video for \(run.name): \(problem).")
            } else {
                finishedVideos.append(output)
                print("Wrote \(output.path)")
            }
        }
        if clip.temporary { try? FileManager.default.removeItem(at: clip.url) }
    }
    if !finishedVideos.isEmpty {
        print("\nThe finished videos are .mp4 files ready to upload: 16:9 for YouTube, 9:16 for Shorts, TikTok and Reels.")
    }
}

if options.interactive {
    let made = (options.makeOverlay ? jobs.map(\.run.outputURL) : []) + finishedVideos
    if !made.isEmpty { NSWorkspace.shared.activateFileViewerSelecting(made) }
}
