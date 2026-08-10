package org.keystone.browser

import android.app.role.RoleManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.service.voice.VoiceInteractionService
import android.service.voice.VoiceInteractionSession
import android.service.voice.VoiceInteractionSessionService
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class KeystoneVoiceInteractionService : VoiceInteractionService()

class KeystoneVoiceSessionService : VoiceInteractionSessionService() {
  override fun onNewSession(args: Bundle?): VoiceInteractionSession = KeystoneVoiceSession(this)
}

class KeystoneVoiceSession(context: Context) : VoiceInteractionSession(context) {
  override fun onShow(args: Bundle?, showFlags: Int) {
    super.onShow(args, showFlags)
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
      data = Uri.parse("keystone://voice?source=assistant")
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
    if (launch != null) context.startActivity(launch)
    finish()
  }
}

class KeystoneAssistantModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("KeystoneAssistant")
    Function("isAssistantRoleAvailable") {
      val context = appContext.reactContext ?: return@Function false
      context.getSystemService(RoleManager::class.java)?.isRoleAvailable(RoleManager.ROLE_ASSISTANT) == true
    }
    AsyncFunction("requestAssistantRole") {
      val context = appContext.reactContext ?: throw IllegalStateException("React context unavailable")
      val manager = context.getSystemService(RoleManager::class.java)
      val intent: Intent = if (manager?.isRoleAvailable(RoleManager.ROLE_ASSISTANT) == true)
        manager.createRequestRoleIntent(RoleManager.ROLE_ASSISTANT)
      else Intent("android.settings.VOICE_INPUT_SETTINGS")
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); context.startActivity(intent)
    }
  }
}
