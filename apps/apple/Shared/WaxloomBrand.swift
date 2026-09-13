import SwiftUI

struct WaxloomMark: View {
    var lineWidth: CGFloat = 12

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            let w = size.width
            let h = size.height

            Path { path in
                path.move(to: CGPoint(x: w * 0.08, y: h * 0.18))
                path.addCurve(
                    to: CGPoint(x: w * 0.29, y: h * 0.78),
                    control1: CGPoint(x: w * 0.14, y: h * 0.34),
                    control2: CGPoint(x: w * 0.20, y: h * 0.72)
                )
                path.addCurve(
                    to: CGPoint(x: w * 0.48, y: h * 0.42),
                    control1: CGPoint(x: w * 0.34, y: h * 0.92),
                    control2: CGPoint(x: w * 0.40, y: h * 0.43)
                )
                path.addCurve(
                    to: CGPoint(x: w * 0.69, y: h * 0.77),
                    control1: CGPoint(x: w * 0.56, y: h * 0.16),
                    control2: CGPoint(x: w * 0.62, y: h * 0.83)
                )
                path.addCurve(
                    to: CGPoint(x: w * 0.92, y: h * 0.16),
                    control1: CGPoint(x: w * 0.76, y: h * 0.92),
                    control2: CGPoint(x: w * 0.86, y: h * 0.36)
                )
            }
            .stroke(
                LinearGradient(
                    colors: [
                        Color(red: 0.73, green: 0.20, blue: 0.98),
                        Color(red: 0.48, green: 0.29, blue: 0.98),
                        Color(red: 0.10, green: 0.67, blue: 1.00),
                    ],
                    startPoint: .bottomLeading,
                    endPoint: .topTrailing
                ),
                style: StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round)
            )
            .shadow(color: Color.purple.opacity(0.24), radius: lineWidth * 0.75)
        }
        .aspectRatio(1.35, contentMode: .fit)
        .accessibilityHidden(true)
    }
}

struct WaxloomBrandLockup: View {
    var compact = false

    var body: some View {
        HStack(spacing: compact ? 7 : 10) {
            WaxloomMark(lineWidth: compact ? 7 : 10)
                .frame(width: compact ? 34 : 48, height: compact ? 26 : 36)

            Text("WAXLOOM")
                .font(.system(size: compact ? 11 : 14, weight: .black, design: .rounded))
                .tracking(compact ? 2.2 : 3.2)
                .foregroundStyle(.primary)
                .lineLimit(1)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Waxloom")
    }
}

struct WaxloomIconSurface: View {
    var cornerRadius: CGFloat = 24

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 0.045, green: 0.045, blue: 0.065),
                            Color(red: 0.075, green: 0.055, blue: 0.11),
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )

            RadialGradient(
                colors: [Color.purple.opacity(0.25), .clear],
                center: .bottomLeading,
                startRadius: 4,
                endRadius: 120
            )

            WaxloomMark(lineWidth: 13)
                .padding(18)
        }
        .overlay {
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
        }
    }
}
