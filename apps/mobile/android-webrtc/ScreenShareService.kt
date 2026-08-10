package org.keystone.webrtc
import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.*
import androidx.core.app.NotificationCompat
class ScreenShareService:Service(){
 override fun onCreate(){super.onCreate();val id="keystone_screen_share";if(Build.VERSION.SDK_INT>=26)getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(id,"Keystone screen sharing",NotificationManager.IMPORTANCE_LOW));val n=NotificationCompat.Builder(this,id).setSmallIcon(android.R.drawable.presence_video_online).setContentTitle("Keystone shares your screen").setContentText("Open Keystone to stop sharing").setOngoing(true).build();if(Build.VERSION.SDK_INT>=29)startForeground(4210,n,ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)else startForeground(4210,n)}
 override fun onStartCommand(intent:Intent?,flags:Int,startId:Int)=START_NOT_STICKY
 override fun onBind(intent:Intent?):IBinder?=null
}
