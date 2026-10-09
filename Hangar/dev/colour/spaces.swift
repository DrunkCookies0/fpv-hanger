import CoreGraphics
import Foundation
// How macOS itself turns a level of grey from one colour space into another.
let srgb = CGColorSpace(name: CGColorSpace.sRGB)!, video = CGColorSpace(name: CGColorSpace.itur_709)!, linear = CGColorSpace(name: CGColorSpace.extendedLinearSRGB)!
func turn(_ v: Double, from: CGColorSpace, to: CGColorSpace) -> Double {
    Double(CGColor(colorSpace: from, components: [CGFloat(v), CGFloat(v), CGFloat(v), 1])!.converted(to: to, intent: .relativeColorimetric, options: nil)!.components![0])
}
print("level  sRGB->709  sRGB->linear  709->linear   (and the textbook answers)")
for level in [0, 4, 8, 16, 32, 64, 96, 128, 160, 192, 224, 255] {
    let v = Double(level) / 255
    let book = v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4)
    let book709 = v < 0.081 ? v / 4.5 : pow((v + 0.099) / 1.099, 1 / 0.45)
    let enc = book < 0.018 ? 4.5 * book : 1.099 * pow(book, 0.45) - 0.099
    print(String(format: "%3d   %7.2f     %.5f      %.5f     (%7.2f  %.5f  %.5f, pure 1.961: %.5f)", level, turn(v, from: srgb, to: video) * 255, turn(v, from: srgb, to: linear), turn(v, from: video, to: linear), enc * 255, book, book709, pow(v, 1.961)))
}
let red = CGColor(colorSpace: srgb, components: [1, 0, 0, 1])!.converted(to: video, intent: .relativeColorimetric, options: nil)!.components!
print("sRGB red in the video space:", red.map { String(format: "%.4f", Double($0)) }.joined(separator: " "))
