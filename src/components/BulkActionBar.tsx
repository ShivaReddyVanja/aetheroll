"use client";

import React, { useState, useEffect } from "react";
import {
  Tag,
  Compass,
  Calendar,
  User,
  Star,
  X,
  Plus,
  Check,
  Loader2,
  Trash2,
} from "lucide-react";
import { apiFetch } from "@/lib/config";

interface BulkActionBarProps {
  selectedIds: Set<string>;
  channelId: string;
  onClearSelection: () => void;
  onActionComplete: () => void;
  onDeleteSelected?: (ids: string[]) => void;
  onFavoriteSelected?: (ids: string[]) => void;
}

type ActivePopup = "tag" | "trip" | "event" | "person" | null;

export function BulkActionBar({
  selectedIds,
  channelId,
  onClearSelection,
  onActionComplete,
  onDeleteSelected,
  onFavoriteSelected,
}: BulkActionBarProps) {
  const count = selectedIds.size;
  const [activePopup, setActivePopup] = useState<ActivePopup>(null);
  const [loading, setLoading] = useState(false);

  // Loaded metadata
  const [tags, setTags] = useState<Array<{ id: string; name: string; color?: string }>>([]);
  const [trips, setTrips] = useState<Array<{ id: string; name: string }>>([]);
  const [events, setEvents] = useState<Array<{ id: string; name: string }>>([]);
  const [people, setPeople] = useState<Array<{ id: string; name: string }>>([]);

  // Form inputs
  const [newItemName, setNewItemName] = useState("");

  useEffect(() => {
    if (count === 0) {
      setActivePopup(null);
      return;
    }
    // Pre-load tags, trips, events, people
    apiFetch(`/api/tags/user-tags?channel_id=${channelId}`)
      .then((r) => r.json())
      .then((d) => setTags(d.tags || []))
      .catch(() => {});

    apiFetch(`/api/trips?channel_id=${channelId}`)
      .then((r) => r.json())
      .then((d) => setTrips(d.trips || []))
      .catch(() => {});

    apiFetch(`/api/tags/events?channel_id=${channelId}`)
      .then((r) => r.json())
      .then((d) => setEvents(d.events || []))
      .catch(() => {});

    apiFetch(`/api/tags/people?channel_id=${channelId}`)
      .then((r) => r.json())
      .then((d) => setPeople(d.people || []))
      .catch(() => {});
  }, [channelId, count]);

  if (count === 0) return null;

  const mediaItemIds = Array.from(selectedIds);

  // 1. Apply Tag in Bulk
  const handleApplyTag = async (tagId: string) => {
    setLoading(true);
    try {
      await apiFetch("/api/tags/media-tag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ media_item_ids: mediaItemIds, tag_id: tagId }),
      });
      setActivePopup(null);
      onActionComplete();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAndApplyTag = async () => {
    if (!newItemName.trim()) return;
    setLoading(true);
    try {
      const res = await apiFetch("/api/tags/user-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel_id: channelId, name: newItemName.trim() }),
      });
      const data = await res.json();
      if (data.tag?.id) {
        await handleApplyTag(data.tag.id);
        setNewItemName("");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // 2. Apply Trip in Bulk
  const handleApplyTrip = async (tripId: string) => {
    setLoading(true);
    try {
      await apiFetch(`/api/trips/${tripId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ media_item_ids: mediaItemIds }),
      });
      setActivePopup(null);
      onActionComplete();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAndApplyTrip = async () => {
    if (!newItemName.trim()) return;
    setLoading(true);
    try {
      const res = await apiFetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel_id: channelId, name: newItemName.trim() }),
      });
      const data = await res.json();
      if (data.trip?.id) {
        await handleApplyTrip(data.trip.id);
        setNewItemName("");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // 3. Apply Event in Bulk
  const handleApplyEvent = async (eventId: string) => {
    setLoading(true);
    try {
      await apiFetch("/api/tags/media-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ media_item_ids: mediaItemIds, event_id: eventId }),
      });
      setActivePopup(null);
      onActionComplete();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAndApplyEvent = async () => {
    if (!newItemName.trim()) return;
    setLoading(true);
    try {
      const res = await apiFetch("/api/tags/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel_id: channelId, name: newItemName.trim() }),
      });
      const data = await res.json();
      if (data.event?.id) {
        await handleApplyEvent(data.event.id);
        setNewItemName("");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // 4. Apply Person in Bulk
  const handleApplyPerson = async (personId: string) => {
    setLoading(true);
    try {
      await apiFetch("/api/tags/media-person", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ media_item_ids: mediaItemIds, person_id: personId }),
      });
      setActivePopup(null);
      onActionComplete();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAndApplyPerson = async () => {
    if (!newItemName.trim()) return;
    setLoading(true);
    try {
      const res = await apiFetch("/api/tags/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel_id: channelId, name: newItemName.trim() }),
      });
      const data = await res.json();
      if (data.person?.id) {
        await handleApplyPerson(data.person.id);
        setNewItemName("");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center select-none">
      {/* Popover Menu */}
      {activePopup && (
        <div className="mb-3 w-80 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-2xl shadow-2xl p-3.5 space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-150">
          <div className="flex items-center justify-between border-b border-[var(--border-color)] pb-2">
            <span className="text-xs font-semibold text-[var(--text-primary)]">
              {activePopup === "tag" && `Add Tag to ${count} items`}
              {activePopup === "trip" && `Add ${count} items to Trip`}
              {activePopup === "event" && `Add ${count} items to Event`}
              {activePopup === "person" && `Tag Person on ${count} items`}
            </span>
            <button
              onClick={() => setActivePopup(null)}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Quick Create Input */}
          <div className="flex gap-1.5">
            <input
              type="text"
              placeholder={`Create new ${activePopup}...`}
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              className="flex-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={() => {
                if (activePopup === "tag") handleCreateAndApplyTag();
                if (activePopup === "trip") handleCreateAndApplyTrip();
                if (activePopup === "event") handleCreateAndApplyEvent();
                if (activePopup === "person") handleCreateAndApplyPerson();
              }}
              disabled={loading || !newItemName.trim()}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium disabled:opacity-50 transition-colors"
            >
              Add
            </button>
          </div>

          {/* Existing Items Selection */}
          <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
            {activePopup === "tag" &&
              tags.map((t) => (
                <button
                  key={t.id}
                  onClick={() => handleApplyTag(t.id)}
                  className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-[var(--bg-hover)] text-xs text-[var(--text-primary)] text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: t.color || "#3B82F6" }} />
                    <span>{t.name}</span>
                  </div>
                  <span className="text-[10px] text-[var(--text-secondary)]">+ Apply</span>
                </button>
              ))}

            {activePopup === "trip" &&
              trips.map((tr) => (
                <button
                  key={tr.id}
                  onClick={() => handleApplyTrip(tr.id)}
                  className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-[var(--bg-hover)] text-xs text-[var(--text-primary)] text-left"
                >
                  <div className="flex items-center gap-2 truncate mr-2">
                    <Compass className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                    <span className="truncate">{tr.name}</span>
                  </div>
                  <span className="text-[10px] text-[var(--text-secondary)]">+ Add</span>
                </button>
              ))}

            {activePopup === "event" &&
              events.map((ev) => (
                <button
                  key={ev.id}
                  onClick={() => handleApplyEvent(ev.id)}
                  className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-[var(--bg-hover)] text-xs text-[var(--text-primary)] text-left"
                >
                  <div className="flex items-center gap-2 truncate mr-2">
                    <Calendar className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
                    <span className="truncate">{ev.name}</span>
                  </div>
                  <span className="text-[10px] text-[var(--text-secondary)]">+ Add</span>
                </button>
              ))}

            {activePopup === "person" &&
              people.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleApplyPerson(p.id)}
                  className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-[var(--bg-hover)] text-xs text-[var(--text-primary)] text-left"
                >
                  <div className="flex items-center gap-2 truncate mr-2">
                    <User className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                    <span className="truncate">{p.name}</span>
                  </div>
                  <span className="text-[10px] text-[var(--text-secondary)]">+ Tag</span>
                </button>
              ))}
          </div>
        </div>
      )}

      {/* Floating Action Pill */}
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-[var(--bg-surface)]/95 backdrop-blur-md border border-[var(--border-color)] shadow-2xl text-[var(--text-primary)] text-xs font-medium">
        <span className="font-semibold text-blue-500 px-1">{count} selected</span>

        <div className="h-4 w-px bg-[var(--border-color)] mx-1" />

        {/* Tag Button */}
        <button
          onClick={() => setActivePopup(activePopup === "tag" ? null : "tag")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-colors ${
            activePopup === "tag" ? "bg-blue-600 text-white" : "hover:bg-[var(--bg-hover)]"
          }`}
        >
          <Tag className="w-3.5 h-3.5" />
          <span>Tag</span>
        </button>

        {/* Trip Button */}
        <button
          onClick={() => setActivePopup(activePopup === "trip" ? null : "trip")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-colors ${
            activePopup === "trip" ? "bg-amber-600 text-white" : "hover:bg-[var(--bg-hover)]"
          }`}
        >
          <Compass className="w-3.5 h-3.5" />
          <span>Trip</span>
        </button>

        {/* Event Button */}
        <button
          onClick={() => setActivePopup(activePopup === "event" ? null : "event")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-colors ${
            activePopup === "event" ? "bg-purple-600 text-white" : "hover:bg-[var(--bg-hover)]"
          }`}
        >
          <Calendar className="w-3.5 h-3.5" />
          <span>Event</span>
        </button>

        {/* Person Button */}
        <button
          onClick={() => setActivePopup(activePopup === "person" ? null : "person")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-colors ${
            activePopup === "person" ? "bg-blue-600 text-white" : "hover:bg-[var(--bg-hover)]"
          }`}
        >
          <User className="w-3.5 h-3.5" />
          <span>Person</span>
        </button>

        {/* Favorite Button */}
        {onFavoriteSelected && (
          <button
            onClick={() => onFavoriteSelected(mediaItemIds)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full hover:bg-[var(--bg-hover)] text-amber-500 transition-colors"
            title="Favorite selected"
          >
            <Star className="w-3.5 h-3.5 fill-amber-500/20" />
            <span>Favorite</span>
          </button>
        )}

        {/* Delete Button */}
        {onDeleteSelected && (
          <button
            onClick={() => onDeleteSelected(mediaItemIds)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full hover:bg-rose-500/10 text-rose-500 transition-colors"
            title="Delete selected media"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete</span>
          </button>
        )}

        <div className="h-4 w-px bg-[var(--border-color)] mx-1" />

        {/* Clear selection button */}
        <button
          onClick={onClearSelection}
          className="p-1.5 rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          title="Clear selection"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
