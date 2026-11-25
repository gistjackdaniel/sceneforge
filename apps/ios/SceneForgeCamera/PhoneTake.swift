import Foundation

struct PhoneLink {
    let endpoint: URL
    let code: String

    init?(handoffURL url: URL) {
        guard let launch = URLComponents(url: url, resolvingAgainstBaseURL: false),
              launch.scheme == "sceneforge-camera", launch.host == "pair", launch.path.isEmpty,
              launch.user == nil, launch.password == nil, launch.port == nil, launch.fragment == nil,
              let query = launch.queryItems, query.count == 1, query[0].name == "link",
              let link = query[0].value else { return nil }
        self.init(pairingURL: link)
    }

    init?(pairingURL text: String) {
        guard let phone = URLComponents(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
              phone.scheme == "https", phone.user == nil, phone.password == nil, phone.port == nil,
              let host = phone.host, host.range(of: #"^[a-z0-9-]+\.trycloudflare\.com$"#, options: .regularExpression) != nil,
              phone.percentEncodedPath == "/mobile-camera.html", phone.query == nil,
              let code = phone.percentEncodedFragment, code.count == 32,
              code.allSatisfy({ "0123456789abcdef".contains($0) }) else { return nil }

        var api = URLComponents()
        api.scheme = "https"
        api.host = host
        api.path = "/api/mobile-camera/take"
        guard let endpoint = api.url else { return nil }
        self.endpoint = endpoint
        self.code = code
    }

    func request(method: String) -> URLRequest {
        var request = URLRequest(url: endpoint, timeoutInterval: 15)
        request.httpMethod = method
        request.setValue("Bearer \(code)", forHTTPHeaderField: "Authorization")
        return request
    }
}

struct PhoneShotClock: Decodable {
    let fps: Int
    let durationFrames: Int
}

struct LensIntrinsics: Encodable {
    let imageSize: [Int]
    let fx: Float
    let fy: Float
    let cx: Float
    let cy: Float
}

enum PhoneTrackingState: String, Encodable {
    case normal
    case limited
    case unavailable = "not_available"
}

struct PhonePose: Encodable {
    let kind = "matrix"
    let transform: [Float]
}

struct PhoneSample: Encodable {
    let timestampNs: Int64
    let pose: PhonePose
    let trackingState: PhoneTrackingState
}

struct PhoneTake: Encodable {
    let framework = "arkit"
    let cameraLocal = "gl"
    let frames: [PhoneSample]
    let intrinsics: LensIntrinsics?
}

struct CameraReading {
    let time: TimeInterval
    let pose: PhonePose
    let tracking: PhoneTrackingState
    let intrinsics: LensIntrinsics
}

struct PhoneTakeCapture {
    enum Update {
        case waitingForTracking
        case recording(PhoneTrackingState, TimeInterval)
        case ended
    }

    let clock: PhoneShotClock
    private var origin: TimeInterval?
    private var intrinsics: LensIntrinsics?
    private var frames: [PhoneSample] = []
    private var lastIndex = -1
    private var lastReading: PhoneSample?

    init(clock: PhoneShotClock) {
        self.clock = clock
    }

    mutating func append(_ reading: CameraReading) -> Update {
        if origin == nil {
            guard reading.tracking == .normal else { return .waitingForTracking }
            origin = reading.time
            intrinsics = reading.intrinsics
        }
        guard let origin else { return .waitingForTracking }
        let elapsed = reading.time - origin
        let timestamp = Int64(max(0, elapsed * 1_000_000_000).rounded())
        let shotFrame = (Double(timestamp) / 1_000_000_000 * Double(clock.fps)).rounded()
        if let lastReading {
            if timestamp <= lastReading.timestampNs { return .recording(reading.tracking, elapsed) }
            let gapSeconds = Double(timestamp - lastReading.timestampNs) / 1_000_000_000
            if gapSeconds > max(0.15, 2 / Double(clock.fps)) { markInterruption() }
        }
        guard shotFrame < Double(clock.durationFrames) else { return .ended }
        let index = Int(shotFrame)
        let sample = PhoneSample(timestampNs: timestamp, pose: reading.pose, trackingState: reading.tracking)
        lastReading = sample
        if index > lastIndex {
            frames.append(sample)
            lastIndex = index
        } else if index == lastIndex && index > 0 {
            frames[frames.count - 1] = sample
        }
        return .recording(reading.tracking, elapsed)
    }

    mutating func markInterruption() {
        guard let lastReading, frames.last?.trackingState != .unavailable else { return }
        let index = lastIndex + 1
        guard index < clock.durationFrames else { return }
        let timestamp = Int64((Double(index) * 1_000_000_000 / Double(clock.fps)).rounded())
        frames.append(PhoneSample(timestampNs: timestamp, pose: lastReading.pose, trackingState: .unavailable))
        lastIndex = index
    }

    func take() -> PhoneTake? {
        guard !frames.isEmpty else { return nil }
        return PhoneTake(frames: frames, intrinsics: intrinsics)
    }
}

private final class PhoneRequestDelegate: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(
        _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

enum EditorPhoneAPI {
    private static let session = URLSession(configuration: .ephemeral, delegate: PhoneRequestDelegate(), delegateQueue: nil)

    static func clock(for link: PhoneLink) async throws -> PhoneShotClock {
        let data = try await send(link.request(method: "GET"), expecting: 200)
        let clock = try JSONDecoder().decode(PhoneShotClock.self, from: data)
        guard clock.fps > 0, clock.durationFrames > 0 else { throw PhoneConnectionError.invalidClock }
        return clock
    }

    static func upload(_ take: PhoneTake, through link: PhoneLink) async throws {
        var request = link.request(method: "POST")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(take)
        _ = try await send(request, expecting: 204)
    }

    private static func send(_ request: URLRequest, expecting status: Int) async throws -> Data {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PhoneConnectionError.unexpectedResponse }
        if http.statusCode == 404 { throw PhoneConnectionError.pairEnded }
        guard http.statusCode == status else { throw PhoneConnectionError.unexpectedResponse }
        return data
    }
}

enum PhoneConnectionError: LocalizedError {
    case pairEnded
    case invalidClock
    case unexpectedResponse

    var errorDescription: String? {
        switch self {
        case .pairEnded: "This pairing ended. Make a new QR code in the editor."
        case .invalidClock: "The editor returned an invalid shot clock."
        case .unexpectedResponse: "The editor didn't accept this request."
        }
    }
}
