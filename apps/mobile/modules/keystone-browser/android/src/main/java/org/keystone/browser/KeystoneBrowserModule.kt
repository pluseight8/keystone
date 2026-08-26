package org.keystone.browser

import android.content.Context
import android.view.View
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoView
import org.json.JSONObject
import java.net.URI
import java.util.concurrent.ConcurrentHashMap

class KeystoneBrowserModule : Module() {
  private var runtime: GeckoRuntime? = null
  private var session: GeckoSession? = null
  private val consumed = ConcurrentHashMap.newKeySet<String>()
  override fun definition() = ModuleDefinition {
    Name("KeystoneBrowser")
    View(GeckoView::class) { Events("onPageLoaded") }
    AsyncFunction("open") { url: String, promise: Promise ->
      val uri = URI(url); if (uri.scheme != "https") return@AsyncFunction promise.reject("INVALID_URL", "HTTPS is required", null)
      val context = appContext.reactContext ?: return@AsyncFunction promise.reject("NO_CONTEXT", "React context unavailable", null)
      if (runtime == null) runtime = GeckoRuntime.create(context)
      session?.close(); session = GeckoSession(); session!!.open(runtime!!); session!!.loadUri(url); promise.resolve(null)
    }
    AsyncFunction("close") { session?.close(); session = null }
    AsyncFunction("inject") { payload: Map<String, Any?>, promise: Promise ->
      try {
        val origin = URI(payload["origin"] as? String ?: ""); if (origin.scheme != "https") throw IllegalArgumentException("HTTPS is required")
        val token = payload["confirmationToken"] as? String ?: throw IllegalArgumentException("Missing confirmation token")
        if (token.length < 32 || !consumed.add(token)) throw IllegalArgumentException("Invalid or reused confirmation token")
        val expires = payload["expiresAt"] as? String ?: throw IllegalArgumentException("Missing expiry")
        if (java.time.Instant.parse(expires).isBefore(java.time.Instant.now())) throw IllegalArgumentException("Payload expired")
        val fields = JSONObject(payload["fields"] as Map<*, *>).toString()
        val script = """(() => { const values=$fields; const selectors={address:'[name="address"],#address',city:'[name="city"],#city',postalCode:'[name="postalCode"],#postalCode'}; for (const [key,value] of Object.entries(values)) { const el=document.querySelector(selectors[key]); if (!el) continue; el.value=value; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); } })();"""
        session?.evaluateJS(script)?.accept { promise.resolve(null) } ?: promise.reject("NO_SESSION", "Browser session unavailable", null)
      } catch (error: Exception) { promise.reject("INJECTION_REJECTED", error.message, error) }
    }
  }
}
