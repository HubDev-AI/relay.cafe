import SwiftUI

struct FarewellView: View {
    @State private var appeared = false

    var body: some View {
        ZStack {
            Color.relayBackground.ignoresSafeArea()

            Text("You've left the relay.")
                .font(.system(size: 18, weight: .regular))
                .opacity(appeared ? 0.7 : 0)
                .animation(.easeInOut(duration: 0.4), value: appeared)
        }
        .onAppear { appeared = true }
    }
}
