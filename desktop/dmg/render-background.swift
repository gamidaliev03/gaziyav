// Draws the DMG window background (1320×800 px = 660×400 pt @2x): a light brand canvas (Finder draws the icon labels
// in black on a picture, so the art is light), the Gaziyav mark with the Gaziyav wordmark, a pink→violet arrow from
// the app to Applications, and the "How to open" lines kept above y = 360 pt (visible even with Finder's path bar on).
// Usage: swift render-background.swift <Unbounded.ttf | -> <out@2x.png> <line> [<line>…]
import AppKit
import CoreText

let args = CommandLine.arguments
let W = 1320.0, H = 800.0
if args[1] != "-" { CTFontManagerRegisterFontsForURL(URL(fileURLWithPath: args[1]) as CFURL, .process, nil) }
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(W), pixelsHigh: Int(H), bitsPerSample: 8, samplesPerPixel: 4,
                           hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let ctx = NSGraphicsContext.current!.cgContext
func rgb(_ hex: UInt32, _ a: CGFloat = 1) -> NSColor {
	NSColor(srgbRed: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: a)
}
/// Points from the top-left (like Finder's icon positions) → AppKit's bottom-left pixels.
func y(_ top: Double) -> Double { H - top * 2 }

// Canvas: warm paper with a soft gold glow behind the wordmark.
NSGradient(starting: rgb(0xFFFCF6), ending: rgb(0xF6F1E7))!.draw(in: NSRect(x: 0, y: 0, width: W, height: H), angle: -90)
NSGradient(colors: [rgb(0xE8A33D, 0.16), rgb(0xE8A33D, 0)])!.draw(fromCenter: NSPoint(x: W / 2, y: y(70)), radius: 0, toCenter: NSPoint(x: W / 2, y: y(70)), radius: 520, options: [])

// The Gaziyav mark: the app's own icon (icon.icns — the mountains tile since 1.0.65; the wing master is icon.krylo.icns;
// make_icon.swift draws the wing and would overwrite it),
// drawn at the mark's size so the window shows exactly what lands in /Applications.
func mark(cx: Double, cy: Double, size: Double) {
	let path = ProcessInfo.processInfo.environment["GAZIYAV_ICON"] ?? "icon.icns"
	guard let icon = NSImage(contentsOfFile: path) else { return }
	let side = size * 1.24 // the icon's tile is 824/1024 of its canvas: the tile itself is `size` wide
	icon.draw(in: NSRect(x: cx - side / 2, y: cy - side / 2, width: side, height: side), from: .zero, operation: .sourceOver, fraction: 1)
}
let wordFont = NSFont(name: "Unbounded", size: 64) ?? NSFont.systemFont(ofSize: 64, weight: .bold)
let word = NSAttributedString(string: "Gaziyav", attributes: [.font: wordFont, .foregroundColor: rgb(0x14110A)])
let markSize = 70.0, gap = 18.0
let total = markSize + gap + word.size().width
let left = (W - total) / 2
mark(cx: left + markSize / 2, cy: y(78), size: markSize)
word.draw(at: NSPoint(x: left + markSize + gap, y: y(78) - word.size().height / 2 + 4))

// Arrow from the app (170, 200) to Applications (490, 200): a gold→teal stroke with a round head.
let ay = y(200), ax0 = 270.0 * 2, ax1 = 392.0 * 2
let shaft = NSBezierPath()
shaft.move(to: NSPoint(x: ax0, y: ay))
shaft.line(to: NSPoint(x: ax1, y: ay))
shaft.move(to: NSPoint(x: ax1 - 26, y: ay + 22))
shaft.line(to: NSPoint(x: ax1, y: ay))
shaft.line(to: NSPoint(x: ax1 - 26, y: ay - 22))
shaft.lineWidth = 7
shaft.lineCapStyle = .round
shaft.lineJoinStyle = .round
ctx.saveGState()
ctx.addPath(shaft.cgPath)
ctx.setLineWidth(7)
ctx.setLineCap(.round)
ctx.setLineJoin(.round)
ctx.replacePathWithStrokedPath()
ctx.clip()
NSGradient(starting: rgb(0xE8A33D), ending: rgb(0x2BB3A6))!.draw(in: NSRect(x: ax0 - 10, y: ay - 30, width: ax1 - ax0 + 20, height: 60), angle: 0)
ctx.restoreGState()

// The "How to open" lines, centred, between y = 296 and 352 pt.
let style = NSMutableParagraphStyle()
style.alignment = .center
let lines = Array(args.dropFirst(3))
for (i, line) in lines.enumerated() {
	let first = i == 0
	let attrs: [NSAttributedString.Key: Any] = [
		.font: NSFont.systemFont(ofSize: first ? 25 : 22, weight: first ? .semibold : .regular),
		.foregroundColor: first ? rgb(0x1A1724, 0.86) : rgb(0x1A1724, 0.55),
		.paragraphStyle: style,
	]
	let top = 296.0 + Double(i) * 19
	NSAttributedString(string: line, attributes: attrs).draw(in: NSRect(x: 40, y: y(top) - 40, width: W - 80, height: 40))
}
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
