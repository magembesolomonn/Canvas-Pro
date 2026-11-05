import AppKit
import Foundation
let output=CommandLine.arguments[1]
try FileManager.default.createDirectory(atPath:output,withIntermediateDirectories:true)
for (name,w,h,color) in [("Portrait",600,900,NSColor(calibratedRed:0.75,green:0.55,blue:0.43,alpha:1)),("Landscape",960,540,NSColor(calibratedRed:0.27,green:0.45,blue:0.49,alpha:1)),("Square",640,640,NSColor(calibratedRed:0.46,green:0.48,blue:0.70,alpha:1))] {
 let image=NSImage(size:NSSize(width:w,height:h));image.lockFocus();color.setFill();NSBezierPath(rect:NSRect(x:0,y:0,width:w,height:h)).fill();NSColor(calibratedWhite:0.92,alpha:1).setFill();NSBezierPath(ovalIn:NSRect(x:Double(w)*0.2,y:Double(h)*0.2,width:Double(w)*0.6,height:Double(w)*0.6)).fill();let attributes:[NSAttributedString.Key:Any]=[.font:NSFont.systemFont(ofSize:30,weight:.medium),.foregroundColor:NSColor.white];(name+" study" as NSString).draw(at:NSPoint(x:35,y:h-65),withAttributes:attributes);image.unlockFocus();let bitmap=NSBitmapImageRep(data:image.tiffRepresentation!)!;try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:output+"/"+name+".png"))
}
