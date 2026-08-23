import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Aetheroll — Unlimited Private Cloud Photo & Video Vault on Telegram";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "60px 70px",
          backgroundColor: "#09090b",
          backgroundImage:
            "radial-gradient(circle at 25px 25px, #27272a 2%, transparent 0%), radial-gradient(circle at 75px 75px, #18181b 2%, transparent 0%)",
          backgroundSize: "100px 100px",
          color: "#fafafa",
          fontFamily: "sans-serif",
        }}
      >
        {/* Top Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            {/* Google Photos Pinwheel SVG */}
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2C9.24 2 7 4.24 7 7C7 9.76 9.24 12 12 12C12 9.24 14.24 7 17 7C19.76 7 22 4.76 22 2H12Z"
                fill="#EA4335"
              />
              <path
                d="M22 12C22 9.24 19.76 7 17 7C14.24 7 12 9.24 12 12C12 14.76 14.24 17 17 17C17 19.76 19.24 22 22 22V12Z"
                fill="#FBBC05"
              />
              <path
                d="M12 22C14.76 22 17 19.76 17 17C17 14.24 14.24 12 12 12C12 14.76 9.76 17 7 17C4.24 17 2 19.24 2 22H12Z"
                fill="#34A853"
              />
              <path
                d="M2 12C2 14.76 4.24 17 7 17C9.76 17 12 14.76 12 12C12 9.24 9.76 7 7 7C7 4.24 4.24 2 2 2V12Z"
                fill="#4285F4"
              />
            </svg>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "32px", fontWeight: 700, letterSpacing: "-0.03em" }}>
                Aetheroll
              </span>
              <span
                style={{
                  fontSize: "14px",
                  padding: "4px 10px",
                  backgroundColor: "#18181b",
                  border: "1px solid #27272a",
                  borderRadius: "6px",
                  color: "#a1a1aa",
                  fontFamily: "monospace",
                }}
              >
                Edge v2.0
              </span>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "6px 14px",
              backgroundColor: "rgba(16, 185, 129, 0.1)",
              border: "1px solid rgba(16, 185, 129, 0.3)",
              borderRadius: "20px",
              color: "#34d399",
              fontSize: "14px",
              fontWeight: 500,
            }}
          >
            <div
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: "#34d399",
              }}
            />
            <span>Cloudflare Edge Active</span>
          </div>
        </div>

        {/* Center Main Headline */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <h1
            style={{
              fontSize: "56px",
              fontWeight: 800,
              lineHeight: 1.1,
              letterSpacing: "-0.03em",
              margin: 0,
              color: "#ffffff",
            }}
          >
            Unlimited Private Cloud Gallery Powered by Telegram
          </h1>
          <p
            style={{
              fontSize: "22px",
              color: "#a1a1aa",
              lineHeight: 1.4,
              margin: 0,
              maxWidth: "900px",
            }}
          >
            Zero monthly subscriptions. 10-Worker MTProto 4K video scrubbing. Dual-Key HKDF zero-knowledge privacy.
          </p>
        </div>

        {/* Bottom Feature Badges */}
        <div style={{ display: "flex", gap: "16px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "12px 20px",
              backgroundColor: "#18181b",
              border: "1px solid #27272a",
              borderRadius: "10px",
              color: "#e4e4e7",
              fontSize: "16px",
              fontWeight: 600,
            }}
          >
            ⚡ $0/mo Edge Serverless
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "12px 20px",
              backgroundColor: "#18181b",
              border: "1px solid #27272a",
              borderRadius: "10px",
              color: "#e4e4e7",
              fontSize: "16px",
              fontWeight: 600,
            }}
          >
            🎥 10-Worker 4K Chunk Streaming
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "12px 20px",
              backgroundColor: "#18181b",
              border: "1px solid #27272a",
              borderRadius: "10px",
              color: "#e4e4e7",
              fontSize: "16px",
              fontWeight: 600,
            }}
          >
            🔒 Zero-Knowledge HKDF Vault
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
