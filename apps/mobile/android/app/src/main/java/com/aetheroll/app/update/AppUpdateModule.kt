package com.aetheroll.app.update

import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class AppUpdateModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "AppUpdateModule"

    private val httpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            // No read timeout — APK files can be large and connections slow.
            // OkHttp will still surface a stalled connection via TCP keepalive.
            .readTimeout(0, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true)
            .build()
    }

    private fun sendEvent(eventName: String, params: Any?) {
        try {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                ?.emit(eventName, params)
        } catch (_: Exception) {
            // Ignore if React context is destroyed or not ready
        }
    }

    private fun emitStatus(status: String?) {
        sendEvent("onAppUpdateStatus", status)
    }

    @ReactMethod
    fun getVersionCode(promise: Promise) {
        try {
            val pInfo = reactContext.packageManager.getPackageInfo(reactContext.packageName, 0)
            val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                pInfo.longVersionCode
            } else {
                @Suppress("DEPRECATION")
                pInfo.versionCode.toLong()
            }
            promise.resolve(code.toDouble())
        } catch (e: Exception) {
            promise.reject("VERSION_CODE_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun getAppVersionInfo(promise: Promise) {
        try {
            val pInfo = reactContext.packageManager.getPackageInfo(reactContext.packageName, 0)
            val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                pInfo.longVersionCode
            } else {
                @Suppress("DEPRECATION")
                pInfo.versionCode.toLong()
            }
            val map = Arguments.createMap()
            map.putString("versionName", pInfo.versionName ?: "1.0.0")
            map.putDouble("versionCode", code.toDouble())
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("VERSION_INFO_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun downloadAndInstall(downloadUrl: String, expectedSha256: String, promise: Promise) {
        // Check install-unknown-apps permission on Android 8.0+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !reactContext.packageManager.canRequestPackageInstalls()
        ) {
            val intent = Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${reactContext.packageName}")
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            reactContext.startActivity(intent)
            promise.reject(
                "INSTALL_PERMISSION_REQUIRED",
                "Please allow installing apps from Aetheroll in Settings, then tap Download again."
            )
            return
        }

        // Guard against the promise being settled more than once
        // (e.g. an exception thrown after startActivity would otherwise double-reject)
        val settled = AtomicBoolean(false)

        Thread {
            try {
                emitStatus("Connecting to update server...")

                val updateDir = File(reactContext.cacheDir, "updates")
                if (!updateDir.exists()) updateDir.mkdirs()

                val apkFile = File(updateDir, "aetheroll-update.apk")
                if (apkFile.exists()) apkFile.delete()

                val request = Request.Builder()
                    .url(downloadUrl)
                    .header("User-Agent", "Aetheroll-Android")
                    .build()

                httpClient.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        throw IOException(
                            "Update server returned HTTP ${response.code}: ${response.message}"
                        )
                    }

                    val body = response.body
                        ?: throw IOException("Empty response received from update server.")
                    val contentLength = body.contentLength()

                    emitStatus("Downloading update...")
                    val digest = MessageDigest.getInstance("SHA-256")
                    val buffer = ByteArray(32768)
                    var bytesReadTotal = 0L
                    var lastProgressPercent = -1

                    body.byteStream().use { input ->
                        FileOutputStream(apkFile).use { output ->
                            while (true) {
                                val read = input.read(buffer)
                                if (read < 0) break
                                output.write(buffer, 0, read)
                                digest.update(buffer, 0, read)
                                bytesReadTotal += read

                                if (contentLength > 0) {
                                    val percent =
                                        ((bytesReadTotal * 100) / contentLength).toInt()
                                    if (percent != lastProgressPercent) {
                                        lastProgressPercent = percent
                                        val progressMap = Arguments.createMap().apply {
                                            putInt("percent", percent)
                                            putDouble("bytesWritten", bytesReadTotal.toDouble())
                                            putDouble("totalBytes", contentLength.toDouble())
                                        }
                                        sendEvent("onAppUpdateProgress", progressMap)
                                    }
                                }
                            }
                            output.flush()
                        }
                    }

                    emitStatus("Verifying package integrity...")
                    val actualSha256 =
                        digest.digest().joinToString("") { "%02x".format(it) }
                    if (!actualSha256.equals(expectedSha256, ignoreCase = true)) {
                        apkFile.delete()
                        throw SecurityException(
                            "Downloaded update failed checksum verification. " +
                                "The file may be incomplete or modified."
                        )
                    }

                    emitStatus("Launching installer...")
                    val contentUri = FileProvider.getUriForFile(
                        reactContext,
                        "${reactContext.packageName}.fileprovider",
                        apkFile
                    )

                    val installIntent = Intent(Intent.ACTION_VIEW).apply {
                        setDataAndType(contentUri, "application/vnd.android.package-archive")
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }

                    // Grant URI read permissions explicitly to all resolving activities.
                    // Use the API 33+ overload (ResolveInfoFlags) to avoid the deprecation
                    // warning introduced in Android 13.
                    val resolveInfoList: List<ResolveInfo> =
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                            reactContext.packageManager.queryIntentActivities(
                                installIntent,
                                PackageManager.ResolveInfoFlags.of(
                                    PackageManager.MATCH_DEFAULT_ONLY.toLong()
                                )
                            )
                        } else {
                            @Suppress("DEPRECATION")
                            reactContext.packageManager.queryIntentActivities(
                                installIntent,
                                PackageManager.MATCH_DEFAULT_ONLY
                            )
                        }

                    for (resolveInfo in resolveInfoList) {
                        reactContext.grantUriPermission(
                            resolveInfo.activityInfo.packageName,
                            contentUri,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION
                        )
                    }

                    reactContext.startActivity(installIntent)
                    emitStatus(null)
                    if (settled.compareAndSet(false, true)) {
                        promise.resolve(null)
                    }
                }
            } catch (e: Exception) {
                emitStatus(null)
                if (settled.compareAndSet(false, true)) {
                    promise.reject(
                        "UPDATE_FAILED",
                        e.message ?: "Failed to download or install update.",
                        e
                    )
                }
            }
        }.start()
    }
}
