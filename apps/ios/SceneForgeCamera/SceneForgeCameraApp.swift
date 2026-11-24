import RealityKit
import SwiftUI

@main
@MainActor
struct SceneForgeCameraApp: App {
    @StateObject private var recorder = CameraRecorder()

    var body: some SwiftUI.Scene {
        WindowGroup {
            ZStack(alignment: .bottom) {
                Color(red: 0.06, green: 0.09, blue: 0.07).ignoresSafeArea()
                if case .recording = recorder.state {
                    CameraPreview(view: recorder.preview).ignoresSafeArea()
                }
                VStack(alignment: .leading, spacing: 14) {
                    Text("SceneForge Camera").font(.title2.weight(.semibold))
                    content
                }
                .frame(maxWidth: 480, alignment: .leading)
                .padding(20)
                .background(.black.opacity(0.78), in: RoundedRectangle(cornerRadius: 18))
                .padding(.horizontal, 12)
                .padding(.bottom, 8)
            }
            .preferredColorScheme(.dark)
            .onOpenURL { recorder.open($0) }
        }
    }

    @ViewBuilder private var content: some View {
        switch recorder.state {
        case .unpaired:
            Text("Scan the editor’s phone camera QR code, then tap Open SceneForge Camera.")
        case .connecting:
            ProgressView("Connecting to the editor…")
        case .ready(let pairing, let note):
            Text("Paired · \(pairing.clock.durationFrames) frames at \(pairing.clock.fps) fps")
            if let note { Text(note).foregroundStyle(.secondary) }
            action("Start AR") { recorder.start() }
        case .startingCamera:
            ProgressView("Starting AR…")
        case .recording(let message):
            Text(message)
            action("Stop and send") { recorder.finish() }
        case .sending:
            ProgressView("Sending take…")
        case .retry(let upload, let message):
            Text(message)
            action("Retry send") { recorder.send(upload) }
        case .sent(let message), .problem(let message):
            Text(message)
        }
    }

    private func action(_ title: String, run: @escaping () -> Void) -> some View {
        Button(action: run) {
            Text(title).frame(maxWidth: .infinity, minHeight: 34)
        }
        .buttonStyle(.borderedProminent)
        .tint(Color(red: 0.57, green: 0.92, blue: 0.70))
        .foregroundStyle(.black)
    }
}

private struct CameraPreview: UIViewRepresentable {
    let view: ARView
    func makeUIView(context: Context) -> ARView { view }
    func updateUIView(_ view: ARView, context: Context) {}
}
