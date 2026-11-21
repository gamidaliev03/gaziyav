// icon.icns is brand/family/icon.icns, and this file's output is kept as icon.krylo.icns; running it overwrites icon.icns.
// Draws the Gaziyav icon — «Крыло»:  three opaque feathers (grey, cream, amber with a gloss)
// fanned from one root, separated by a dark outline, a soft amber glow under them, on a night tile in the Big Sur shape.
// The master is ROOT/preview/logo/krylo-v2.svg (512 grid); the in-app mark is apps/web/src/components/brand/krylo-mark.tsx.
// 128 px and up: the master with depth (the gloss, a soft shadow under each feather and under the tile).
// 16 / 32 / 64 px are drawn on their own pixel grids: three plain feathers, a 1 px gap (2 px at 64), no glow, no outline
//   swift make_icon.swift out.png [--size N] [--bare]     one PNG (default 1024; --bare: the feathers alone, transparent)
//   swift make_icon.swift --iconset dir.iconset            every size of icon.icns (then: iconutil -c icns dir.iconset)
//   swift make_icon.swift --pngs dir 16,32,96,…            square PNGs named icon-<N>.png (the page icons)
//   swift make_icon.swift --sheet out.png dir.iconset      the contact sheet: every size on dark and light, a Dock mock
import AppKit

func hex(_ v: UInt32, _ a: CGFloat = 1) -> CGColor {
	CGColor(srgbRed: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255, blue: CGFloat(v & 0xff) / 255, alpha: a)
}
func gradient(_ stops: [(CGFloat, CGColor)]) -> CGGradient {
	CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB)!, colors: stops.map { $0.1 } as CFArray, locations: stops.map { $0.0 })!
}

/// A canvas of exactly n×n pixels; `draw` gets a y-down context.
func render(_ n: Int, _ draw: (CGContext) -> Void) -> NSBitmapImageRep {
	let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: n, pixelsHigh: n, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
	rep.size = NSSize(width: n, height: n)
	let g = NSGraphicsContext(bitmapImageRep: rep)!
	NSGraphicsContext.saveGraphicsState()
	NSGraphicsContext.current = g
	let ctx = g.cgContext
	ctx.translateBy(x: 0, y: CGFloat(n))
	ctx.scaleBy(x: 1, y: -1)
	draw(ctx)
	NSGraphicsContext.restoreGraphicsState()
	return rep
}
func save(_ rep: NSBitmapImageRep, _ path: String) {
	try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
}

// The feathers in the master's 512 grid: length of the rounded bar, its angle (SVG rotate, degrees), its colours.
struct Feather { let w: CGFloat; let angle: CGFloat; let from: UInt32; let to: UInt32; let flat: UInt32 }
let FEATHERS = [
	Feather(w: 168, angle: -68, from: 0x585C66, to: 0x8B909B, flat: 0x7A7F89),
	Feather(w: 214, angle: -37, from: 0xCFC9BD, to: 0xF6F3EC, flat: 0xEBE6DC),
	Feather(w: 262, angle: -6, from: 0xFF6F2C, to: 0xFFD98A, flat: 0xFF9A3C),
]
let ROOT = CGPoint(x: 163 - 22, y: 341 - 22) // the fan's root in the 512 grid (the SVG's group is moved by −22, −22)

