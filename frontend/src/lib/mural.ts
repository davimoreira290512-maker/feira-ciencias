export interface MuralMessageCreate {
  body: string;
  recipient_user_id: string | null;
  photo_ids: string[];
}

export interface MuralPhotoUpload {
  id: string;
}

export const photoUrl = (id: string) => `/api/mural/photos/${id}`;

export interface MuralMessage {
  id: string;
  sender_user_id: string;
  sender_name: string;
  recipient_user_id: string | null;
  recipient_name: string | null;
  body: string;
  created_at: string;
  is_new: boolean;
  photo_ids: string[];
}

export interface UnreadCount {
  count: number;
}
