package org.keystone.browser

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Path
import android.os.Bundle
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject

/** Small, explicit bridge. It never exposes raw node objects to JS. */
class KeystoneAccessibilityService : AccessibilityService() {
  companion object { var instance: KeystoneAccessibilityService? = null }
  override fun onServiceConnected() { instance = this }
  override fun onInterrupt() {}
  override fun onAccessibilityEvent(event: AccessibilityEvent?) { KeystoneAccessibilityModule.emitTree() }
  override fun onDestroy() { instance = null; super.onDestroy() }

  fun tree(): JSONObject = node(rootInActiveWindow, 0) ?: JSONObject()
  private fun node(n: AccessibilityNodeInfo?, depth: Int): JSONObject? {
    if (n == null || depth > 40) return null
    val out = JSONObject(); out.put("id", n.viewIdResourceName ?: ""); out.put("text", n.text ?: "")
    out.put("contentDescription", n.contentDescription ?: ""); out.put("className", n.className ?: "")
    out.put("packageName", n.packageName ?: ""); out.put("clickable", n.isClickable); out.put("enabled", n.isEnabled)
    val children = JSONArray(); for (i in 0 until n.childCount) node(n.getChild(i), depth + 1)?.let { children.put(it) }; out.put("children", children); return out
  }
  fun tap(x: Float, y: Float): Boolean { val p = Path(); p.moveTo(x, y); val g = GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(p, 0, 50)).build(); return dispatchGesture(g, null, null) }
  fun swipe(x1: Float, y1: Float, x2: Float, y2: Float, duration: Long): Boolean { val p = Path(); p.moveTo(x1,y1); p.lineTo(x2,y2); val g = GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(p,0,duration.coerceIn(100,10000))).build(); return dispatchGesture(g,null,null) }
  fun input(text: String): Boolean { val n = rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return false; val b = Bundle(); b.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text); return n.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,b) }
}

class KeystoneAccessibilityModule : Module() {
  companion object { private var current: KeystoneAccessibilityModule? = null; fun emitTree() { KeystoneAccessibilityService.instance?.tree()?.let { current?.sendEvent("onUiTree", it.toString()) } } }
  override fun definition() = ModuleDefinition {
    Name("KeystoneAccessibility")
    Events("onUiTree")
    OnCreate { current = this@KeystoneAccessibilityModule }
    OnDestroy { current = null }
    AsyncFunction("requestPermission") { appContext: AppContext -> appContext.reactContext?.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    AsyncFunction("isEnabled") { KeystoneAccessibilityService.instance != null }
    AsyncFunction("getUiTree") { KeystoneAccessibilityService.instance?.tree()?.toString() ?: throw Exception("Accessibility service is not enabled") }
    AsyncFunction("tap") { x: Double, y: Double -> KeystoneAccessibilityService.instance?.tap(x.toFloat(),y.toFloat()) ?: false }
    AsyncFunction("swipe") { x1: Double,y1: Double,x2: Double,y2: Double,duration: Double -> KeystoneAccessibilityService.instance?.swipe(x1.toFloat(),y1.toFloat(),x2.toFloat(),y2.toFloat(),duration.toLong()) ?: false }
    AsyncFunction("inputText") { text: String -> KeystoneAccessibilityService.instance?.input(text) ?: false }
  }
}
