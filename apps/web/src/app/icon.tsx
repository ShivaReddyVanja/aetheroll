import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = {
  width: 32,
  height: 32,
};
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#09090b",
          borderRadius: "8px",
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
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
      </div>
    ),
    {
      ...size,
    }
  );
}