/// The master (≥ 128 px): drawn in the 512 grid, scaled to n.
func master(_ ctx: CGContext, _ n: Int, tile: Bool, depth: Bool) {
	let k = CGFloat(n) / 512
	ctx.scaleBy(x: k, y: k)
	let tileRect = CGRect(x: 50, y: 50, width: 412, height: 412)
	let tilePath = CGPath(roundedRect: tileRect, cornerWidth: 92, cornerHeight: 92, transform: nil)
	if tile {
		// a soft shadow under the tile (device-space units: they don't follow the scale)
		ctx.saveGState()
		if depth { ctx.setShadow(offset: CGSize(width: 0, height: -7 * k), blur: 16 * k, color: hex(0x000000, 0.42)) }
		ctx.addPath(tilePath)
		ctx.setFillColor(hex(0x0B0C0F))
		ctx.fillPath()
		ctx.restoreGState()
		ctx.saveGState()
		ctx.addPath(tilePath)
		ctx.clip()
		ctx.drawLinearGradient(gradient([(0, hex(0x26282E)), (1, hex(0x0B0C0F))]), start: CGPoint(x: 0, y: 50), end: CGPoint(x: 0, y: 462), options: [])
		// the amber glow under the fan
		ctx.saveGState()
		ctx.translateBy(x: 262, y: 318)
		ctx.scaleBy(x: 1, y: 70.0 / 170.0)
		ctx.drawRadialGradient(gradient([(0, hex(0xFF8A2B, 0.32)), (1, hex(0xFF8A2B, 0))]), startCenter: .zero, startRadius: 0, endCenter: .zero, endRadius: 170, options: [])
		ctx.restoreGState()
		ctx.restoreGState()
		// the tile's edge light
		ctx.saveGState()
		ctx.addPath(CGPath(roundedRect: tileRect.insetBy(dx: 0.75, dy: 0.75), cornerWidth: 91.25, cornerHeight: 91.25, transform: nil))
		ctx.setLineWidth(1.5)
		ctx.replacePathWithStrokedPath()
		ctx.clip()
		ctx.drawLinearGradient(gradient([(0, hex(0xFFFFFF, 0.18)), (0.5, hex(0xFFFFFF, 0))]), start: CGPoint(x: 0, y: 50), end: CGPoint(x: 0, y: 462), options: [])
		ctx.restoreGState()
	}
	for f in FEATHERS {
		ctx.saveGState()
		ctx.translateBy(x: ROOT.x, y: ROOT.y)
		ctx.rotate(by: f.angle * .pi / 180)
		let bar = CGPath(roundedRect: CGRect(x: -25, y: -25, width: f.w, height: 50), cornerWidth: 25, cornerHeight: 25, transform: nil)
		// the dark outline first (SVG paint-order: stroke), with the feather's soft shadow under it
		ctx.saveGState()
		if depth { ctx.setShadow(offset: CGSize(width: 0, height: -4 * k), blur: 10 * k, color: hex(0x000000, 0.5)) }
		ctx.addPath(bar)
		ctx.setLineWidth(9)
		ctx.setStrokeColor(hex(0x15171B))
		ctx.setLineJoin(.round)
		ctx.strokePath()
		ctx.restoreGState()
		ctx.saveGState()
		ctx.addPath(bar)
		ctx.clip()
		ctx.drawLinearGradient(gradient([(0, hex(f.from)), (1, hex(f.to))]), start: CGPoint(x: -25, y: 0), end: CGPoint(x: f.w - 25, y: 0), options: [])
		ctx.restoreGState()
		if f.angle == -6 {
			// the gloss on the amber feather
			let gloss = CGPath(roundedRect: CGRect(x: -17, y: -20, width: 246, height: 20), cornerWidth: 10, cornerHeight: 10, transform: nil)
			ctx.addPath(gloss)
			ctx.clip()
			ctx.drawLinearGradient(gradient([(0, hex(0xFFFFFF, 0.38)), (0.55, hex(0xFFFFFF, 0))]), start: CGPoint(x: 0, y: -20), end: CGPoint(x: 0, y: 0), options: [])
		}
		ctx.restoreGState()
	}
}

/// 16 / 32 / 64: their own pixel grid. The tile in the Big Sur proportions, three flat feathers of whole-pixel thickness,
/// a gap of 1 px (2 px at 64) in the tile's dark between them, no glow, no shadow.
func small(_ ctx: CGContext, _ n: Int, tile: Bool) {
	let s = CGFloat(n)
	let (inset, radius, thick, gap): (CGFloat, CGFloat, CGFloat, CGFloat) =
		n <= 16 ? (1, 3.5, 2, 1) : n <= 32 ? (2, 6.5, 4, 1) : (6, 11.5, 7, 2)
	let side = s - 2 * inset
	if tile {
		let path = CGPath(roundedRect: CGRect(x: inset, y: inset, width: side, height: side), cornerWidth: radius, cornerHeight: radius, transform: nil)
		ctx.saveGState()
		ctx.addPath(path)
		ctx.clip()
		ctx.drawLinearGradient(gradient([(0, hex(0x2C2E35)), (1, hex(0x101115))]), start: CGPoint(x: 0, y: inset), end: CGPoint(x: 0, y: s - inset), options: [])
		ctx.restoreGState()
	}
	// Its own geometry (hand-tuned, in parts of the tile): the fan fills more of the tile than in the master, so the
	// three feathers still read at 16 px; the root on the pixel grid (whole-pixel edges on the flat feather).
	let unitRoot = CGPoint(x: 0.17, y: 0.72)
	let lengths: [CGFloat] = [0.42, 0.54, 0.68] // grey, cream, amber (from the root's centre)
	var root = CGPoint(x: inset + unitRoot.x * side, y: inset + unitRoot.y * side)
	let half: CGFloat = thick.truncatingRemainder(dividingBy: 2) == 0 ? 0 : 0.5
	root = CGPoint(x: root.x.rounded() + half, y: root.y.rounded() + half)
	for (i, f) in FEATHERS.enumerated() {
		ctx.saveGState()
		ctx.translateBy(x: root.x, y: root.y)
		// at 16 px the amber feather lies flat (a crisp 2 px bar), the other two open a little wider
		let angle = n <= 16 ? [-72, -40, 0][i] : f.angle
		ctx.rotate(by: CGFloat(angle) * .pi / 180)
		let length = lengths[i] * side
		let r = thick / 2
		let bar = CGPath(roundedRect: CGRect(x: -r, y: -r, width: length + r, height: thick), cornerWidth: r, cornerHeight: r, transform: nil)
		ctx.addPath(bar)
		ctx.setLineWidth(gap * 2)
		ctx.setStrokeColor(hex(0x111216))
		ctx.strokePath()
		ctx.addPath(bar)
		ctx.setFillColor(hex(f.flat))
		ctx.fillPath()
		ctx.restoreGState()
	}
}

