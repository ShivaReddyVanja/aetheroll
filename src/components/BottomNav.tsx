"use client";

import React from "react";
import {
  Image as ImageIcon,
  Star,
  User,
  Folder,
  Menu,
} from "lucide-react";

type ActiveFilter =
  | "all"
  | "photos"
  | "videos"
  | "favorites"
  | "people"
  | "places"
  | "events"
  | "trips"
  | "tags";

interface BottomNavProps {
  activeFilter: ActiveFilter;
  onSelectFilter: (filter: ActiveFilter) => void;
  onOpenSidebar: () => void;
}

const TABS: {
  id: ActiveFilter | "more";
  label: string;
  icon: React.ElementType;
}[] = [
  { id: "all", label: "Photos", icon: ImageIcon },
  { id: "favorites", label: "Favorites", icon: Star },
  { id: "people", label: "People", icon: User },
  { id: "trips", label: "Albums", icon: Folder },
  { id: "more", label: "More", icon: Menu },
];

export function BottomNav({
  activeFilter,
  onSelectFilter,
  onOpenSidebar,
}: BottomNavProps) {
  return (
    <nav
      className="
        md:hidden
        fixed bottom-0 left-0 right-0 z-40
        flex items-center justify-around
        bg-[var(--bg-surface)]/95 backdrop-blur-md
        border-t border-[var(--border-color)]
        pb-[env(safe-area-inset-bottom)]
        h-16
        select-none
      "
    >
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isMore = tab.id === "more";
        const isActive = !isMore && activeFilter === tab.id;

        return (
          <button
            key={tab.id}
            onClick={() => {
              if (isMore) {
                onOpenSidebar();
              } else {
                onSelectFilter(tab.id as ActiveFilter);
              }
            }}
            className={`
              flex flex-col items-center justify-center gap-1
              flex-1 h-full px-1
              transition-colors
              ${
                isActive
                  ? "text-blue-500"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }
            `}
            aria-label={tab.label}
          >
            {/* Active indicator pill behind icon */}
            <span
              className={`
                relative flex items-center justify-center
                w-14 h-7 rounded-full transition-all
                ${isActive ? "bg-[var(--bg-active-pill)]" : ""}
              `}
            >
              <Icon className="w-5 h-5" />
            </span>
            <span className="text-[10px] font-medium leading-none">
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
