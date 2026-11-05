import Foundation
import Vision
import PDFKit
import ImageIO

@main struct AnalyzeTool {
 static func detailedOCRImage(_ file: URL) -> CGImage? {
  // PNG screenshots can carry text too small for the gallery thumbnail.
  guard file.pathExtension.lowercased()=="png",
        let source=CGImageSourceCreateWithURL(file as CFURL,[kCGImageSourceShouldCache:false] as CFDictionary),
        let properties=CGImageSourceCopyPropertiesAtIndex(source,0,nil) as? [CFString:Any],
        let width=properties[kCGImagePropertyPixelWidth] as? Double,
        let height=properties[kCGImagePropertyPixelHeight] as? Double,
        width>0,height>0,max(width,height)>480,width*height<=32_000_000 else { return nil }
  return CGImageSourceCreateThumbnailAtIndex(source,0,[
   kCGImageSourceCreateThumbnailFromImageAlways:true,
   kCGImageSourceCreateThumbnailWithTransform:true,
   kCGImageSourceThumbnailMaxPixelSize:1200
  ] as CFDictionary)
 }
 static func main() {
  do {
   guard CommandLine.arguments.count == 3 else { throw NSError(domain:"Arguments",code:1) }
   let file=URL(fileURLWithPath:CommandLine.arguments[1]), preview=URL(fileURLWithPath:CommandLine.arguments[2])
   var extracted="", labels=[[String:Any]]()
   var firstPageHasText=false
   if file.pathExtension.lowercased()=="pdf", let pdf=PDFDocument(url:file) {
    firstPageHasText = !(pdf.page(at:0)?.string ?? "").trimmingCharacters(in:.whitespacesAndNewlines).isEmpty
    extracted=(0..<min(pdf.pageCount,15)).compactMap{pdf.page(at:$0)?.string}.joined(separator:"\n")
   }
   let handler=VNImageRequestHandler(url:preview,options:[:])
   var ocrError: String?
   if !firstPageHasText {
    let ocr=VNRecognizeTextRequest()
    ocr.recognitionLevel = .fast
    ocr.usesLanguageCorrection=false
    ocr.usesCPUOnly=true
    do {
     let textHandler=detailedOCRImage(file).map{VNImageRequestHandler(cgImage:$0,options:[:])} ?? handler
     try textHandler.perform([ocr])
     let words=(ocr.results ?? []).compactMap{$0.topCandidates(1).first?.string}.joined(separator:"\n")
     if !words.isEmpty { extracted += "\n"+words }
    } catch { ocrError=error.localizedDescription }
   }
   let classify=VNClassifyImageRequest();classify.usesCPUOnly=true
   try? handler.perform([classify])
   for result in (classify.results ?? []).prefix(8) where result.confidence>=0.12 {
    labels.append(["label":result.identifier.replacingOccurrences(of:"_",with:" "),"confidence":result.confidence])
   }
   var result: [String:Any]=["text":String(extracted.prefix(50000)),"labels":labels]
   if let error=ocrError { result["ocrError"]=error }
   let data=try JSONSerialization.data(withJSONObject:result)
   FileHandle.standardOutput.write(data)
  } catch { fputs("Local analysis: \(error.localizedDescription)\n",stderr);exit(1) }
 }
}
