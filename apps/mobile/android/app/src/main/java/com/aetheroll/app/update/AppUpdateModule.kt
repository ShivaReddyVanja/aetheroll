package com.aetheroll.app.update

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.security.MessageDigest

class AppUpdateModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "AppUpdateModule"

    @ReactMethod
    fun getVersionCode(promise: Promise) {
        promise.resolve(reactContext.packageManager.getPackageInfo(reactContext.packageName, 0).longVersionCode.toDouble())
    }

    @ReactMethod
    fun downloadAndInstall(downloadUrl: String, expectedSha256: String, promise: Promise) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !reactContext.packageManager.canRequestPackageInstalls()) {
            val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${reactContext.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            reactContext.startActivity(intent)
            promise.reject("INSTALL_PERMISSION_REQUIRED", "Allow Aetheroll to install updates, then try again.")
            return
        }

        val downloadManager = reactContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val request = DownloadManager.Request(Uri.parse(downloadUrl))
            .setTitle("Aetheroll update")
            .setDescription("Downloading the latest version")
            .setMimeType("application/vnd.android.package-archive")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalFilesDir(reactContext, Environment.DIRECTORY_DOWNLOADS, "aetheroll-update.apk")
        val downloadId = downloadManager.enqueue(request)

        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1) != downloadId) return
                reactContext.unregisterReceiver(this)
                val apkUri = downloadManager.getUriForDownloadedFile(downloadId)
                if (apkUri == null) {
                    promise.reject("UPDATE_DOWNLOAD_FAILED", "The update download did not complete.")
                    return
                }
                try {
                    val actualSha256 = reactContext.contentResolver.openInputStream(apkUri)?.use { input ->
                        val digest = MessageDigest.getInstance("SHA-256")
                        val buffer = ByteArray(8192)
                        while (true) {
                            val read = input.read(buffer)
                            if (read < 0) break
                            digest.update(buffer, 0, read)
                        }
                        digest.digest().joinToString("") { "%02x".format(it) }
                    }
                    if (!actualSha256.equals(expectedSha256, ignoreCase = true)) {
                        promise.reject("UPDATE_CHECKSUM_FAILED", "Downloaded update failed its integrity check.")
                        return
                    }
                    val installIntent = Intent(Intent.ACTION_VIEW)
                        .setDataAndType(apkUri, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    reactContext.startActivity(installIntent)
                    promise.resolve(null)
                } catch (error: Exception) {
                    promise.reject("UPDATE_INSTALL_FAILED", error.message, error)
                }
            }
        }
        val filter = IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            reactContext.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("DEPRECATION")
            reactContext.registerReceiver(receiver, filter)
        }
    }
}
