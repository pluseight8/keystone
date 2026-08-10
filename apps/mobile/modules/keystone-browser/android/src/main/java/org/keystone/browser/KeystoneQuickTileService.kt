package org.keystone.browser

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

class KeystoneQuickTileService : TileService() {
  override fun onStartListening() { super.onStartListening(); qsTile?.apply { state = Tile.STATE_ACTIVE; label = "Keystone Voice"; updateTile() } }
  override fun onClick() {
    super.onClick()
    val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      data = Uri.parse("keystone://voice?source=quick-tile")
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    } ?: return
    if (Build.VERSION.SDK_INT >= 34) {
      val pending = PendingIntent.getActivity(this, 4311, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      startActivityAndCollapse(pending)
    } else {
      @Suppress("DEPRECATION") startActivityAndCollapse(launch)
    }
  }
}
