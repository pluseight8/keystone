import ExpoModulesCore
import WebKit

public class KeystoneBrowserModule: Module {
  private var webView: WKWebView?
  private var consumed = Set<String>()
  public func definition() -> ModuleDefinition {
    Name("KeystoneBrowser")
    AsyncFunction("open") { (url: String) throws in
      guard let parsed = URL(string: url), parsed.scheme == "https" else { throw NSError(domain:"KeystoneBrowser", code:1, userInfo:[NSLocalizedDescriptionKey:"HTTPS is required"]) }
      if webView == nil { webView = WKWebView(frame: .zero, configuration: WKWebViewConfiguration()) }
      webView?.load(URLRequest(url: parsed))
    }
    AsyncFunction("close") { self.webView?.stopLoading(); self.webView = nil }
    AsyncFunction("inject") { (payload: [String: Any]) async throws -> Void in
      guard let originString = payload["origin"] as? String, let origin = URL(string: originString), origin.scheme == "https" else { throw NSError(domain:"KeystoneBrowser", code:2, userInfo:[NSLocalizedDescriptionKey:"Invalid origin"]) }
      guard let token = payload["confirmationToken"] as? String, token.count >= 32, self.consumed.insert(token).inserted else { throw NSError(domain:"KeystoneBrowser", code:3, userInfo:[NSLocalizedDescriptionKey:"Invalid or reused token"]) }
      guard let expiry = payload["expiresAt"] as? String, let date = ISO8601DateFormatter().date(from: expiry), date > Date() else { throw NSError(domain:"KeystoneBrowser", code:4, userInfo:[NSLocalizedDescriptionKey:"Payload expired"]) }
      guard let fields = payload["fields"] as? [String: String], let data = try? JSONSerialization.data(withJSONObject: fields), let json = String(data:data, encoding:.utf8) else { throw NSError(domain:"KeystoneBrowser", code:5, userInfo:[NSLocalizedDescriptionKey:"Invalid fields"]) }
      let script = """(() => { const values = (json); const selectors = {address:'[name="address"],#address',city:'[name="city"],#city',postalCode:'[name="postalCode"],#postalCode'}; for (const [key,value] of Object.entries(values)) { const el=document.querySelector(selectors[key]); if (!el) continue; el.value=value; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); } })();"""
      try await webView?.evaluateJavaScript(script, in: nil, in: .page)
    }
    AsyncFunction("evaluate") { (script: String) async throws -> Any? in
      guard script.count <= 65536, !script.contains("document.cookie"), !script.contains("localStorage") else { throw NSError(domain:"KeystoneBrowser", code:6, userInfo:[NSLocalizedDescriptionKey:"Script is not allowed"]) }
      return try await webView?.evaluateJavaScript(script, in: nil, in: .page)
    }
  }
}
