# Transcoder Architecture & Language Evaluation

This document outlines the architecture, language evaluation, and execution strategy for the upcoming **Aetheroll Media Transcoding Engine** (`services/transcoder`).

---

## 1. Objectives

- **High Throughput:** Process 4K/1080p/720p/480p adaptive bitrate (HLS / DASH / MP4) video streams and animated media with minimal CPU latency.
- **Zero-Copy Streaming:** Directly pipe byte chunks between Cloudflare R2 / S3 / Telegram storage without accumulating multi-gigabyte video buffers in RAM.
- **Hardware Acceleration:** Native support for GPU/hardware encoders (NVIDIA NVENC, Apple VideoToolbox, Intel QuickSync, Linux VA-API).
- **Fast Startup & Low Footprint:** Lightweight containerization (<30MB image) with instantaneous cold starts for on-demand worker scaling.

---

## 2. Language Evaluation & Benchmarks

| Criterion | Rust 🥇 *(Selected)* | Go (Golang) 🥈 | C++ | Node.js / Python ⚠️ |
| :--- | :--- | :--- | :--- | :--- |
| **Execution Speed** | ⚡ **Native C/C++ Speed** | ⚡ Very Fast | ⚡ Native C/C++ Speed | 🐢 Slower / Interpreted |
| **Memory Footprint** | **Minimal (No GC)** | Low (Light GC) | Minimal (Manual) | High (V8 / Python runtime) |
| **Memory Safety** | 🛡️ **Compile-time safe** | 🛡️ Memory-safe | ⚠️ High buffer overflow risk | 🛡️ Memory-safe |
| **FFmpeg Integration** | Direct C bindings (`ffmpeg-next`, `libav*`) | CGo (`go-astiav`) / CLI | Native C/C++ | Subprocess CLI only |
| **Concurrency Model** | `tokio` async + `rayon` work-stealing | Goroutines & channels | OS Threads / OpenMP | Event loop / Multiprocessing |
| **Container Footprint** | ~15MB (scratch / distroless) | ~20MB (scratch) | ~25MB | 150MB - 500MB |

---

## 3. Why Rust is Chosen for Aetheroll Transcoder

1. **Zero Garbage Collection Overhead:**
   Video transcoding is heavy on memory buffer throughput. In garbage-collected languages, large frame buffers trigger frequent GC stop-the-world pauses. Rust's deterministic memory management guarantees steady, uninterrupted encoding frame rates.
2. **Untrusted Codec Safety:**
   Processing arbitrary user video and image uploads poses severe security vulnerabilities with corrupt container metadata. Rust's memory safety prevents buffer overflows and heap exploits commonly found in C/C++ media parsers.
3. **Multi-core Work-Stealing:**
   Parallel encoding of chunk segments using `tokio` for network I/O and `rayon` for CPU threads maximizes core utilization on dedicated compute instances.

---

## 4. Planned Monorepo Layout

When transcoders are introduced, they will live under `services/`:

```
aetheroll/
├── apps/
│   ├── web/               # Next.js 15
│   └── mobile/            # React Native
├── workers/
│   └── api/               # Cloudflare Edge Worker & Durable Objects
├── services/
│   └── transcoder/        # Rust Transcoder Daemon (Cargo workspace)
│       ├── Cargo.toml
│       ├── src/
│       │   ├── main.rs
│       │   ├── pipeline/  # HLS/DASH/MP4 FFmpeg pipelines
│       │   ├── storage/   # R2 / S3 streaming adapters
│       │   └── queue/     # Redis / Queue consumer
│       └── Dockerfile
└── packages/
    └── types/             # Shared TypeScript & Rust JSON schemas
```
