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
}

export interface TaskItem {
  task_id: number;
  media_id: number;
  original_filename: string;
  mime_type: string;
  file_size: number;
  status: string;
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
