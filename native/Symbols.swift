import AppKit

guard CommandLine.arguments.count == 2, !CommandLine.arguments[1].isEmpty else {
    fputs("Usage: canvas-symbols <output-directory>\n", stderr)
    exit(EX_USAGE)
}
let folder = CommandLine.arguments[1]
var symbols:[String:String]=["loop":"repeat","canvas":"square.dashed","hand":"hand.draw","cursor":"cursorarrow","text":"textformat","rectangle":"rectangle","ellipse":"circle","undo":"arrow.uturn.backward","redo":"arrow.uturn.forward","chevronLeft":"chevron.left","chevronRight":"chevron.right","settings":"gearshape","activity":"clock.arrow.circlepath","health":"checkmark.shield","grid":"square.grid.2x2","layout":"line.3.horizontal.decrease","folder":"folder","image":"photo","video":"film","audio":"headphones","star":"star","tag":"tag","trash":"trash","link":"link","play":"play.fill","pause":"pause.fill","volume":"speaker.wave.2","mute":"speaker.slash","expand":"arrow.up.left.and.arrow.down.right","file":"doc","sidebar":"sidebar.left","plus":"plus","search":"magnifyingglass","heart":"heart","lightbulb":"lightbulb","briefcase":"briefcase","paintbrush":"paintbrush","camera":"camera","book":"book","leaf":"leaf","sparkles":"sparkles","house":"house","flag":"flag","archive":"tray","download":"arrow.down.to.line","export":"square.and.arrow.up","keyboard":"keyboard","close":"xmark","reload":"arrow.clockwise"]
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
try FileManager.default.createDirectory(atPath:folder,withIntermediateDirectories:true)
for (key,symbol) in symbols {
 guard let original=NSImage(systemSymbolName:symbol,accessibilityDescription:nil),let image=original.withSymbolConfiguration(.init(pointSize:22,weight:.regular)) else {fatalError("Missing symbol \(symbol)")}
 let size=NSSize(width:48,height:48),out=NSImage(size:size)
 out.lockFocus();NSColor.black.set();let factor=min(40/image.size.width,40/image.size.height);let rect=NSRect(x:(48-image.size.width*factor)/2,y:(48-image.size.height*factor)/2,width:image.size.width*factor,height:image.size.height*factor);image.draw(in:rect);out.unlockFocus()
 guard let tiff=out.tiffRepresentation,let rep=NSBitmapImageRep(data:tiff),let data=rep.representation(using:.png,properties:[:]) else{fatalError("Cannot render symbol")}
 try data.write(to:URL(fileURLWithPath:folder+"/"+key+".png"))
}
