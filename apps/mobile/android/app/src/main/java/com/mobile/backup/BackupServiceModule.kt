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

    /**
     * Reads a byte chunk from a content:// or file:// URI starting at `offset` for `length` bytes.
     * Returns Base64-encoded string representing the binary chunk.
     */
    @ReactMethod
    fun readUriChunkBase64(uriString: String, offset: Double, length: Double, promise: Promise) {
        try {
            val offsetLong = offset.toLong()
            val lengthInt = length.toInt()
            val uri = android.net.Uri.parse(uriString)

            val inputStream = if (uriString.startsWith("content://")) {
                reactContext.contentResolver.openInputStream(uri)
            } else {
                val cleanPath = uriString.removePrefix("file://")
                java.io.FileInputStream(java.io.File(cleanPath))
            }

            if (inputStream == null) {
                promise.reject("FILE_NOT_FOUND", "Could not open stream for URI: $uriString")
                return
            }

            inputStream.use { stream ->
                var skipped = 0L
                while (skipped < offsetLong) {
                    val n = stream.skip(offsetLong - skipped)
                    if (n <= 0) {
                        if (stream.read() == -1) break
                        skipped++
                    } else {
                        skipped += n
                    }
                }

                val buffer = ByteArray(lengthInt)
                var totalBytesRead = 0
                while (totalBytesRead < lengthInt) {
                    val bytesRead = stream.read(buffer, totalBytesRead, lengthInt - totalBytesRead)
                    if (bytesRead == -1) break
                    totalBytesRead += bytesRead
                }

                if (totalBytesRead == 0) {
                    promise.resolve("")
                    return
                }

                val base64String = android.util.Base64.encodeToString(
                    buffer,
                    0,
                    totalBytesRead,
                    android.util.Base64.NO_WRAP
                )
                promise.resolve(base64String)
            }
        } catch (e: Exception) {
            promise.reject("CHUNK_READ_ERROR", e.message, e)
        }
    }

    /**
     * Slices a byte chunk from a content:// or file:// URI and writes it to a temporary binary file.
     * Returns the file:// URI of the temporary chunk file.
     * Allows React Native FormData to stream binary directly to the network without Base64 overhead.
     */
    @ReactMethod
    fun createTempChunkFile(uriString: String, offset: Double, length: Double, promise: Promise) {
        try {
            val offsetLong = offset.toLong()
            val lengthInt = length.toInt()
            val uri = android.net.Uri.parse(uriString)

            val inputStream = if (uriString.startsWith("content://")) {
                reactContext.contentResolver.openInputStream(uri)
            } else {
                val cleanPath = uriString.removePrefix("file://")
                java.io.FileInputStream(java.io.File(cleanPath))
            }

            if (inputStream == null) {
                promise.reject("FILE_NOT_FOUND", "Could not open stream for URI: $uriString")
                return
            }

            // Create temp file only after stream is confirmed open — avoids orphaned
            // 0-byte cache files when content:// URI permissions are revoked mid-upload.
            val tempFile = java.io.File.createTempFile("upload_part_", ".bin", reactContext.cacheDir)

            inputStream.use { stream ->
                var skipped = 0L
                while (skipped < offsetLong) {
                    val n = stream.skip(offsetLong - skipped)
                    if (n <= 0) {
                        if (stream.read() == -1) break
                        skipped++
                    } else {
                        skipped += n
                    }
                }

                java.io.FileOutputStream(tempFile).use { out ->
                    val buffer = ByteArray(32 * 1024)
                    var remaining = lengthInt
                    while (remaining > 0) {
                        val toRead = Math.min(buffer.size, remaining)
                        val bytesRead = stream.read(buffer, 0, toRead)
                        if (bytesRead == -1) break
                        out.write(buffer, 0, bytesRead)
                        remaining -= bytesRead
                    }
                }
            }

            promise.resolve("file://${tempFile.absolutePath}")
        } catch (e: Exception) {
            promise.reject("CHUNK_WRITE_ERROR", e.message, e)
        }
    }

    /**
     * Deletes a temporary file created during chunked upload.
     */
    @ReactMethod
    fun deleteTempFile(filePath: String, promise: Promise) {
        try {
            val cleanPath = filePath.removePrefix("file://")
            val file = java.io.File(cleanPath)
            if (file.exists()) {
                file.delete()
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    /**
     * Extracts video duration, dimensions, and first-frame JPEG thumbnail Base64 using Android's MediaMetadataRetriever.
     */
    @ReactMethod
    fun extractVideoMetadata(uriString: String, promise: Promise) {
        var retriever: android.media.MediaMetadataRetriever? = null
        try {
            retriever = android.media.MediaMetadataRetriever()
            val uri = android.net.Uri.parse(uriString)
            if (uriString.startsWith("content://")) {
                reactContext.contentResolver.openFileDescriptor(uri, "r")?.use { pfd ->
                    retriever.setDataSource(pfd.fileDescriptor)
                } ?: run {
                    retriever.setDataSource(reactContext, uri)
                }
            } else {
                val cleanPath = uriString.removePrefix("file://")
                retriever.setDataSource(cleanPath)
            }

            val durationStr = retriever.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION)
            val widthStr = retriever.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)
            val heightStr = retriever.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)

            val durationMs = durationStr?.toDoubleOrNull() ?: 0.0
            val durationSec = durationMs / 1000.0
            val width = widthStr?.toIntOrNull() ?: 1920
            val height = heightStr?.toIntOrNull() ?: 1080

            // Extract frame at 1s (or fallback to frameAtTime)
            val rawBitmap = retriever.getFrameAtTime(1000000, android.media.MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
                ?: retriever.frameAtTime

            var base64Thumb = ""
            if (rawBitmap != null) {
                // Scale down to max 480px keeping aspect ratio
                val maxDim = 480
                val bmWidth = rawBitmap.width
                val bmHeight = rawBitmap.height
                val scale = if (bmWidth > maxDim || bmHeight > maxDim) {
                    Math.min(maxDim.toFloat() / bmWidth, maxDim.toFloat() / bmHeight)
                } else 1.0f

                val scaledBitmap = if (scale < 1.0f) {
                    android.graphics.Bitmap.createScaledBitmap(
                        rawBitmap,
                        (bmWidth * scale).toInt(),
                        (bmHeight * scale).toInt(),
                        true
                    )
                } else {
                    rawBitmap
                }

                val outputStream = java.io.ByteArrayOutputStream()
                scaledBitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 75, outputStream)
                val byteArray = outputStream.toByteArray()
                base64Thumb = "data:image/jpeg;base64," + android.util.Base64.encodeToString(
                    byteArray,
                    android.util.Base64.NO_WRAP
                )
            }

            val map = com.facebook.react.bridge.Arguments.createMap()
            map.putDouble("duration", durationSec)
            map.putInt("width", width)
            map.putInt("height", height)
            map.putString("thumbnailBase64", base64Thumb)

            promise.resolve(map)
        } catch (e: Exception) {
            val fallbackMap = com.facebook.react.bridge.Arguments.createMap()
            fallbackMap.putDouble("duration", 0.0)
            fallbackMap.putInt("width", 1920)
            fallbackMap.putInt("height", 1080)
            fallbackMap.putString("thumbnailBase64", "")
            promise.resolve(fallbackMap)
        } finally {
            try {
                retriever?.release()
            } catch (ignored: Exception) {}
        }
    }

    /**
     * Launches external hardware-accelerated video player (VLC, MX Player, Google Photos) via Android Intent.
     */
    @ReactMethod
    fun openVideoPlayer(videoUrl: String, title: String?, promise: Promise) {
        try {
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(android.net.Uri.parse(videoUrl), "video/*")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                if (title != null) {
                    putExtra(Intent.EXTRA_TITLE, title)
                }
            }
            reactContext.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("VIDEO_PLAYER_ERROR", e.message, e)
        }
    }
}
