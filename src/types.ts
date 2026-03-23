export type MaskStatus = 'mask' | 'no_mask';

export interface DetectionLog {
  id?: string;
  userId: string;
  userName?: string;
  status: MaskStatus;
  timestamp: string;
  location: string;
  confidence: number;
}

export interface UserProfile {
  uid: string;
  email: string;
  role: 'admin' | 'operator';
  displayName?: string;
}
