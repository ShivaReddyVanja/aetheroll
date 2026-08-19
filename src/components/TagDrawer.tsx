"use client";

import React, { useState, useEffect } from "react";
import { X, User, MapPin, Calendar, Plus, Trash2, Info, Check } from "lucide-react";
import { MediaItem } from "./MediaCard";

interface TagDrawerProps {
  item: MediaItem;
  channelId: string;
  onClose: () => void;
  onItemUpdated: () => void;
}

export function TagDrawer({ item, channelId, onClose, onItemUpdated }: TagDrawerProps) {
  // People state
  const [peopleList, setPeopleList] = useState<Array<{ id: string; name: string }>>([]);
  const [newPersonName, setNewPersonName] = useState("");
  const [selectedPersonId, setSelectedPersonId] = useState("");

  // Location state
  const [locationName, setLocationName] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");

  // Event state
  const [eventsList, setEventsList] = useState<Array<{ id: string; name: string }>>([]);
  const [newEventName, setNewEventName] = useState("");
  const [selectedEventId, setSelectedEventId] = useState("");

  const [loading, setLoading] = useState(false);

  // Load existing channel people and events
  useEffect(() => {
    fetch(`/api/tags/people?channel_id=${channelId}`)
      .then((res) => res.json())
      .then((data) => setPeopleList(data.people || []))
      .catch(console.error);

    fetch(`/api/tags/events?channel_id=${channelId}`)
      .then((res) => res.json())
      .then((data) => setEventsList(data.events || []))
      .catch(console.error);
  }, [channelId]);

  // Handle Add Person
  const handleAddPerson = async () => {
    if (!selectedPersonId && !newPersonName.trim()) return;
    setLoading(true);

    try {
      let personId = selectedPersonId;
      if (!personId && newPersonName.trim()) {
        const createRes = await fetch("/api/tags/people", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel_id: channelId, name: newPersonName.trim() }),
        });
        const created = await createRes.json();
        personId = created.person?.id;
      }

      if (personId) {
        await fetch("/api/tags/media-person", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ media_item_id: item.id, person_id: personId }),
        });
        setNewPersonName("");
        setSelectedPersonId("");
        onItemUpdated();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // Remove Person
  const handleRemovePerson = async (personId: string) => {
    await fetch("/api/tags/media-person", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ media_item_id: item.id, person_id: personId, remove: true }),
    });
    onItemUpdated();
  };

  // Handle Add Location
  const handleAddLocation = async () => {
    if (!locationName.trim()) return;
    setLoading(true);

    try {
      await fetch("/api/tags/media-location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media_item_id: item.id,
          name: locationName.trim(),
          latitude: latitude ? parseFloat(latitude) : null,
          longitude: longitude ? parseFloat(longitude) : null,
          source: "manual",
        }),
      });
      setLocationName("");
      setLatitude("");
      setLongitude("");
      onItemUpdated();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // Remove Location
  const handleRemoveLocation = async (locId: string) => {
    await fetch("/api/tags/media-location", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ media_item_id: item.id, location_id: locId, remove: true }),
    });
    onItemUpdated();
  };

  // Handle Add Event
  const handleAddEvent = async () => {
    if (!selectedEventId && !newEventName.trim()) return;
    setLoading(true);

    try {
      let eventId = selectedEventId;
      if (!eventId && newEventName.trim()) {
        const createRes = await fetch("/api/tags/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel_id: channelId, name: newEventName.trim() }),
        });
        const created = await createRes.json();
        eventId = created.event?.id;
      }

      if (eventId) {
        await fetch("/api/tags/media-event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ media_item_id: item.id, event_id: eventId }),
        });
        setNewEventName("");
        setSelectedEventId("");
        onItemUpdated();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // Remove Event
  const handleRemoveEvent = async (eventId: string) => {
    await fetch("/api/tags/media-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ media_item_id: item.id, event_id: eventId, remove: true }),
    });
    onItemUpdated();
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <aside className="w-80 h-full bg-slate-900 border-l border-slate-800 flex flex-col z-50 overflow-y-auto">
      {/* Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2 text-white font-medium text-sm">
          <Info className="w-4 h-4 text-blue-400" />
          <span>Info & Tags</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-6 flex-1">
        {/* File Details */}
        <section className="space-y-2">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Details
          </div>
          <div className="bg-slate-800/50 p-3 rounded-xl space-y-1.5 text-xs text-slate-300">
            <div className="flex justify-between">
              <span className="text-slate-500">Type</span>
              <span className="font-mono uppercase">{item.file_type} ({item.mime_type})</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Dimensions</span>
              <span>{item.width} × {item.height} px</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">File Size</span>
              <span>{formatBytes(item.file_size_bytes)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Captured</span>
              <span>{new Date(item.captured_at).toLocaleString()}</span>
            </div>
          </div>
        </section>

        {/* Person Tags */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-400 uppercase tracking-wider">
            <span className="flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-blue-400" />
              People
            </span>
            <span className="text-[10px] text-slate-500 font-normal">
              {item.people?.length || 0} tagged
            </span>
          </div>

          {/* Tagged People Badges */}
          <div className="flex flex-wrap gap-1.5">
            {item.people?.map((p) => (
              <span
                key={p.id}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-300 text-xs border border-blue-500/20"
              >
                {p.name}
                <button
                  onClick={() => handleRemovePerson(p.id)}
                  className="hover:text-rose-400 ml-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>

          {/* Add Person Input */}
          <div className="flex gap-1.5">
            <input
              type="text"
              placeholder="Add or create person..."
              value={newPersonName}
              onChange={(e) => setNewPersonName(e.target.value)}
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={handleAddPerson}
              disabled={loading || !newPersonName.trim()}
              className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </section>

        {/* Location Tags */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-400 uppercase tracking-wider">
            <span className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-emerald-400" />
              Location
            </span>
          </div>

          {/* Tagged Locations */}
          <div className="space-y-1.5">
            {item.locations?.map((l) => (
              <div
                key={l.id}
                className="flex items-center justify-between p-2 rounded-lg bg-slate-800 text-xs text-slate-200"
              >
                <div className="flex items-center gap-1.5 truncate mr-2">
                  <MapPin className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                  <span className="truncate">{l.name}</span>
                </div>
                <button
                  onClick={() => handleRemoveLocation(l.id)}
                  className="text-slate-400 hover:text-rose-400"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          {/* Add Location Form */}
          <div className="space-y-1.5">
            <input
              type="text"
              placeholder="Place name (e.g. Paris, Goa)"
              value={locationName}
              onChange={(e) => setLocationName(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
            <div className="flex gap-1.5">
              <input
                type="text"
                placeholder="Lat (optional)"
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
                className="w-1/2 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white placeholder-slate-500"
              />
              <input
                type="text"
                placeholder="Lng (optional)"
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
                className="w-1/2 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white placeholder-slate-500"
              />
            </div>
            <button
              onClick={handleAddLocation}
              disabled={loading || !locationName.trim()}
              className="w-full py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors disabled:opacity-50"
            >
              Attach Location
            </button>
          </div>
        </section>

        {/* Event Tags */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-400 uppercase tracking-wider">
            <span className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-purple-400" />
              Event / Trip
            </span>
          </div>

          {/* Tagged Events */}
          <div className="space-y-1.5">
            {item.events?.map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between p-2 rounded-lg bg-slate-800 text-xs text-slate-200"
              >
                <div className="flex items-center gap-1.5 truncate mr-2">
                  <Calendar className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
                  <span className="truncate">{e.name}</span>
                </div>
                <button
                  onClick={() => handleRemoveEvent(e.id)}
                  className="text-slate-400 hover:text-rose-400"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          {/* Add Event Input */}
          <div className="flex gap-1.5">
            <input
              type="text"
              placeholder="Event name (e.g. Goa Trip 2025)..."
              value={newEventName}
              onChange={(e) => setNewEventName(e.target.value)}
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
            />
            <button
              onClick={handleAddEvent}
              disabled={loading || !newEventName.trim()}
              className="px-2.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </section>
      </div>
    </aside>
  );
}
