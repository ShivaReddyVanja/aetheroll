package com.aetheroll.app.streaming

import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.BufferedOutputStream
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.io.RandomAccessFile
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

data class MediaMetadata(
    val mediaId: String,
    val totalSize: Long,
    val mimeType: String
)

class PendingChunkRequest(
    val requestId: String,
    val mediaId: String,
    val start: Long,
    val end: Long
) {
    val latch = CountDownLatch(1)
    var chunkBytes: ByteArray? = null
    var error: String? = null
}

class LocalStreamServerModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "LocalStreamServerModule"

    private var serverSocket: ServerSocket? = null
    private var boundPort: Int = 0
    private val isRunning = AtomicBoolean(false)
    private val threadPool = Executors.newCachedThreadPool()

    private val mediaMetadataMap = ConcurrentHashMap<String, MediaMetadata>()
    private val pendingRequests = ConcurrentHashMap<String, PendingChunkRequest>()

    companion object {
        private const val DEFAULT_PORT = 8998
        private const val CHUNK_REQUEST_TIMEOUT_SECONDS = 30L
        private const val MAX_CACHE_SIZE_BYTES = 1024L * 1024L * 1024L // 1 GB Max Cache Cap
        private const val TARGET_PRUNE_SIZE_BYTES = 800L * 1024L * 1024L // Prune down to 800 MB (80%)
        private const val TAG = "LocalStreamServer"
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

    @ReactMethod
    fun startServer(preferredPort: Double, promise: Promise) {
        if (isRunning.get() && serverSocket != null && !serverSocket!!.isClosed) {
            val map = Arguments.createMap()
            map.putBoolean("running", true)
            map.putInt("port", boundPort)
            map.putString("serverUrl", "http://127.0.0.1:$boundPort")
            promise.resolve(map)
            return
        }

        threadPool.execute {
            try {
                val targetPort = if (preferredPort > 0) preferredPort.toInt() else DEFAULT_PORT
                val loopback = InetAddress.getByName("127.0.0.1")
                
                var socket: ServerSocket? = null
                try {
                    socket = ServerSocket(targetPort, 50, loopback)
                } catch (e: Exception) {
                    // If preferred port is busy, pick any available port
                    socket = ServerSocket(0, 50, loopback)
                }

                serverSocket = socket
                boundPort = socket.localPort
                isRunning.set(true)

                val cacheDir = File(reactContext.cacheDir, "stream_cache")
                if (cacheDir.exists()) {
                    cacheDir.listFiles()?.filter { it.isFile }?.forEach { it.delete() }
                }

                val map = Arguments.createMap()
                map.putBoolean("running", true)
                map.putInt("port", boundPort)
                map.putString("serverUrl", "http://127.0.0.1:$boundPort")
                promise.resolve(map)

                listenForConnections(socket)
            } catch (e: Exception) {
                isRunning.set(false)
                promise.reject("SERVER_START_FAILED", "Failed to start local stream server: ${e.message}", e)
            }
        }
    }

    @ReactMethod
    fun stopServer(promise: Promise) {
        try {
            isRunning.set(false)
            serverSocket?.close()
            serverSocket = null
            pendingRequests.values.forEach { req ->
                req.error = "Server stopped"
                req.latch.countDown()
            }
            pendingRequests.clear()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SERVER_STOP_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun getServerUrl(promise: Promise) {
        if (isRunning.get() && boundPort > 0) {
            val map = Arguments.createMap()
            map.putBoolean("running", true)
            map.putInt("port", boundPort)
            map.putString("serverUrl", "http://127.0.0.1:$boundPort")
            promise.resolve(map)
        } else {
            val map = Arguments.createMap()
            map.putBoolean("running", false)
            map.putInt("port", 0)
            map.putString("serverUrl", "")
            promise.resolve(map)
        }
    }

    @ReactMethod
    fun registerMedia(mediaId: String, totalSizeBytes: Double, mimeType: String, promise: Promise) {
        val totalSize = totalSizeBytes.toLong()
        val type = if (mimeType.isNotBlank()) mimeType else "video/mp4"
        mediaMetadataMap[mediaId] = MediaMetadata(mediaId, totalSize, type)
        promise.resolve(true)
    }

    @ReactMethod
    fun respondStreamChunk(requestId: String, base64Chunk: String, promise: Promise) {
        val pending = pendingRequests.remove(requestId)
        if (pending != null) {
            try {
                val cleanB64 = base64Chunk.trim()
                val bytes = Base64.decode(cleanB64, Base64.DEFAULT)
                pending.chunkBytes = bytes
                pending.latch.countDown()
                
                // Cache this chunk to disk for instant seeking
                saveChunkToDiskCache(pending.mediaId, pending.start, bytes)
                promise.resolve(bytes.size)
            } catch (e: Exception) {
                pending.error = "Base64 decode failed: ${e.message}"
                pending.latch.countDown()
                promise.reject("DECODE_ERROR", e.message, e)
            }
        } else {
            promise.resolve(0)
        }
    }

    @ReactMethod
    fun respondStreamError(requestId: String, errorMessage: String, promise: Promise) {
        val pending = pendingRequests.remove(requestId)
        if (pending != null) {
            pending.error = errorMessage
            pending.latch.countDown()
        }
        promise.resolve(true)
    }

    @ReactMethod
    fun clearStreamCache(promise: Promise) {
        threadPool.execute {
            try {
                val cacheDir = File(reactContext.cacheDir, "stream_cache")
                if (cacheDir.exists()) {
                    cacheDir.deleteRecursively()
                    cacheDir.mkdirs()
                }
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("CACHE_CLEAR_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun getStreamCacheSizeBytes(promise: Promise) {
        threadPool.execute {
            try {
                val cacheDir = File(reactContext.cacheDir, "stream_cache")
                var total = 0L
                if (cacheDir.exists() && cacheDir.isDirectory) {
                    cacheDir.walkTopDown().filter { it.isFile }.forEach { file ->
                        total += file.length()
                    }
                }
                promise.resolve(total.toDouble())
            } catch (e: Exception) {
                promise.resolve(0.0)
            }
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for RN built-in Event Emitter Calls.
    }

    @ReactMethod
    fun removeListeners(count: Double) {
        // Required for RN built-in Event Emitter Calls.
    }

    private fun listenForConnections(socket: ServerSocket) {
        while (isRunning.get() && !socket.isClosed) {
            try {
                val clientSocket = socket.accept()
                threadPool.execute {
                    handleClientConnection(clientSocket)
                }
            } catch (e: Exception) {
                if (!isRunning.get()) break
            }
        }
    }

    private fun handleClientConnection(clientSocket: Socket) {
        try {
            clientSocket.soTimeout = 30000 // 30s socket read timeout
            val reader = BufferedReader(InputStreamReader(clientSocket.getInputStream()))
            val out = BufferedOutputStream(clientSocket.getOutputStream())

            val requestLine = reader.readLine() ?: return
            val parts = requestLine.split(" ")
            if (parts.size < 2) return

            val method = parts[0].uppercase()
            val uri = parts[1]

            var rangeHeader: String? = null
            var line: String? = reader.readLine()
            while (!line.isNullOrBlank()) {
                if (line.startsWith("Range:", ignoreCase = true)) {
                    rangeHeader = line.substring(6).trim()
                }
                line = reader.readLine()
            }

            // Route: /stream/<mediaId>
            val path = uri.substringBefore("?")
            if (!path.startsWith("/stream/")) {
                send404(out, "Invalid stream endpoint")
                return
            }

            val mediaId = path.removePrefix("/stream/")
            if (mediaId.isBlank()) {
                send404(out, "Missing mediaId")
                return
            }

            val meta = mediaMetadataMap[mediaId]
            val totalSize = meta?.totalSize ?: 0L
            val contentType = meta?.mimeType ?: "video/mp4"

            if (method == "HEAD") {
                sendHeadResponse(out, totalSize, contentType)
                return
            }

            if (rangeHeader != null && rangeHeader.startsWith("bytes=")) {
                handleRangeRequest(out, mediaId, totalSize, contentType, rangeHeader)
            } else {
                handleFullStreamRequest(out, mediaId, totalSize, contentType)
            }
        } catch (_: SocketException) {
            // Client disconnected (e.g. video player seeked or paused)
        } catch (_: Exception) {
        } finally {
            try {
                clientSocket.close()
            } catch (_: Exception) {}
        }
    }

    private fun handleRangeRequest(
        out: BufferedOutputStream,
        mediaId: String,
        totalSize: Long,
        contentType: String,
        rangeHeader: String
    ) {
        val rangeVal = rangeHeader.removePrefix("bytes=").trim()
        val rangeParts = rangeVal.split("-")
        val startStr = rangeParts.getOrNull(0)?.trim()
        val endStr = rangeParts.getOrNull(1)?.trim()

        val start = startStr?.toLongOrNull() ?: 0L
        var end = if (!endStr.isNullOrBlank()) endStr.toLongOrNull() ?: (totalSize - 1) else (totalSize - 1)

        if (totalSize > 0 && end >= totalSize) {
            end = totalSize - 1
        }
        if (start > end && totalSize > 0) {
            send416(out, totalSize)
            return
        }

        val contentLength = if (totalSize > 0) (end - start + 1) else (512 * 1024L)
        val contentRangeHeader = if (totalSize > 0) "bytes $start-$end/$totalSize" else "bytes $start-$end/*"

        val headers = "HTTP/1.1 206 Partial Content\r\n" +
                "Content-Type: $contentType\r\n" +
                "Accept-Ranges: bytes\r\n" +
                "Content-Range: $contentRangeHeader\r\n" +
                "Content-Length: $contentLength\r\n" +
                "Access-Control-Allow-Origin: *\r\n" +
                "Connection: keep-alive\r\n\r\n"

        android.util.Log.i(TAG, "📥 [HTTP 206 Range] mediaId=$mediaId, range=$start-$end/$totalSize ($contentLength bytes)")

        out.write(headers.toByteArray(Charsets.UTF_8))
        out.flush()

        // Stream byte range in progressive slices
        streamRangeBytes(out, mediaId, start, end)
    }

    private fun handleFullStreamRequest(
        out: BufferedOutputStream,
        mediaId: String,
        totalSize: Long,
        contentType: String
    ) {
        val headers = "HTTP/1.1 200 OK\r\n" +
                "Content-Type: $contentType\r\n" +
                "Accept-Ranges: bytes\r\n" +
                "Content-Length: $totalSize\r\n" +
                "Access-Control-Allow-Origin: *\r\n" +
                "Connection: keep-alive\r\n\r\n"

        android.util.Log.i(TAG, "📥 [HTTP 200 Full Stream] mediaId=$mediaId, totalSize=$totalSize")

        out.write(headers.toByteArray(Charsets.UTF_8))
        out.flush()

        val end = if (totalSize > 0) totalSize - 1 else (10 * 1024 * 1024L)
        streamRangeBytes(out, mediaId, 0L, end)
    }

    private fun streamRangeBytes(out: BufferedOutputStream, mediaId: String, rangeStart: Long, rangeEnd: Long) {
        var currentOffset = rangeStart
        val sliceSize = 512 * 1024L // 512 KB Telegram chunk size

        while (currentOffset <= rangeEnd && isRunning.get()) {
            val chunkEnd = minOf(currentOffset + sliceSize - 1, rangeEnd)
            val chunkLength = (chunkEnd - currentOffset + 1).toInt()

            // 1. Try reading from local disk cache
            val cachedBytes = readChunkFromDiskCache(mediaId, currentOffset, chunkLength)
            if (cachedBytes != null && cachedBytes.size == chunkLength) {
                android.util.Log.d(TAG, "⚡ [Cache HIT] mediaId=$mediaId, offset=$currentOffset ($chunkLength bytes)")
                out.write(cachedBytes)
                out.flush()
                currentOffset += chunkLength
                continue
            }

            android.util.Log.d(TAG, "📡 [MTProto Chunk Fetch] mediaId=$mediaId, range=$currentOffset-$chunkEnd")

            // 2. Request chunk from React Native GramJS MTProto client
            val requestId = UUID.randomUUID().toString()
            val pending = PendingChunkRequest(requestId, mediaId, currentOffset, chunkEnd)
            pendingRequests[requestId] = pending

            val eventMap = Arguments.createMap()
            eventMap.putString("requestId", requestId)
            eventMap.putString("mediaId", mediaId)
            eventMap.putDouble("start", currentOffset.toDouble())
            eventMap.putDouble("end", chunkEnd.toDouble())
            eventMap.putInt("chunkSize", chunkLength)

            sendEvent("onStreamChunkRequested", eventMap)

            // Wait for JS to supply the chunk
            val received = pending.latch.await(CHUNK_REQUEST_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            if (!received || pending.chunkBytes == null) {
                pendingRequests.remove(requestId)
                break
            }

            val bytes = pending.chunkBytes!!
            out.write(bytes)
            out.flush()

            currentOffset += bytes.size
            if (bytes.size < chunkLength) {
                // Reached end of file
                break
            }
        }
    }

    private fun getMediaCacheDir(mediaId: String): File {
        val streamDir = File(reactContext.cacheDir, "stream_cache")
        val mediaDir = File(streamDir, mediaId)
        if (!mediaDir.exists()) mediaDir.mkdirs()
        return mediaDir
    }

    private fun saveChunkToDiskCache(mediaId: String, offset: Long, bytes: ByteArray) {
        try {
            val chunkIndex = offset / (512 * 1024L)
            val inChunkOffset = (offset % (512 * 1024L)).toInt()
            val mediaDir = getMediaCacheDir(mediaId)
            val chunkFile = File(mediaDir, "chunk_${chunkIndex}.dat")

            if (inChunkOffset == 0 && bytes.size >= (512 * 1024) && !chunkFile.exists()) {
                chunkFile.writeBytes(bytes)
            } else {
                RandomAccessFile(chunkFile, "rw").use { raf ->
                    raf.seek(inChunkOffset.toLong())
                    raf.write(bytes)
                }
            }

            val now = System.currentTimeMillis()
            chunkFile.setLastModified(now)
            mediaDir.setLastModified(now)

            // Asynchronously prune cache if total size exceeds 1 GB
            threadPool.execute {
                pruneCacheIfNeeded(mediaId)
            }
        } catch (_: Exception) {}
    }

    private fun readChunkFromDiskCache(mediaId: String, offset: Long, length: Int): ByteArray? {
        try {
            val chunkIndex = offset / (512 * 1024L)
            val inChunkOffset = (offset % (512 * 1024L)).toInt()
            val mediaDir = File(File(reactContext.cacheDir, "stream_cache"), mediaId)
            if (!mediaDir.exists()) return null

            val chunkFile = File(mediaDir, "chunk_${chunkIndex}.dat")
            if (!chunkFile.exists() || chunkFile.length() < (inChunkOffset + length)) return null

            RandomAccessFile(chunkFile, "r").use { raf ->
                raf.seek(inChunkOffset.toLong())
                val buf = ByteArray(length)
                val read = raf.read(buf, 0, length)
                if (read == length) {
                    val now = System.currentTimeMillis()
                    chunkFile.setLastModified(now)
                    mediaDir.setLastModified(now)
                    return buf
                }
            }
        } catch (_: Exception) {}
        return null
    }

    private fun pruneCacheIfNeeded(activeMediaId: String) {
        try {
            val cacheDir = File(reactContext.cacheDir, "stream_cache")
            if (!cacheDir.exists() || !cacheDir.isDirectory) return

            // Clean up any legacy flat files from root of stream_cache
            val rootEntries = cacheDir.listFiles() ?: return
            var totalSize = 0L
            val mediaDirs = mutableListOf<File>()

            for (entry in rootEntries) {
                if (entry.isFile) {
                    entry.delete()
                } else if (entry.isDirectory) {
                    mediaDirs.add(entry)
                    val chunkFiles = entry.listFiles() ?: emptyArray()
                    totalSize += chunkFiles.sumOf { it.length() }
                }
            }

            if (totalSize <= MAX_CACHE_SIZE_BYTES) return

            // Sort media directories by lastModified ascending (oldest accessed first)
            val sortedDirs = mediaDirs
                .filter { it.name != activeMediaId }
                .sortedBy { it.lastModified() }

            for (dir in sortedDirs) {
                if (totalSize <= TARGET_PRUNE_SIZE_BYTES) break
                val chunkFiles = dir.listFiles() ?: emptyArray()
                val dirSize = chunkFiles.sumOf { it.length() }
                dir.deleteRecursively()
                totalSize -= dirSize
            }
        } catch (_: Exception) {}
    }

    private fun sendHeadResponse(out: BufferedOutputStream, totalSize: Long, contentType: String) {
        val headers = "HTTP/1.1 200 OK\r\n" +
                "Content-Type: $contentType\r\n" +
                "Accept-Ranges: bytes\r\n" +
                "Content-Length: $totalSize\r\n" +
                "Access-Control-Allow-Origin: *\r\n\r\n"
        out.write(headers.toByteArray(Charsets.UTF_8))
        out.flush()
    }

    private fun send404(out: BufferedOutputStream, message: String) {
        val body = "404 Not Found: $message\r\n"
        val headers = "HTTP/1.1 404 Not Found\r\n" +
                "Content-Type: text/plain\r\n" +
                "Content-Length: ${body.length}\r\n\r\n$body"
        out.write(headers.toByteArray(Charsets.UTF_8))
        out.flush()
    }

    private fun send416(out: BufferedOutputStream, totalSize: Long) {
        val headers = "HTTP/1.1 416 Range Not Satisfiable\r\n" +
                "Content-Range: bytes */$totalSize\r\n\r\n"
        out.write(headers.toByteArray(Charsets.UTF_8))
        out.flush()
    }
}
