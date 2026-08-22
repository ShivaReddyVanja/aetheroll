import React from "react";

interface BrandIconProps {
  className?: string;
  size?: number;
}

export function BrandIcon({ className = "w-7 h-7", size = 24 }: BrandIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
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
  );
}
