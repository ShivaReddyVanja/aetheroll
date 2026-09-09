export interface GalleryEventPayload {
  blur_hash?: string;
  captured_at?: string;
  gps?: {
    lat: number;
    lng: number;
    alt?: number;
    name?: string;
  };
  people?: string[];
  event?: string;
  tags?: string[];
  trip?: string;
  fav?: boolean;
  deleted?: boolean;
}

export type GalleryOpType =
  | "CREATE"
  | "TAG_PEOPLE"
  | "SET_LOCATION"
  | "SET_EVENT"
  | "ADD_TAG"
  | "SET_TRIP"
  | "FAVORITE"
  | "DELETE";

export interface GalleryOp {
  op: GalleryOpType;
  refs: number[]; // Telegram Message IDs of target media items
  data: GalleryEventPayload;
}

export interface GalleryEvent {
  _t: "GP_EVENT";
  v: number;
  ref: number; // Telegram Message ID of the target media item
  op: GalleryOpType;
  data: GalleryEventPayload;
  ts: number;
}

export const EVENT_TAG_PREFIX = "[GP_EVENT:v1]";
export const BATCH_TAG_PREFIX = "[GP_BATCH:v1]";