func icon(_ n: Int, bare: Bool = false) -> NSBitmapImageRep {
	render(n) { ctx in
		if n < 100 { small(ctx, n, tile: !bare) } else { master(ctx, n, tile: !bare, depth: true) }
	}
}

let args = CommandLine.arguments
if args.count > 2 && args[1] == "--iconset" {
	let dir = args[2]
	try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
	for (name, n) in [("16x16", 16), ("16x16@2x", 32), ("32x32", 32), ("32x32@2x", 64), ("128x128", 128), ("128x128@2x", 256), ("256x256", 256), ("256x256@2x", 512), ("512x512", 512), ("512x512@2x", 1024)] {
		save(icon(n), "\(dir)/icon_\(name).png")
	}
} else if args.count > 3 && args[1] == "--pngs" {
	try? FileManager.default.createDirectory(atPath: args[2], withIntermediateDirectories: true)
	for n in args[3].split(separator: ",").compactMap({ Int($0) }) { save(icon(n), "\(args[2])/icon-\(n).png") }
} else if args.count > 3 && args[1] == "--sheet" {
	// every size on dark and on light, at 1:1 pixels, and a Dock mock (the 128 rendering at Dock size between two neighbours)
	let sizes = [16, 32, 64, 128, 256, 512]
	let W = 1720, H = 1300, band = H / 2
	let out = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: W, pixelsHigh: H, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
	let g = NSGraphicsContext(bitmapImageRep: out)!
	NSGraphicsContext.saveGraphicsState()
	NSGraphicsContext.current = g
	let ctx = g.cgContext
	ctx.setFillColor(hex(0x1C1D21)); ctx.fill(CGRect(x: 0, y: band, width: W, height: band))
	ctx.setFillColor(hex(0xF2F1EE)); ctx.fill(CGRect(x: 0, y: 0, width: W, height: band))
	for bottom in [band, 0] {
		var x = 40
		for n in sizes {
			icon(n).draw(in: NSRect(x: x, y: bottom + (band - n) / 2, width: n, height: n), from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: false, hints: [.interpolation: NSImageInterpolation.none.rawValue])
			x += n + 36
		}
	}
	// the Dock mock, bottom right on the light band: a frosted shelf, two neighbours, ours in the middle
	let shelf = CGRect(x: 1330, y: 40, width: 360, height: 128)
	ctx.addPath(CGPath(roundedRect: shelf, cornerWidth: 24, cornerHeight: 24, transform: nil))
	ctx.setFillColor(hex(0xFFFFFF, 0.55)); ctx.fillPath()
	for (i, color) in [(0, hex(0x5E8BD6)), (2, hex(0x9AA0A8))] {
		let r = CGRect(x: shelf.minX + 20 + CGFloat(i) * 112, y: shelf.minY + 16, width: 96, height: 96).insetBy(dx: 8, dy: 8)
		ctx.addPath(CGPath(roundedRect: r, cornerWidth: 18, cornerHeight: 18, transform: nil))
		ctx.setFillColor(color); ctx.fillPath()
	}
	icon(256).draw(in: NSRect(x: shelf.minX + 132, y: shelf.minY + 16, width: 96, height: 96), from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: false, hints: [.interpolation: NSImageInterpolation.high.rawValue])
	NSGraphicsContext.restoreGraphicsState()
	save(out, args[2])
} else if args.count > 1 {
	let n = args.firstIndex(of: "--size").flatMap { Int(args[$0 + 1]) } ?? 1024
	save(icon(n, bare: args.contains("--bare")), args[1])
}
