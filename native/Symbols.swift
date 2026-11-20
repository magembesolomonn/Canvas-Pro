import AppKit

// Two modes:
//   canvas-symbols <output-directory>   — batch-render the fallback PNG set
//   canvas-symbols --render <name> <pointSize> <weight> <scale> <out.png>
//                                       — render one symbol for the app at runtime

let args = CommandLine.arguments

func fail(_ message: String) -> Never {
    fputs(message + "\n", stderr)
    exit(EX_USAGE)
}

func fontWeight(named name: String) -> NSFont.Weight? {
    switch name {
    case "ultralight": return .ultraLight
    case "thin": return .thin
    case "light": return .light
    case "regular": return .regular
    case "medium": return .medium
    case "semibold": return .semibold
    case "bold": return .bold
    case "heavy": return .heavy
    case "black": return .black
    default: return nil
    }
}

func renderSymbol(symbolName: String, pointSize: CGFloat, weight: NSFont.Weight, scale: CGFloat) -> Data? {
    guard let base = NSImage(systemSymbolName: symbolName, accessibilityDescription: nil),
          let image = base.withSymbolConfiguration(.init(pointSize: pointSize, weight: weight)) else { return nil }
    let pixels = max(1, Int((pointSize * scale * 1.25).rounded()))
    guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
                                     bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                     colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
    rep.size = NSSize(width: CGFloat(pixels) / scale, height: CGFloat(pixels) / scale)
    guard let context = NSGraphicsContext(bitmapImageRep: rep) else { return nil }
    NSGraphicsContext.saveGraphicsState()
    defer { NSGraphicsContext.restoreGraphicsState() }
    NSGraphicsContext.current = context
    NSColor.clear.setFill()
    NSRect(x: 0, y: 0, width: rep.size.width, height: rep.size.height).fill(using: .copy)
    // Keep the symbol inside the canvas without clipping ascenders/descenders.
    let box = min(rep.size.width, rep.size.height) * 0.92
    let factor = min(box / image.size.width, box / image.size.height)
    let width = image.size.width * factor, height = image.size.height * factor
    let rect = NSRect(x: (rep.size.width - width) / 2, y: (rep.size.height - height) / 2, width: width, height: height)
    NSColor.black.set()
    image.draw(in: rect)
    return rep.representation(using: .png, properties: [:])
}

if args.count == 7 && args[1] == "--render" {
    guard let pointSize = Double(args[3]), pointSize > 0,
          let scale = Double(args[5]), scale > 0,
          let weight = fontWeight(named: args[4]) else { fail("Invalid render arguments") }
    guard let data = renderSymbol(symbolName: args[2], pointSize: pointSize, weight: weight, scale: scale) else {
        fail("Missing symbol \(args[2])")
    }
    do {
        try data.write(to: URL(fileURLWithPath: args[6]))
    } catch {
        fail("Cannot write \(args[6])")
    }
    exit(0)
}

guard args.count == 2, !args[1].isEmpty else {
    fputs("Usage: canvas-symbols <output-directory>\n       canvas-symbols --render <name> <pointSize> <weight> <scale> <out.png>\n", stderr)
    exit(EX_USAGE)
}
let folder = args[1]
var symbols:[String:String]=["loop":"repeat","canvas":"square.dashed","hand":"hand.draw","cursor":"cursorarrow","text":"textformat","rectangle":"rectangle","ellipse":"circle","undo":"arrow.uturn.backward","redo":"arrow.uturn.forward","chevronLeft":"chevron.left","chevronRight":"chevron.right","settings":"gearshape","activity":"clock.arrow.circlepath","health":"checkmark.shield","grid":"square.grid.2x2","layout":"rectangle.3.group","folder":"folder","image":"photo","video":"film","audio":"waveform","star":"star","tag":"tag","trash":"trash","link":"link","play":"play.fill","pause":"pause.fill","volume":"speaker.wave.2","mute":"speaker.slash","expand":"arrow.up.left.and.arrow.down.right","file":"doc","sidebar":"sidebar.left","plus":"plus","search":"magnifyingglass","heart":"heart","lightbulb":"lightbulb","briefcase":"briefcase","paintbrush":"paintbrush","camera":"camera","book":"book","leaf":"leaf","sparkles":"sparkles","house":"house","flag":"flag","archive":"tray","download":"arrow.down.to.line","export":"square.and.arrow.up","keyboard":"keyboard","close":"xmark","reload":"arrow.clockwise"]
symbols["pencil"]="pencil.tip"
symbols["arrow"]="arrow.up.right"
symbols["sticky"]="note.text"
symbols["list"]="list.bullet"
symbols["filter"]="line.3.horizontal.decrease.circle"
symbols["sort"]="arrow.up.arrow.down"
symbols["appearance"]="circle.lefthalf.filled"
symbols["extensions"]="puzzlepiece.extension"
symbols["developers"]="chevron.left.forwardslash.chevron.right"
symbols["about"]="info.circle"
symbols["experimental"]="flask"
symbols["importing"]="arrow.down.doc"
symbols["minus"]="minus"
symbols["eye"]="eye"
symbols["heading"]="textformat.size.larger"
symbols["checklist"]="checklist"
symbols["toggle"]="switch.2"
symbols["table"]="tablecells"
symbols["tracker"]="list.bullet.rectangle"
symbols["clipboard"]="clipboard"
symbols["library"]="rectangle.stack"
symbols["viewOptions"]="rectangle.3.group"
symbols["findSimilar"]="sparkle.magnifyingglass"
symbols["feedback"]="bubble.left"
symbols["plusMagnifier"]="plus.magnifyingglass"
symbols["minusMagnifier"]="minus.magnifyingglass"
symbols["resetZoom"]="arrow.counterclockwise"
symbols["pauseCircle"]="pause.circle"
symbols["playCircle"]="play.circle"
symbols["retry"]="arrow.triangle.2.circlepath"
symbols["duplicates"]="doc.on.doc"
symbols["waveform"]="waveform"
symbols["folderAdd"]="folder.badge.plus"
symbols["gobackward10"]="gobackward.10"
symbols["goforward10"]="goforward.10"
symbols["starFill"]="star.fill"
symbols["plusCircleFill"]="plus.circle.fill"
symbols["docText"]="doc.text"
symbols["inspector"]="sidebar.right"
try FileManager.default.createDirectory(atPath:folder,withIntermediateDirectories:true)
for (key,symbol) in symbols {
 guard let original=NSImage(systemSymbolName:symbol,accessibilityDescription:nil),let image=original.withSymbolConfiguration(.init(pointSize:22,weight:.regular)) else {fatalError("Missing symbol \(symbol)")}
 let size=NSSize(width:48,height:48),out=NSImage(size:size)
 out.lockFocus();NSColor.black.set();let factor=min(40/image.size.width,40/image.size.height);let rect=NSRect(x:(48-image.size.width*factor)/2,y:(48-image.size.height*factor)/2,width:image.size.width*factor,height:image.size.height*factor);image.draw(in:rect);out.unlockFocus()
 guard let tiff=out.tiffRepresentation,let rep=NSBitmapImageRep(data:tiff),let data=rep.representation(using:.png,properties:[:]) else{fatalError("Cannot render symbol")}
 try data.write(to:URL(fileURLWithPath:folder+"/"+key+".png"))
}
