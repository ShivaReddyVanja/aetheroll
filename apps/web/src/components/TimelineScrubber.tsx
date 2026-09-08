"use client";

import React, { useMemo } from "react";

interface TimelineScrubberProps {
  years: number[];
  activeYear?: number;
  onSelectYear: (year: number) => void;
}

export function TimelineScrubber({ years, activeYear, onSelectYear }: TimelineScrubberProps) {
  const sortedYears = useMemo(() => {
    return Array.from(new Set(years)).sort((a, b) => b - a);
  }, [years]);

  if (sortedYears.length <= 1) return null;

  return (
    <div className="fixed right-3 top-28 bottom-12 flex flex-col justify-center items-end z-20 pointer-events-none select-none">
      <div className="bg-[var(--bg-surface)]/80 backdrop-blur-md border border-[var(--border-color)] py-3 px-1.5 rounded-full shadow-lg pointer-events-auto flex flex-col items-center gap-2">
        {sortedYears.map((year) => {
          const isActive = year === activeYear;
          return (
            <button
              key={year}
              onClick={() => onSelectYear(year)}
              className={`group relative text-[11px] font-medium transition-all px-2 py-0.5 rounded-full ${
                isActive
                  ? "text-blue-500 font-bold scale-110"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {year}
              {/* Active Indicator dot */}
              {isActive && (
                <div className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-blue-500" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
