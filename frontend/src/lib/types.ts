export type UserRole = "uploader" | "editor" | "curator" | "publisher" | "admin";

export interface User {
  id: number;
  username: string;
  email: string;
  role: UserRole;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: User;
}

export interface RefreshResponse {
  access_token: string;
  token_type: string;
}

export interface City {
  id: number;
  name: string;
  state: string;
  drive_folder_id: string;
  active_event_count: number;
}

export interface Event {
  id: number;
  name: string;
  description: string;
  location: string;
  event_date: string | null;
  status: string;
  city_name: string;
}

export interface UploadResultItem {
  filename: string;
  success: boolean;
  media_id: number | null;
  error: string | null;
}

export interface UploadResponse {
  results: UploadResultItem[];
}

export interface MediaItem {
  id: number;
  original_filename: string;
  mime_type: string;
  file_size: number;
  status: string;
  cloudinary_url?: string | null;
}

export interface TaskItem {
  task_id: number;
  media_id: number;
  original_filename: string;
  mime_type: string;
  file_size: number;
  status: string;
  cloudinary_url?: string | null;
}

export interface EditorBoard {
  available: MediaItem[];
  editing: TaskItem[];
  sent: TaskItem[];
}

export interface UploadEditedResultItem {
  filename: string;
  success: boolean;
  media_version_id: number | null;
  fraud_detected: boolean;
  unlinked: boolean;
  error: string | null;
}

export interface UploadEditedResponse {
  results: UploadEditedResultItem[];
}

export interface VersionHistoryItem {
  version: number;
  status: string;
  edited_by: string | null;
  edited_at: string;
  file_size: number;
}

export interface ReviewItem {
  task_id: number;
  media_id: number;
  original_filename: string;
  mime_type: string;
  cloudinary_url?: string | null;
  edited_cloudinary_url?: string | null;
  original_proxy_url: string;
  edited_proxy_url: string;
  version_history: VersionHistoryItem[];
}

export interface ReviewList {
  items: ReviewItem[];
}

export interface PublishItem {
  task_id: number;
  media_id: number;
  original_filename: string;
  mime_type: string;
  cloudinary_url?: string | null;
  proxy_url: string;
  event_name: string;
  city_name: string;
  event_id: number;
  city_id: number;
}

export interface PublishList {
  items: PublishItem[];
}

export interface PublishHistoryItem {
  task_id: number;
  media_id: number;
  original_filename: string;
  mime_type: string;
  published_at: string;
  event_name: string;
  city_name: string;
}

export interface PublishHistoryGroup {
  date: string;
  items: PublishHistoryItem[];
}

export interface PublishHistory {
  groups: PublishHistoryGroup[];
}

export interface ActiveTask {
  task_id: number;
  role_type: string;
  media_id: number;
  filename: string;
  cloudinary_url?: string | null;
  event_id: number;
  event_name: string;
  city_id: number;
  city_name: string;
}

export interface MediaVersionDetail {
  version: number;
  status: string;
  edited_by: string | null;
  edited_at: string;
  file_size: number;
}

export interface MediaDetail {
  id: number;
  original_filename: string;
  mime_type: string;
  file_size: number;
  status: string;
  cloudinary_url: string | null;
  event_id: number;
  event_name: string;
  city_name: string;
  uploaded_by: string;
  created_at: string;
  versions: MediaVersionDetail[];
}

export interface BottleneckItem {
  phase: string;
  event_id: number;
  event_name: string;
  city_name: string;
  media_id: number;
  filename: string;
  hours_stuck: number;
  threshold_hours: number;
  assigned_to: string | null;
}

export interface BottlenecksResponse {
  bottlenecks: BottleneckItem[];
  thresholds: Record<string, number>;
}

export interface PhaseCounts {
  uploaded: number;
  selected_for_edit: number;
  pending_review: number;
  approved: number;
  published: number;
  rejected_final: number;
}

export interface EventOverviewItem {
  id: number;
  name: string;
  city_name: string;
  event_date: string | null;
  counts: PhaseCounts;
  total_active: number;
}

export interface ScriptHealthItem {
  last_status: string | null;
  last_run: string | null;
  is_healthy: boolean;
}

export interface AdminOverview {
  events: EventOverviewItem[];
  script_health: Record<string, ScriptHealthItem>;
  pending_validation_count: number;
}
