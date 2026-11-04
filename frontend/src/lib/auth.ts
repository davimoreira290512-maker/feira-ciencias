export interface GoogleSessionExchange {
  session_id: string;
}

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
}

export interface MuralPasswordChange {
  new_password: string;
}

export interface AuthorizedMuralUser {
  user_id: string;
  is_owner: boolean;
  name: string;
  email: string;
  first_access_at: string;
  last_access_at: string;
}