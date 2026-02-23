import SwiftUI
import UIKit

extension Color {
    /// Warm off-white (#F6F4EF) in light mode, soft charcoal (#1C1C1C) in dark mode.
    static var relayBackground: Color {
        Color(UIColor { trait in
            trait.userInterfaceStyle == .dark
                ? UIColor(red: 0.11, green: 0.11, blue: 0.11, alpha: 1)   // #1C1C1C
                : UIColor(red: 0.965, green: 0.957, blue: 0.937, alpha: 1) // #F6F4EF
        })
    }
}

extension LinearGradient {
    /// Very subtle ambient gradient — feels like light, not a design element.
    static var relayBackground: LinearGradient {
        LinearGradient(
            colors: [
                Color(uiColor: UIColor { t in
                    t.userInterfaceStyle == .dark
                        ? UIColor(red: 0.118, green: 0.115, blue: 0.112, alpha: 1) // slightly warmer top
                        : UIColor(red: 0.953, green: 0.945, blue: 0.922, alpha: 1) // slightly warmer top
                }),
                Color(uiColor: UIColor { t in
                    t.userInterfaceStyle == .dark
                        ? UIColor(red: 0.100, green: 0.100, blue: 0.100, alpha: 1) // slightly cooler bottom
                        : UIColor(red: 0.973, green: 0.969, blue: 0.953, alpha: 1) // slightly cooler bottom
                }),
            ],
            startPoint: .top,
            endPoint: .bottom
        )
    }
}
