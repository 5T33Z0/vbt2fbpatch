import Foundation

@main struct TranslationTests {
    static func main() {
        let bundlePath = CommandLine.arguments[1]
        guard let bundle = Bundle(path: bundlePath) else { fatalError("No bundle") }
        let cases = [
            ("Arbeitsbereich", "Workspace"),
            ("XML exportieren", "Export XML"),
            ("VBT importieren", "Import VBT"),
            ("Aus", "Off"),
            ("NICHT UNTERSTÜTZT", "UNSUPPORTED"),
            ("OpenCore config.plist wirklich ändern?", "Modify OpenCore config.plist?"),
            ("Die ausgewählte Datei ist keine gültige XML- oder Binär-Plist.", "The selected file is not a valid XML or binary plist."),
            ("Gepatchte Plist sichern", "Save patched plist")
        ]
        for (key, english) in cases {
            let translated = AppLocalization.text(key, language: "en", bundle: bundle)
            guard translated == english else { fatalError("Failed EN: \(key) -> \(translated)") }
            let german = AppLocalization.text(key, language: "de", bundle: bundle)
            guard !german.isEmpty && german != english else {
                // Some strings are identical in two languages; test cases above are not.
                fatalError("Failed DE: \(key) -> \(german)")
            }
            print("PASS en: \(translated) | de: \(german)")
        }
        UserDefaults.standard.set("en", forKey: AppLocalization.settingKey)
        guard AppLocalization.effectiveLanguage() == "en" else { fatalError("English selector") }
        UserDefaults.standard.set("de", forKey: AppLocalization.settingKey)
        guard AppLocalization.effectiveLanguage() == "de" else { fatalError("German selector") }
        UserDefaults.standard.removeObject(forKey: AppLocalization.settingKey)
        print("PASS language selection")
    }
}
