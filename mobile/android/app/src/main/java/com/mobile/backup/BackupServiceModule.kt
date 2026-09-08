package com.mobile.backup

import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise

class BackupServiceModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "BackupServiceModule"

    @ReactMethod
    fun startService(title: String, message: String, promise: Promise) {
        try {
            val intent = Intent(reactContext, BackupForegroundService::class.java).apply {
                action = BackupForegroundService.ACTION_START
                putExtra(BackupForegroundService.EXTRA_TITLE, title)
                putExtra(BackupForegroundService.EXTRA_MESSAGE, message)
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                reactContext.startForegroundService(intent)
            } else {
                reactContext.startService(intent)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("START_SERVICE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun updateProgress(
        title: String,
        message: String,
        progress: Double,
        max: Double,
        indeterminate: Boolean,
        promise: Promise
    ) {
        try {
            val intent = Intent(reactContext, BackupForegroundService::class.java).apply {
                action = BackupForegroundService.ACTION_UPDATE
                putExtra(BackupForegroundService.EXTRA_TITLE, title)
                putExtra(BackupForegroundService.EXTRA_MESSAGE, message)
                putExtra(BackupForegroundService.EXTRA_PROGRESS, progress.toInt())
                putExtra(BackupForegroundService.EXTRA_MAX, max.toInt())
                putExtra(BackupForegroundService.EXTRA_INDETERMINATE, indeterminate)
            }
            reactContext.startService(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("UPDATE_PROGRESS_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun stopService(promise: Promise) {
        try {
            val intent = Intent(reactContext, BackupForegroundService::class.java).apply {
                action = BackupForegroundService.ACTION_STOP
            }
            reactContext.startService(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("STOP_SERVICE_ERROR", e.message, e)
        }
    }

    /**
     * Returns true if the BackupForegroundService is currently running.
     * Used by the TS layer to reconcile its isRunning flag after a JS bridge restart.
     */
    @ReactMethod
    fun isServiceRunning(promise: Promise) {
        try {
            val activityManager = reactContext.getSystemService(android.content.Context.ACTIVITY_SERVICE) as android.app.ActivityManager
            @Suppress("DEPRECATION")
            val running = activityManager.getRunningServices(Int.MAX_VALUE).any { serviceInfo ->
                serviceInfo.service.className == BackupForegroundService::class.java.name
            }
            promise.resolve(running)
        } catch (e: Exception) {
            promise.reject("SERVICE_STATUS_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun isIgnoringBatteryOptimizations(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val powerManager = reactContext.getSystemService(android.content.Context.POWER_SERVICE) as android.os.PowerManager
                val isIgnoring = powerManager.isIgnoringBatteryOptimizations(reactContext.packageName)
                promise.resolve(isIgnoring)
            } else {
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.reject("BATTERY_OPT_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun requestIgnoreBatteryOptimizations(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val powerManager = reactContext.getSystemService(android.content.Context.POWER_SERVICE) as android.os.PowerManager
                if (!powerManager.isIgnoringBatteryOptimizations(reactContext.packageName)) {
                    val intent = Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                        data = android.net.Uri.parse("package:${reactContext.packageName}")
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    }
                    reactContext.startActivity(intent)
                    promise.resolve(true)
                    return
                }
            }
            promise.resolve(false)
        } catch (e: Exception) {
            try {
                val intent = Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                reactContext.startActivity(intent)
                promise.resolve(true)
            } catch (fallbackErr: Exception) {
                promise.reject("BATTERY_OPT_REQUEST_ERROR", e.message, e)
            }
        }
    }
}
