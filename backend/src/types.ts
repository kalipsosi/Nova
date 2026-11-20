import type { Request } from 'express';

export type AuthContext = {
  userId: string;
  telegramId: string;
  username: string | null;
  displayName: string | null;
  pairId: string | null;
  pairStatus: 'active' | 'dissolved' | null;
  role: 'owner' | 'partner' | null;
  notificationsConsentedAt: string | null;
  notificationPrefs: Record<string, boolean>;
};

export type AuthedRequest = Request & { auth: AuthContext };
