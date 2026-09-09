"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  X,
  User,
  MapPin,
  Calendar,
  Tag as TagIcon,
  Compass,
  Plus,
  Trash2,
  Info,
  Check,
  Loader2,
  Sparkles,
} from "lucide-react";
import { MediaItem } from "./MediaCard";
import { apiFetch } from "@/lib/config";

interface TagDrawerProps {
  item: MediaItem;
  channelId: string;
  onClose: () => void;
  onItemUpdated: () => void;
}

type TabType = "tags" | "trips" | "events" | "people" | "location" | "details";

export function TagDrawer({ item, channelId, onClose, onItemUpdated }: TagDrawerProps) {
  const [activeTab, setActiveTab] = useState<TabType>("tags");

  // People state
  const [peopleList, setPeopleList] = useState<Array<{ id: string; name: string }>>([]);
  const [newPersonName, setNewPersonName] = useState("");

  // Tags state
  const [tagsList, setTagsList] = useState<Array<{ id: string; name: string; color?: string }>>([]);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#3B82F6");

  // Trips state
  const [tripsList, setTripsList] = useState<Array<{ id: string; name: string; start_date?: string }>>([]);
  const [newTripName, setNewTripName] = useState("");

  // Event state
  const [eventsList, setEventsList] = useState<Array<{ id: string; name: string; event_date?: string }>>([]);
  const [newEventName, setNewEventName] = useState("");
  const [newEventDate, setNewEventDate] = useState("");

  // Location state
  const [latitude, setLatitude] = useState(item.latitude != null ? String(item.latitude) : "");
  const [longitude, setLongitude] = useState(item.longitude != null ? String(item.longitude) : "");
  const [altitude, setAltitude] = useState(item.altitude != null ? String(item.altitude) : "");

  const [loading, setLoading] = useState(false);

  // Load all metadata for this channel
  const loadData = useCallback(async () => {
    try {
      const [peopleRes, tagsRes, tripsRes, eventsRes] = await Promise.all([
        apiFetch(`/api/tags/people?channel_id=${channelId}`),
        apiFetch(`/api/tags/user-tags?channel_id=${channelId}`),
        apiFetch(`/api/trips?channel_id=${channelId}`),
        apiFetch(`/api/tags/events?channel_id=${channelId}`),
      ]);

      const [peopleData, tagsData, tripsData, eventsData] = await Promise.all([
        peopleRes.json().catch(() => ({})),
        tagsRes.json().catch(() => ({})),
        tripsRes.json().catch(() => ({})),
        eventsRes.json().catch(() => ({})),
      ]);

      setPeopleList(peopleData.people || []);
      setTagsList(tagsData.tags || []);
      setTripsList(tripsData.trips || []);
      setEventsList(eventsData.events || []);
    } catch (e) {
      console.error("Failed loading drawer metadata:", e);
    }
  }, [channelId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Keep local geo state in sync if item changes
  useEffect(() => {
    setLatitude(item.latitude != null ? String(item.latitude) : "");
    setLongitude(item.longitude != null ? String(item.longitude) : "");
    setAltitude(item.altitude != null ? String(item.altitude) : "");
  }, [item.id, item.latitude, item.longitude, item.altitude]);

  // -------------------------------------------------------------
  // 1. Tags Management
  // -------------------------------------------------------------
  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;
    setLoading(true);
    try {
      const res = await apiFetch("/api/tags/user-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel_id: channelId,
          name: newTagName.trim(),
          color: newTagColor,
        }),
      });
      const data = await res.json();
      if (data.tag) {
        setTagsList((prev) => [...prev.filter((t) => t.id !== data.tag.id), data.tag]);
        // Auto-tag on current media
        await apiFetch("/api/tags/media-tag", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ media_item_ids: [item.id], tag_id: data.tag.id }),
        });
        setNewTagName("");
        onItemUpdated();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleTag = async (tagId: string, isTagged: boolean) => {
    try {
      await apiFetch("/api/tags/media-tag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media_item_ids: [item.id],
          tag_id: tagId,
          remove: isTagged,
        }),
      });
      onItemUpdated();
    } catch (e) {
      console.error(e);
    }
  };

  // -------------------------------------------------------------
  // 2. Trips Management
  // -------------------------------------------------------------
  const handleCreateTrip = async () => {
    if (!newTripName.trim()) return;
    setLoading(true);
    try {
      const res = await apiFetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel_id: channelId,
          name: newTripName.trim(),
          cover_media_id: item.id,
        }),
      });
      const data = await res.json();
      if (data.trip) {
        setTripsList((prev) => [data.trip, ...prev]);
        await apiFetch(`/api/trips/${data.trip.id}/media`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ media_item_ids: [item.id] }),
        });
        setNewTripName("");
        onItemUpdated();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleTrip = async (tripId: string, isInTrip: boolean) => {
    try {
      await apiFetch(`/api/trips/${tripId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media_item_ids: [item.id],
          remove: isInTrip,
        }),
      });
      onItemUpdated();
    } catch (e) {
      console.error(e);
    }
  };

  // -------------------------------------------------------------
  // 3. Events Management
  // -------------------------------------------------------------
  const handleCreateEvent = async () => {
    if (!newEventName.trim()) return;
    setLoading(true);
    try {
      const res = await apiFetch("/api/tags/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel_id: channelId,
          name: newEventName.trim(),
          event_date: newEventDate || null,
        }),
      });
      const data = await res.json();
      if (data.event) {
        setEventsList((prev) => [...prev, data.event]);
        await apiFetch("/api/tags/media-event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ media_item_ids: [item.id], event_id: data.event.id }),
        });
        setNewEventName("");
        setNewEventDate("");
        onItemUpdated();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleEvent = async (eventId: string, isTagged: boolean) => {
    try {
      await apiFetch("/api/tags/media-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media_item_ids: [item.id],
          event_id: eventId,
          remove: isTagged,
        }),
      });
      onItemUpdated();
    } catch (e) {
      console.error(e);
    }
  };

  // -------------------------------------------------------------
  // 4. People Management
  // -------------------------------------------------------------
  const handleCreatePerson = async () => {
    if (!newPersonName.trim()) return;
    setLoading(true);
    try {
      const res = await apiFetch("/api/tags/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel_id: channelId, name: newPersonName.trim() }),
      });
      const data = await res.json();
      if (data.person) {
        setPeopleList((prev) => [...prev, data.person]);
        await apiFetch("/api/tags/media-person", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ media_item_ids: [item.id], person_id: data.person.id }),
        });
        setNewPersonName("");
        onItemUpdated();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleTogglePerson = async (personId: string, isTagged: boolean) => {
    try {
      await apiFetch("/api/tags/media-person", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media_item_ids: [item.id],
          person_id: personId,
          remove: isTagged,
        }),
      });
      onItemUpdated();
    } catch (e) {
      console.error(e);
    }
  };

  // -------------------------------------------------------------
  // 5. Geo Location
  // -------------------------------------------------------------
  const handleSaveLocation = async () => {
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lng)) return;

    setLoading(true);
    try {
      await apiFetch("/api/tags/media-geo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media_item_ids: [item.id],
          latitude: lat,
          longitude: lng,
          altitude: altitude ? parseFloat(altitude) : null,
        }),
      });
      onItemUpdated();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const taggedTagIds = new Set(item.tags?.map((t) => t.id) || []);
  const taggedTripIds = new Set(item.trips?.map((t) => t.id) || []);
  const taggedEventIds = new Set(item.events?.map((e) => e.id) || []);
  const taggedPeopleIds = new Set(item.people?.map((p) => p.id) || []);

  const TAG_PRESET_COLORS = [
    "#3B82F6", // Blue
    "#10B981", // Emerald
    "#F59E0B", // Amber
    "#EC4899", // Pink
    "#8B5CF6", // Purple
    "#EF4444", // Red
    "#06B6D4", // Cyan
  ];

  return (
    <aside className="w-88 h-full bg-[var(--bg-surface)] border-l border-[var(--border-color)] flex flex-col z-50 overflow-hidden shadow-2xl transition-colors duration-200">
      {/* Header */}
      <div className="p-3.5 border-b border-[var(--border-color)] flex items-center justify-between bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-2 text-[var(--text-primary)] font-semibold text-sm">
          <Sparkles className="w-4 h-4 text-blue-500" />
          <span>Organize & Info</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--border-color)] bg-[var(--bg-surface)] px-2 pt-1 gap-1 overflow-x-auto select-none">
        {[
          { id: "tags", label: "Tags", icon: TagIcon },
          { id: "trips", label: "Trips", icon: Compass },
          { id: "events", label: "Events", icon: Calendar },
          { id: "people", label: "People", icon: User },
          { id: "location", label: "Places", icon: MapPin },
          { id: "details", label: "Info", icon: Info },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all whitespace-nowrap ${
                isActive
                  ? "border-blue-500 text-blue-500"
                  : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="p-4 space-y-5 flex-1 overflow-y-auto">
        {/* 1. TAGS TAB */}
        {activeTab === "tags" && (
          <div className="space-y-4">
            <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
              Photo Tags ({item.tags?.length || 0})
            </div>

            {/* Create Tag */}
            <div className="p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-2.5">
              <span className="text-xs font-medium text-[var(--text-primary)]">Create New Tag</span>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  placeholder="e.g. Sunset, Family, Receipt..."
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  className="flex-1 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-blue-500"
                />
                <button
                  onClick={handleCreateTag}
                  disabled={loading || !newTagName.trim()}
                  className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium disabled:opacity-50 transition-colors flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add</span>
                </button>
              </div>

              {/* Color Presets */}
              <div className="flex items-center gap-1.5 pt-1">
                <span className="text-[10px] text-[var(--text-secondary)] mr-1">Color:</span>
                {TAG_PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setNewTagColor(c)}
                    style={{ backgroundColor: c }}
                    className={`w-4 h-4 rounded-full transition-transform ${
                      newTagColor === c ? "ring-2 ring-blue-400 scale-110" : "opacity-75 hover:opacity-100"
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Available Tags Badges */}
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-[var(--text-secondary)]">Available Tags</span>
              {tagsList.length === 0 ? (
                <div className="text-xs text-[var(--text-tertiary)] italic py-2">
                  No tags created yet. Type above to add your first tag.
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {tagsList.map((tag) => {
                    const isTagged = taggedTagIds.has(tag.id);
                    const tagColor = tag.color || "#3B82F6";
                    return (
                      <button
                        key={tag.id}
                        onClick={() => handleToggleTag(tag.id, isTagged)}
                        style={{
                          borderColor: isTagged ? tagColor : undefined,
                          backgroundColor: isTagged ? `${tagColor}22` : undefined,
                        }}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                          isTagged
                            ? "text-[var(--text-primary)] shadow-sm font-semibold"
                            : "border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-slate-500"
                        }`}
                      >
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: tagColor }}
                        />
                        <span>{tag.name}</span>
                        {isTagged && <Check className="w-3 h-3 text-blue-500" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 2. TRIPS TAB */}
        {activeTab === "trips" && (
          <div className="space-y-4">
            <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
              Assigned Trips ({item.trips?.length || 0})
            </div>

            {/* Create Trip */}
            <div className="p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-2.5">
              <span className="text-xs font-medium text-[var(--text-primary)]">Create New Trip</span>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  placeholder="e.g. Goa Vacation 2026..."
                  value={newTripName}
                  onChange={(e) => setNewTripName(e.target.value)}
                  className="flex-1 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-amber-500"
                />
                <button
                  onClick={handleCreateTrip}
                  disabled={loading || !newTripName.trim()}
                  className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium disabled:opacity-50 transition-colors flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Create</span>
                </button>
              </div>
            </div>

            {/* Trips List */}
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-[var(--text-secondary)]">Trips in Channel</span>
              {tripsList.length === 0 ? (
                <div className="text-xs text-[var(--text-tertiary)] italic py-2">
                  No trips yet. Create one to organize photos into a trip album.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {tripsList.map((trip) => {
                    const isInTrip = taggedTripIds.has(trip.id);
                    return (
                      <button
                        key={trip.id}
                        onClick={() => handleToggleTrip(trip.id, isInTrip)}
                        className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-xs text-left transition-all ${
                          isInTrip
                            ? "bg-amber-500/10 border-amber-500/30 text-[var(--text-primary)] font-semibold"
                            : "bg-[var(--bg-secondary)] border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate mr-2">
                          <Compass className={`w-4 h-4 ${isInTrip ? "text-amber-500" : "text-slate-400"}`} />
                          <span className="truncate">{trip.name}</span>
                        </div>
                        {isInTrip ? (
                          <div className="w-4 h-4 rounded-full bg-amber-500 text-black flex items-center justify-center flex-shrink-0">
                            <Check className="w-3 h-3" />
                          </div>
                        ) : (
                          <span className="text-[10px] text-[var(--text-tertiary)]">+ Add</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 3. EVENTS TAB */}
        {activeTab === "events" && (
          <div className="space-y-4">
            <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
              Assigned Events ({item.events?.length || 0})
            </div>

            {/* Create Event */}
            <div className="p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-2">
              <span className="text-xs font-medium text-[var(--text-primary)]">Create New Event</span>
              <input
                type="text"
                placeholder="e.g. Birthday Party, Hackathon 2026..."
                value={newEventName}
                onChange={(e) => setNewEventName(e.target.value)}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-purple-500"
              />
              <div className="flex gap-2">
                <input
                  type="date"
                  value={newEventDate}
                  onChange={(e) => setNewEventDate(e.target.value)}
                  className="flex-1 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-lg px-2 py-1 text-xs text-[var(--text-primary)]"
                />
                <button
                  onClick={handleCreateEvent}
                  disabled={loading || !newEventName.trim()}
                  className="px-3 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium disabled:opacity-50 transition-colors"
                >
                  Create
                </button>
              </div>
            </div>

            {/* Events List */}
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-[var(--text-secondary)]">Events in Channel</span>
              {eventsList.length === 0 ? (
                <div className="text-xs text-[var(--text-tertiary)] italic py-2">
                  No events yet. Create one to label special moments.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {eventsList.map((ev) => {
                    const isTagged = taggedEventIds.has(ev.id);
                    return (
                      <button
                        key={ev.id}
                        onClick={() => handleToggleEvent(ev.id, isTagged)}
                        className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-xs text-left transition-all ${
                          isTagged
                            ? "bg-purple-500/10 border-purple-500/30 text-[var(--text-primary)] font-semibold"
                            : "bg-[var(--bg-secondary)] border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate mr-2">
                          <Calendar className={`w-4 h-4 ${isTagged ? "text-purple-400" : "text-slate-400"}`} />
                          <span className="truncate">{ev.name}</span>
                        </div>
                        {isTagged ? (
                          <div className="w-4 h-4 rounded-full bg-purple-500 text-white flex items-center justify-center flex-shrink-0">
                            <Check className="w-3 h-3" />
                          </div>
                        ) : (
                          <span className="text-[10px] text-[var(--text-tertiary)]">+ Add</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 4. PEOPLE TAB */}
        {activeTab === "people" && (
          <div className="space-y-4">
            <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
              People Tagged ({item.people?.length || 0})
            </div>

            {/* Create Person */}
            <div className="p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-2">
              <span className="text-xs font-medium text-[var(--text-primary)]">Add Person</span>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  placeholder="Person name (e.g. Shiva, Alice)..."
                  value={newPersonName}
                  onChange={(e) => setNewPersonName(e.target.value)}
                  className="flex-1 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-blue-500"
                />
                <button
                  onClick={handleCreatePerson}
                  disabled={loading || !newPersonName.trim()}
                  className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium disabled:opacity-50 transition-colors"
                >
                  Add
                </button>
              </div>
            </div>

            {/* People List */}
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-[var(--text-secondary)]">People in Channel</span>
              {peopleList.length === 0 ? (
                <div className="text-xs text-[var(--text-tertiary)] italic py-2">
                  No people registered yet. Type a name to start facial/people tagging.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {peopleList.map((person) => {
                    const isTagged = taggedPeopleIds.has(person.id);
                    return (
                      <button
                        key={person.id}
                        onClick={() => handleTogglePerson(person.id, isTagged)}
                        className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-xs text-left transition-all ${
                          isTagged
                            ? "bg-blue-500/10 border-blue-500/30 text-[var(--text-primary)] font-semibold"
                            : "bg-[var(--bg-secondary)] border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 truncate mr-2">
                          <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-600 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                            {person.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="truncate">{person.name}</span>
                        </div>
                        {isTagged ? (
                          <div className="w-4 h-4 rounded-full bg-blue-500 text-white flex items-center justify-center flex-shrink-0">
                            <Check className="w-3 h-3" />
                          </div>
                        ) : (
                          <span className="text-[10px] text-[var(--text-tertiary)]">+ Tag</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 5. LOCATION (PLACES) TAB */}
        {activeTab === "location" && (
          <div className="space-y-4">
            <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
              GPS & Place Coordinates
            </div>

            {/* Current Geo Status */}
            <div className="p-3.5 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-primary)]">
                <MapPin className="w-4 h-4 text-emerald-500" />
                <span>
                  {item.latitude != null && item.longitude != null
                    ? `GPS: ${Number(item.latitude).toFixed(4)}, ${Number(item.longitude).toFixed(4)}`
                    : "No GPS Coordinates in EXIF"}
                </span>
              </div>
              {item.latitude != null && item.longitude != null && (
                <a
                  href={`https://www.google.com/maps?q=${item.latitude},${item.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-[11px] text-blue-500 hover:underline pt-1"
                >
                  View on Google Maps ↗
                </a>
              )}
            </div>

            {/* Set / Update Coordinates */}
            <div className="p-3.5 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-3">
              <span className="text-xs font-medium text-[var(--text-primary)]">
                Set Manual Coordinates
              </span>
              <div className="space-y-2">
                <div>
                  <label className="text-[10px] text-[var(--text-secondary)] uppercase">Latitude</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="e.g. 15.2993"
                    value={latitude}
                    onChange={(e) => setLatitude(e.target.value)}
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-secondary)] uppercase">Longitude</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="e.g. 74.1240"
                    value={longitude}
                    onChange={(e) => setLongitude(e.target.value)}
                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
              <button
                onClick={handleSaveLocation}
                disabled={loading || !latitude || !longitude}
                className="w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium disabled:opacity-50 transition-colors"
              >
                {loading ? "Saving..." : "Save GPS Location"}
              </button>
            </div>
          </div>
        )}

        {/* 6. DETAILS (INFO) TAB */}
        {activeTab === "details" && (
          <div className="space-y-4">
            <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
              File & Metadata
            </div>
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] p-3.5 rounded-2xl space-y-2.5 text-xs text-[var(--text-primary)]">
              <div className="flex justify-between items-center py-1 border-b border-[var(--border-color)]">
                <span className="text-[var(--text-secondary)]">File Type</span>
                <span className="font-mono uppercase font-semibold">{item.file_type}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-[var(--border-color)]">
                <span className="text-[var(--text-secondary)]">MIME</span>
                <span className="font-mono text-[11px]">{item.mime_type}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-[var(--border-color)]">
                <span className="text-[var(--text-secondary)]">Resolution</span>
                <span>{item.width} × {item.height} px</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-[var(--border-color)]">
                <span className="text-[var(--text-secondary)]">File Size</span>
                <span>{formatBytes(item.file_size_bytes)}</span>
              </div>
              <div className="flex justify-between items-center py-1 border-b border-[var(--border-color)]">
                <span className="text-[var(--text-secondary)]">Date Captured</span>
                <span>{new Date(item.captured_at).toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center py-1">
                <span className="text-[var(--text-secondary)]">Telegram Msg ID</span>
                <span className="font-mono">{item.telegram_message_id}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
