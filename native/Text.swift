import Foundation
import NaturalLanguage


@main struct TextTool {
 static func writeError(_ message: String) {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
 }
 static func main() {
    let arguments = CommandLine.arguments
    guard arguments.count >= 2 else {
        writeError("Usage: text-tool embed <text> | text-tool embed-many | text-tool dimension")
        exit(2)
    }
    switch arguments[1] {
    case "dimension":
        guard let embedding = NLEmbedding.sentenceEmbedding(for: .english) else {
            writeError("This Mac has no English sentence embedding.")
            exit(1)
        }
        print(embedding.dimension)
    case "embed-many":
        let data = FileHandle.standardInput.readDataToEndOfFile()
        let input = String(data: data, encoding: .utf8) ?? ""
        guard let embedding = NLEmbedding.sentenceEmbedding(for: .english) else {
            writeError("This Mac has no English sentence embedding.")
            exit(1)
        }
        var vectors: [[String]] = []
        for line in input.split(separator: "\n", omittingEmptySubsequences: false) {
            guard let values = embedding.vector(for: String(line)) else { continue }
            vectors.append(values.map { String($0) })
        }
        print("[" + vectors.map { "[" + $0.joined(separator: ",") + "]" }.joined(separator: ",") + "]")
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
        var parts: [String] = []
        parts.reserveCapacity(values.count)
        for value in values {
            parts.append(String(value))
        }
        print("[" + parts.joined(separator: ",") + "]")
    default:
        writeError("Usage: text-tool embed <text> | text-tool embed-many | text-tool dimension")
        exit(2)
    }
 }
}
