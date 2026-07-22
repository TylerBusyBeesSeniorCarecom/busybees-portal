export type HiveUserType = "admin" | "caregiver" | "beekeeper" | "client";

export interface HiveMessage {
  id: string;
  conversationID: string;
  body: string;
  senderID: string;
  senderName: string;
  category: string;
  timestamp: Date | null;
  readBy: string[];
  readAtByUser: Record<string, Date>;
  queryTargets: string[];
  scheduleOfferShiftIDs: string[];
  scheduleOfferAcceptedAt: Date | null;
  editedAt: Date | null;
  deletedForAll: boolean;
}

export interface HiveConversation {
  id: string;
  displayName: string;
  type: HiveUserType | "group";
  section: "top" | "caregivers" | "clients" | "staff";
  lastMessage: string;
  lastTimestamp: Date | null;
  unreadCount: number;
}
