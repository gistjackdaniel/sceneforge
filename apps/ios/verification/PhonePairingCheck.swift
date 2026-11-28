import Foundation

@main
struct PhonePairingCheck {
    static func main() {
        let code = String(repeating: "a", count: 32)
        let page = "https://scene-sample.trycloudflare.com/mobile-camera.html#\(code)"
        let expected = "https://scene-sample.trycloudflare.com/api/mobile-camera/take"
        var launch = URLComponents()
        launch.scheme = "sceneforge-camera"
        launch.host = "pair"
        launch.queryItems = [URLQueryItem(name: "link", value: page)]

        let tapped = launch.url.flatMap { PhoneLink(handoffURL: $0) }
        let pasted = PhoneLink(pairingURL: " \(page)\n")
        precondition(tapped?.endpoint.absoluteString == expected && pasted?.endpoint == tapped?.endpoint)
        precondition(tapped?.code == code && pasted?.code == code)
        precondition(PhoneLink(pairingURL: page.replacingOccurrences(of: "https:", with: "http:")) == nil)
        precondition(PhoneLink(pairingURL: page.replacingOccurrences(of: "trycloudflare.com", with: "trycloudflare.com.example.org")) == nil)
        precondition(PhoneLink(pairingURL: String(page.dropLast())) == nil)
        print("App handoff and clipboard pairing accept the same valid HTTPS link and reject invalid links.")
    }
}
