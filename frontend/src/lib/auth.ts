export interface MuralUnlockRequest {
  password: string;
}

export interface AuthUser {
  user_id: string;
  email: string;
  name: string;
  picture: string | null;
  mural_unlocked: boolean;
  is_owner: boolean;
  is_original_owner: boolean;
}

export interface MuralPasswordChange {
  new_password: string;
}

export interface AuthorizedMuralUser {
  user_id: string;
  is_owner: boolean;
  access_revoked: boolean;
  name: string;
  email: string;
  first_access_at: string;
  last_access_at: string;
}
export interface MuralOwner {
  email: string;
  is_original: boolean;
  granted_by: string | null;
  created_at: string | null;
}
