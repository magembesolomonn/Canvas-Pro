import Foundation
import AVFoundation
import AppKit
import ImageIO
import UniformTypeIdentifiers

@main struct MediaTool {
    static func writeJPEG(_ image: NSImage, to url: URL) throws -> Bool {
        guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
              let data = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.82]) else { return false }
        try data.write(to: url, options: .atomic)
        return true
    }
    static func join(video: URL, audio: URL, output: URL) async throws {
        let composition = AVMutableComposition()
        for (url, type) in [(video, AVMediaType.video), (audio, AVMediaType.audio)] {
            let asset = AVURLAsset(url: url)
            guard let source = try await asset.loadTracks(withMediaType: type).first,
                  let track = composition.addMutableTrack(withMediaType: type, preferredTrackID: kCMPersistentTrackID_Invalid)
            else { throw NSError(domain: "Missing media track", code: 1) }
            let range = try await source.load(.timeRange)
            try track.insertTimeRange(range, of: source, at: .zero)
            if type == .video { track.preferredTransform = try await source.load(.preferredTransform) }
        }
        guard let session = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetPassthrough)
        else { throw NSError(domain: "Media export", code: 2) }
        session.outputURL = output
        session.outputFileType = .mp4
        await session.export()
        guard session.status == .completed else { throw session.error ?? NSError(domain: "Media export", code: 3) }
    }
    static func thumbnail(input: URL, output: URL, limit: Int, maxPixels: Double, portrait: Bool) throws {
        let failure = NSError(domain: "Image thumbnail", code: 1)
        guard let source = CGImageSourceCreateWithURL(input as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Double,
              let height = properties[kCGImagePropertyPixelHeight] as? Double,
              width > 0, height > 0, width * height <= maxPixels else { throw failure }
        let orientation = properties[kCGImagePropertyOrientation] as? Int ?? 1
        if portrait && ((5...8).contains(orientation) ? width < height * 1.15 : height < width * 1.15) {
            throw failure
        }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: limit,
            kCGImageSourceShouldCacheImmediately: true
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { throw failure }
        let jpeg = output.pathExtension == "jpg"
        guard let destination = CGImageDestinationCreateWithURL(output as CFURL, (jpeg ? UTType.jpeg.identifier : UTType.png.identifier) as CFString, 1, nil) else { throw failure }
        CGImageDestinationAddImage(destination, image, jpeg ? [kCGImageDestinationLossyCompressionQuality: 0.82] as CFDictionary : nil)
        guard CGImageDestinationFinalize(destination) else { throw failure }
    }
    static func main() async {
        do {
            let args = CommandLine.arguments
            if args.count == 7 && args[1] == "--thumbnail",
               let limit = Int(args[4]), (1...4096).contains(limit),
               let maxPixels = Double(args[5]), (1...200_000_000).contains(maxPixels) {
                try thumbnail(input: URL(fileURLWithPath: args[2]), output: URL(fileURLWithPath: args[3]),
                              limit: limit, maxPixels: maxPixels, portrait: args[6] == "portrait")
                return
            }
            if CommandLine.arguments.count == 5 && CommandLine.arguments[1] == "--join" {
                let urls = CommandLine.arguments[2...4].map { URL(fileURLWithPath: $0) }
                try await join(video: urls[0], audio: urls[1], output: urls[2])
                return
            }
            guard CommandLine.arguments.count == 3 else { throw NSError(domain: "Arguments", code: 1) }
            let asset = AVURLAsset(url: URL(fileURLWithPath: CommandLine.arguments[1]))
            let prefix = CommandLine.arguments[2]
            let duration = try await asset.load(.duration).seconds
            var result: [String: Any] = ["duration": duration.isFinite ? duration : 0, "peaks": [Float](), "artwork": false, "poster": false]
            let metadata = try await asset.load(.commonMetadata)
            for item in metadata {
                if let value = try? await item.load(.stringValue) {
                    if item.commonKey == .commonKeyTitle { result["title"] = value }
                    if item.commonKey == .commonKeyArtist { result["artist"] = value }
                    if item.commonKey == .commonKeyAlbumName { result["album"] = value }
                }
            }
            for item in metadata where item.commonKey == .commonKeyArtwork {
                if let data = try? await item.load(.dataValue), let image = NSImage(data: data) {
                    let sized = NSImage(size: NSSize(width: 600, height: 600))
                    sized.lockFocus(); image.draw(in: NSRect(x: 0, y: 0, width: 600, height: 600)); sized.unlockFocus()
                    if try writeJPEG(sized, to: URL(fileURLWithPath: prefix + ".art.jpg")) {
                        result["artwork"] = true
                        break
                    }
                }
            }
            let videoTracks = try await asset.loadTracks(withMediaType: .video)
            if let track = videoTracks.first {
                let size = try await track.load(.naturalSize)
                let transform = try await track.load(.preferredTransform)
                let display = CGRect(origin: .zero, size: size).applying(transform)
                result["width"] = Int(abs(display.width).rounded())
                result["height"] = Int(abs(display.height).rounded())
                let generator = AVAssetImageGenerator(asset: asset)
                generator.appliesPreferredTrackTransform = true
                generator.maximumSize = CGSize(width: 640, height: 640)
                if let (cg, _) = try? await generator.image(at: CMTime(seconds: min(1, max(0, duration / 10)), preferredTimescale: 600)) {
                    result["poster"] = try writeJPEG(
                        NSImage(cgImage: cg, size: .zero),
                        to: URL(fileURLWithPath: prefix + ".poster.jpg")
                    )
                }
            } else if let track = try await asset.loadTracks(withMediaType: .audio).first {
                let reader = try AVAssetReader(asset: asset)
                let settings: [String: Any] = [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 8000, AVNumberOfChannelsKey: 1, AVLinearPCMBitDepthKey: 32, AVLinearPCMIsFloatKey: true, AVLinearPCMIsBigEndianKey: false, AVLinearPCMIsNonInterleaved: false]
                let output = AVAssetReaderTrackOutput(track: track, outputSettings: settings)
                output.alwaysCopiesSampleData = false
                reader.add(output)
                guard reader.startReading() else { throw reader.error ?? NSError(domain: "Decode", code: 2) }
                var peaks = [Float](repeating: 0, count: 512)
                let samplesPerBin = max(1, duration * 8000 / 512)
                var offset = 0
                while let sample = output.copyNextSampleBuffer() {
                    if let block = CMSampleBufferGetDataBuffer(sample) {
                        var length = 0; var data: UnsafeMutablePointer<Int8>?
                        if CMBlockBufferGetDataPointer(block, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &data) == kCMBlockBufferNoErr, let data = data {
                            let floats = UnsafeRawPointer(data).assumingMemoryBound(to: Float.self)
                            for i in 0..<(length / 4) {
                                let bin = min(511, Int(Double(offset) / samplesPerBin))
                                let value = abs(floats[i]); if value.isFinite { peaks[bin] = max(peaks[bin], value) }; offset += 1
                            }
                        }
                    }
                    CMSampleBufferInvalidate(sample)
                }
                guard reader.status == .completed else { throw reader.error ?? NSError(domain: "Decode", code: 3) }
                let maximum = peaks.max() ?? 1
                result["peaks"] = peaks.map { maximum > 0 ? sqrt($0 / maximum) : 0 }
            }
            let data = try JSONSerialization.data(withJSONObject: result)
            try data.write(to: URL(fileURLWithPath: prefix + ".json"), options: .atomic)
        } catch { fputs("Media preview: \(error.localizedDescription)\n", stderr); exit(1) }
    }
}
