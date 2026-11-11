import Foundation
import NaturalLanguage

// The text understanding helper.
//
// macOS already knows how to compare sentences. This tool turns a piece of
// text into the vector that comparison uses, so the app can search documents
// and notes in plain language without downloading anything.
//
//   text-tool embed "some text"   -> the vector, as JSON numbers
//   text-tool dimension           -> how many numbers a vector has

@main struct TextTool {
 static func writeError(_ message: String) {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
 }
 static func main() {
    let arguments = CommandLine.arguments
    guard arguments.count >= 2 else {
        writeError("Usage: text-tool embed <text> | text-tool dimension")
        exit(2)
    }
    switch arguments[1] {
    case "dimension":
        guard let embedding = NLEmbedding.sentenceEmbedding(for: .english) else {
            writeError("This Mac has no English sentence embedding.")
            exit(1)
        }
        print(embedding.dimension)
    case "embed":
        guard arguments.count >= 3 else {
            writeError("Usage: text-tool embed <text>")
            exit(2)
        }
        guard let embedding = NLEmbedding.sentenceEmbedding(for: .english),
              let values = embedding.vector(for: arguments[2]) else {
            writeError("This text could not be embedded.")
            exit(1)
        }
        // The vector is written as plain numbers: the app stores it beside the
        // picture vectors and compares them with a dot product.
        var parts: [String] = []
        parts.reserveCapacity(values.count)
        for value in values {
            parts.append(String(value))
        }
        print("[" + parts.joined(separator: ",") + "]")
    default:
        writeError("Usage: text-tool embed <text> | text-tool dimension")
        exit(2)
    }
 }
}
