# Album (Channel) Management & Collaboration Architecture Plan

This document details the architectural design and technical specification for comprehensive **Album Management, Member Collaboration, and Admin Control** in Aetheroll.

---

## 1. Executive Summary

Aetheroll uses Telegram Channels and Supergroups as secure, encrypted cloud photo/video albums. To give users full control over their albums, this plan specifies the implementation of:
1. **Dual Album Modes** (Personal Broadcast vs. Collaborative Shared Album).
2. **Full Album Settings UI** (Edit Title, Description/Bio, Public `@username`, Cover Details).
3. **Member Roster & Collaboration Controls** (View Members, Search, Promote to Admin for upload rights, Remove Member).
4. **Lifecycle Operations** (Leave Album as a member, Delete Album as owner).

---

## 2. Album Types & Permissions Architecture

Telegram supports two distinct chat models for photo storage. Aetheroll supports both:

| Property | 🔒 Personal Album (Broadcast Channel) | 👥 Collaborative Shared Album (Supergroup) |
|---|---|---|
| **Telegram Type** | `broadcast: true`, `megagroup: false` | `broadcast: false`, `megagroup: true` |
| **Primary Use Case** | Personal backup, organized private galleries | Family/friends shared albums, party photo dumps |
| **Who can upload media?** | Creator & Promoted Admins only | **All Members** automatically upon joining |
| **Chat Timeline** | Clean media feed (no user chatter) | Shared media feed with member contributions |
| **Invite Model** | Invite link / Direct add (viewers until promoted) | Invite link / Direct add (instant uploaders) |

### Creation Flow Choice
In `CreateChannelSheet.tsx`, users can select between:
- **Personal Album**: Clean, creator-controlled feed. Invited members view media until promoted.
- **Collaborative Shared Album**: Open shared feed where any invited friend can upload immediately.

---

## 3. MTProto API Integration & Backend Specification

All management operations will be added to `workers/api/src/routes/channels/manageChannels.ts` using GramJS (`Api`).

### New & Updated Endpoints

#### 1. `POST /api/channels/info`
Returns full metadata for an album.
- **MTProto Method**: `Api.channels.GetFullChannel({ channel: targetPeer })`
- **Response**:
  ```ts
  {
    success: true,
    info: {
      id: string,
      telegram_channel_id: string,
      title: string,
      about: string,
      username: string | null,
      participants_count: number,
      admins_count: number,
      is_owner: boolean,
      is_admin: boolean,
      is_megagroup: boolean,
      is_public: boolean,
      can_edit_info: boolean,
      can_post_messages: boolean,
      can_invite_users: boolean
    }
  }
  ```

#### 2. `POST /api/channels/members`
Returns the roster of members in the album.
- **MTProto Method**: `Api.channels.GetParticipants({ channel: targetPeer, filter, offset, limit: 100 })`
- **Filters**: `ChannelParticipantsRecent`, `ChannelParticipantsAdmins`, `ChannelParticipantsSearch`
- **Response**:
  ```ts
  {
    success: true,
    members: Array<{
      id: string,
      first_name: string,
      last_name?: string,
      username?: string,
      role: 'creator' | 'admin' | 'member',
      custom_title?: string
    }>
  }
  ```

#### 3. `POST /api/channels/update-info`
Updates album title, description/about, or public username.
- **MTProto Methods**:
  - Title: `Api.channels.EditTitle({ channel, title })`
  - About/Bio: `Api.messages.EditChatAbout({ peer, about })`
  - Public Username: `Api.channels.UpdateUsername({ channel, username })`
- **DB Action**: Updates `channels` table (`name = title`) in Cloudflare D1.

#### 4. `POST /api/channels/promote-admin`
Promotes or demotes a member, granting/revoking posting (upload) permissions.
- **MTProto Method**: `Api.channels.EditAdmin({ channel, userId, adminRights, rank })`
- **Admin Rights Granted**: `postMessages: true`, `editMessages: true`, `inviteUsers: true`.

#### 5. `POST /api/channels/remove-member`
Kicks a member from the album.
- **MTProto Method**: `Api.channels.EditBanned({ channel, participant, bannedRights: new Api.ChatBannedRights({ viewMessages: true }) })`

#### 6. `POST /api/channels/delete-or-leave`
Deletes the channel (if owner) or leaves the channel (if non-owner member).
- **MTProto Method**:
  - Owner: `Api.channels.DeleteChannel({ channel })`
  - Member: `Api.channels.LeaveChannel({ channel })`
- **DB Action**: Purges channel records from `channels` and `gallery_channels`.

---

## 4. Mobile UI Design & Component Hierarchy

```
apps/mobile/src/
├── components/
│   ├── ChannelSettingsSheet.tsx   # [NEW] Reusable bottom sheet for Album Info, Roster, & Controls
│   ├── CreateChannelSheet.tsx    # [MODIFY] Added Personal vs. Collaborative Album Mode Selector
│   ├── ChannelPickerSheet.tsx    # [MODIFY] Added ⚙️ Settings trigger per channel row
│   └── Header.tsx                # [MODIFY] Added ⚙️ Settings trigger next to active album title
└── screens/
    └── GalleryScreen.tsx         # [MODIFY] State management & callbacks for settings sheet
```

### `ChannelSettingsSheet.tsx` Sections

1. **Header & Album Info Card**:
   - Album Avatar + Name + Type Badge (`Personal` or `Shared`).
   - Inline edit for Album Name & About description.
   - Public Username badge / link copy.
2. **Members & Collaboration Section**:
   - Member Count badge & Search bar.
   - Member List row:
     - Avatar + Name + `@username`.
     - Badge (`Creator`, `Admin`, `Member`).
     - **Action Menu** (for Admins/Owner):
       - ⚡ *Promote to Admin / Enable Upload Rights*
       - 🚫 *Remove from Album*
3. **Danger Zone**:
   - 🚪 *Leave Album* (for members)
   - 🗑️ *Delete Album Permanently* (for owners, requires confirmation modal)

---

## 5. Database Schema & Data Integrity

- When album title is updated via `/api/channels/update-info`, D1 `channels.name` is updated immediately.
- When an album is deleted via `/api/channels/delete-or-leave`, D1 CASCADE deletes:
  - `gallery_channels` mapping
  - `media_items` records for that channel
  - `channels` record

---

## 6. Implementation Checklist & Phases

### Phase 1: Worker API Endpoints
- [ ] Implement `POST /api/channels/info`
- [ ] Implement `POST /api/channels/members`
- [ ] Implement `POST /api/channels/update-info`
- [ ] Implement `POST /api/channels/promote-admin`
- [ ] Implement `POST /api/channels/remove-member`
- [ ] Implement `POST /api/channels/delete-or-leave`
- [ ] Add unit tests in `workers/api/src/routes/channels/channels.test.ts`

### Phase 2: Mobile UI Implementation
- [ ] Build `ChannelSettingsSheet.tsx` component with tabbed or sectioned layout
- [ ] Update `CreateChannelSheet.tsx` with Personal vs. Collaborative Album mode toggle
- [ ] Connect Settings ⚙️ button in `Header.tsx` and `ChannelPickerSheet.tsx`
- [ ] Wire state in `GalleryScreen.tsx`

### Phase 3: Testing & Verification
- [ ] Verify TypeScript types (`pnpm --filter @aetheroll/mobile exec tsc --noEmit`)
- [ ] Verify API unit tests (`pnpm --filter @aetheroll/api run test:unit`)
- [ ] Run full monorepo build (`pnpm turbo run build`)
