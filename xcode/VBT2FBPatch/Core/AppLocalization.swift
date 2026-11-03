import Foundation

/// Explicit German / English translations for the entire native workbench.
/// "system" follows the macOS primary language; the setting persists across launches.
enum AppLocalization {
    static let settingKey = "interfaceLanguage"

    static func effectiveLanguage(_ preference: String? = nil) -> String {
        let selection = preference ?? UserDefaults.standard.string(forKey: settingKey) ?? "system"
        if selection == "de" || selection == "en" { return selection }
        return Locale.preferredLanguages.first?.lowercased().hasPrefix("de") == true ? "de" : "en"
    }

    static func text(_ key: String, language: String? = nil, bundle: Bundle = .main) -> String {
        let identifier = effectiveLanguage(language)
        guard let resourcePath = bundle.path(forResource: identifier, ofType: "lproj"),
              let translationBundle = Bundle(path: resourcePath) else { return key }
        return translationBundle.localizedString(forKey: key, value: key, table: "Localizable")
    }

    static func format(_ key: String, _ args: CVarArg...) -> String {
        String(format: text(key), locale: Locale(identifier: effectiveLanguage()), arguments: args)
    }
}

/// Translates both static labels and messages composed by the native engines.
func tr(_ key: String) -> String { AppLocalization.text(key) }
