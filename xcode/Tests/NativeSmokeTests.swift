import Foundation

@main struct NativeTests {
    static func main() throws {
        let dir = URL(fileURLWithPath: CommandLine.arguments[1])
        let samples = ["cfl_desktop_vbt", "cml_laptop_vbt", "kbl_nuc_vbt", "block28_direct_vbt", "oem_checksum_dc_vbt"]
        let expected = [3, 2, 2, 2, 3]
        for (sampleIndex, file) in samples.enumerated() {
            let data = try Data(contentsOf: dir.appendingPathComponent(file + ".bin"))
            let parsed = try VBTParser.parse(data)
            guard parsed.connectors.count == expected[sampleIndex] else { fatalError("Connector count mismatch: " + file) }
            let settings = PatchSettings(platformID: "07009B3E", spoofID: "3E9B", targetMacOS: "14.0")
            let patch = try PatchGenerator.make(from: parsed, settings: settings)
            guard patch.properties.count >= 4 else { fatalError("No properties: " + file) }
            guard patch.dictionary["device-id"]?.hexString == "9B3E0000" else { fatalError("Endianness mismatch") }
            guard patch.dictionary["AAPL,ig-platform-id"]?.hexString == "07009B3E" else { fatalError("Platform ID mismatch") }
            let xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><plist version=\"1.0\"><dict>" + patch.xml + "</dict></plist>"
            var format = PropertyListSerialization.PropertyListFormat.xml
            let xmlObject = try PropertyListSerialization.propertyList(from: Data(xml.utf8), format: &format)
            guard xmlObject is [String: Any] else { fatalError("Bad XML") }
            let source = try Data(contentsOf: dir.appendingPathComponent("sample_config.plist"))
            let merged = try PatchGenerator.mergedPlist(original: source, patch: patch)
            let result = try PropertyListSerialization.propertyList(from: merged, format: &format) as! [String: Any]
            let device = result["DeviceProperties"] as! [String: Any]
            let add = device["Add"] as! [String: Any]
            let igpu = add[PatchGenerator.pciPath] as! [String: Any]
            guard (igpu["device-id"] as? Data)?.hexString == "9B3E0000" else { fatalError("Plist merge mismatch") }
            print("PASS \(file) v\(parsed.version)/BDB\(parsed.bdbVersion) stride=\(parsed.stride) active=\(parsed.connectors.count) all=\(parsed.allDevices.count) keys=\(patch.properties.count) xml+plist OK")
        }
    }
}
