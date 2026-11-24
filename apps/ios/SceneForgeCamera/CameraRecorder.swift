@preconcurrency import ARKit
import AVFoundation
import RealityKit
import simd
import SwiftUI

@MainActor
final class CameraRecorder: NSObject, ObservableObject, ARSessionDelegate {
    struct Pairing {
        let link: PhoneLink
        let clock: PhoneShotClock
    }

    struct Upload {
        let pair: Pairing
        let take: PhoneTake
        let completion: String
    }

    enum State {
        case unpaired
        case connecting
        case ready(Pairing, note: String?)
        case startingCamera
        case recording(String)
        case sending
        case retry(Upload, message: String)
        case sent(String)
        case problem(String)
    }

    private struct Recording {
        let pair: Pairing
        var capture: PhoneTakeCapture
    }

    @Published private(set) var state = State.unpaired
    private var connecting: Task<Void, Never>?
    private var recording: Recording?
    private(set) lazy var preview: ARView = {
        let view = ARView(frame: .zero, cameraMode: .ar, automaticallyConfigureSession: false)
        view.session.delegateQueue = .main
        view.session.delegate = self
        return view
    }()

    func open(_ url: URL) {
        switch state {
        case .recording, .startingCamera, .sending: return
        default: break
        }
        connecting?.cancel()
        guard let link = PhoneLink(url) else {
            state = .problem("This link is invalid. Scan a new QR code from SceneForge.")
            return
        }
        state = .connecting
        connecting = Task {
            do {
                let clock = try await EditorPhoneAPI.clock(for: link)
                if !Task.isCancelled { state = .ready(Pairing(link: link, clock: clock), note: nil) }
            } catch {
                if !Task.isCancelled { state = .problem(error.localizedDescription) }
            }
        }
    }

    func start() {
        guard case .ready(let pair, _) = state else { return }
        guard ARWorldTrackingConfiguration.isSupported else {
            state = .ready(pair, note: "Use an iPhone with ARKit world tracking to record this take.")
            return
        }
        state = .startingCamera
        Task {
            guard await AVCaptureDevice.requestAccess(for: .video) else {
                state = .ready(pair, note: "Allow camera access for SceneForge Camera in Settings.")
                return
            }
            let configuration = ARWorldTrackingConfiguration()
            configuration.worldAlignment = .gravity
            recording = Recording(pair: pair, capture: PhoneTakeCapture(clock: pair.clock))
            state = .recording("Hold the starting position and aim at a textured area.")
            preview.session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
        }
    }

    func finish(note: String? = nil) {
        guard let recording else { return }
        self.recording = nil
        preview.session.pause()
        guard let take = recording.capture.take() else {
            state = .ready(recording.pair, note: note ?? "No 6DoF pose was captured. Aim at a textured, well-lit area and try again.")
            return
        }
        let completion = note == nil ? "Take sent. Play it in the editor." : "Partial take sent. ARKit stopped tracking."
        send(Upload(pair: recording.pair, take: take, completion: completion))
    }

    func send(_ upload: Upload) {
        state = .sending
        Task {
            do {
                try await EditorPhoneAPI.upload(upload.take, through: upload.pair.link)
                state = .sent(upload.completion)
            } catch PhoneConnectionError.pairEnded {
                state = .problem(PhoneConnectionError.pairEnded.localizedDescription)
            } catch {
                state = .retry(upload, message: error.localizedDescription)
            }
        }
    }

    nonisolated func session(_ session: ARSession, didUpdate frame: ARFrame) {
        MainActor.assumeIsolated {
            guard recording != nil else { return }
            let camera = frame.camera
            let viewport = CGSize(width: camera.imageResolution.height, height: camera.imageResolution.width)
            let matrix = simd_inverse(camera.viewMatrix(for: .portrait)).columns
            let transform = [matrix.0, matrix.1, matrix.2, matrix.3].flatMap { [$0.x, $0.y, $0.z, $0.w] }
            let projection = camera.projectionMatrix(for: .portrait, viewportSize: viewport, zNear: 0.05, zFar: 100).columns
            let halfWidth = Float(viewport.width) / 2
            let halfHeight = Float(viewport.height) / 2
            let lens = LensIntrinsics(imageSize: [Int(viewport.width), Int(viewport.height)],
                                      fx: projection.0.x * halfWidth, fy: projection.1.y * halfHeight,
                                      cx: (1 - projection.2.x) * halfWidth, cy: (1 + projection.2.y) * halfHeight)
            let tracking: PhoneTrackingState
            switch camera.trackingState {
            case .normal: tracking = .normal
            case .limited: tracking = .limited
            case .notAvailable: tracking = .unavailable
            @unknown default: tracking = .unavailable
            }
            receive(CameraReading(time: frame.timestamp, pose: PhonePose(transform: transform), tracking: tracking, intrinsics: lens))
        }
    }

    nonisolated func sessionWasInterrupted(_ session: ARSession) {
        MainActor.assumeIsolated {
            recording?.capture.markInterruption()
            if recording != nil { state = .recording("Camera interrupted. Return to your last position to resume tracking.") }
        }
    }

    nonisolated func sessionShouldAttemptRelocalization(_ session: ARSession) -> Bool { true }

    nonisolated func session(_ session: ARSession, didFailWithError error: Error) {
        MainActor.assumeIsolated {
            recording?.capture.markInterruption()
            finish(note: error.localizedDescription)
        }
    }

    private func receive(_ reading: CameraReading) {
        guard let update = recording?.capture.append(reading) else { return }
        switch update {
        case .waitingForTracking: break
        case .ended: finish()
        case .recording(let tracking, let elapsed):
            let label = tracking == .normal ? "Recording" : "Tracking limited"
            let message = "\(label) · \(elapsed.formatted(.number.precision(.fractionLength(1)))) s"
            if case .recording(let current) = state, current == message { return }
            state = .recording(message)
        }
    }
}
