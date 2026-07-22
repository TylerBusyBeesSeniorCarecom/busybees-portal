"use client";

import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Timestamp,
  type Unsubscribe,
} from "firebase/firestore";

import { firebaseAuth, firebaseDb } from "@/lib/firebase/client";
import type { HiveConversation, HiveMessage, HiveUserType } from "@/lib/messages/types";

type ConversationMeta = {
  displayName: string;
  type: HiveUserType | "group";
  section: HiveConversation["section"];
};

type ThreadCallback = (messages: HiveMessage[]) => void;
type ConversationsCallback = (conversations: HiveConversation[]) => void;

type SendMessageParams = {
  conversationID: string;
  body: string;
  senderID: string;
  senderName: string;
  category: string;
  queryTargets: string[];
  scheduleOfferShiftIDs?: string[];
};

export type ShiftRecord = {
  docID: string;
  shiftID: string;
  caregiverID: string;
  weekStart: string;
  date: string;
  client: string;
  startTime: string;
  endTime: string;
};

const conversationMetaCache = new Map<string, ConversationMeta>();
const conversationMetaPromiseCache = new Map<string, Promise<ConversationMeta>>();
const currentUserUidByMessageId = new Map<string, string>();

const sectionOrder: Record<HiveConversation["section"], number> = {
  top: 0,
  staff: 1,
  caregivers: 2,
  clients: 3,
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof (value as Timestamp)?.toDate === "function") {
    try {
      return (value as Timestamp).toDate();
    } catch {
      return null;
    }
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function normalizeLegacyTimestamp(value: unknown): Date | null {
  const direct = normalizeDate(value);
  if (direct) return direct;

  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  const plainMatch = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/
  );
  if (plainMatch) {
    const date = new Date(
      Date.UTC(
        Number(plainMatch[1]),
        Number(plainMatch[2]) - 1,
        Number(plainMatch[3]),
        Number(plainMatch[4]),
        Number(plainMatch[5]),
        Number(plainMatch[6])
      )
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const iso = new Date(raw);
  return Number.isNaN(iso.getTime()) ? null : iso;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeString(item)).filter(Boolean);
}

function normalizeRole(value: unknown): HiveUserType {
  const role = normalizeString(value).toLowerCase();
  if (role === "admin") return "admin";
  if (role === "client") return "client";
  if (role === "beekeeper" || role === "bee keeper") return "beekeeper";
  return "caregiver";
}

function normalizeReadReceipts(data: Record<string, unknown>) {
  const readReceipts = toRecord(data.readReceipts);
  const readAtByUser: Record<string, Date> = {};

  for (const [userId, rawDate] of Object.entries(readReceipts)) {
    const parsed = normalizeLegacyTimestamp(rawDate);
    if (userId && parsed) {
      readAtByUser[userId] = parsed;
    }
  }

  for (const [key, rawValue] of Object.entries(data)) {
    if (!key.includes("_")) continue;
    if (key === "readBy" || key === "readReceipts") continue;
    if (key in readAtByUser) continue;
    const normalizedKey = key.replace(/_/g, "-");
    const parsed = normalizeLegacyTimestamp(rawValue);
    if (normalizedKey && parsed) {
      readAtByUser[normalizedKey] = parsed;
    }
  }

  const readBy = Object.keys(readAtByUser);

  return { readBy, readAtByUser };
}

function normalizeMessageDoc(snapshot: QueryDocumentSnapshot<DocumentData>): HiveMessage {
  const data = snapshot.data() as Record<string, unknown>;
  const { readBy, readAtByUser } = normalizeReadReceipts(data);

  return {
    id: snapshot.id,
    conversationID: normalizeString(data.conversationID),
    body: normalizeString(data.body) || normalizeString(data.message),
    senderID: normalizeString(data.senderID),
    senderName: normalizeString(data.senderName),
    category: normalizeString(data.category),
    timestamp: normalizeDate(data.timestamp),
    readBy,
    readAtByUser,
    queryTargets: toStringArray(data.queryTargets),
    scheduleOfferShiftIDs: toStringArray(data.scheduleOfferShiftIDs),
    scheduleOfferAcceptedAt: normalizeDate(data.scheduleOfferAcceptedAt),
    editedAt: normalizeDate(data.editedAt),
    deletedForAll: Boolean(data.deletedForAll),
  };
}

function normalizeShiftRecord(snapshot: QueryDocumentSnapshot<DocumentData>): ShiftRecord | null {
  const data = snapshot.data() as Record<string, unknown>;
  const shiftID = normalizeString(data.shiftID) || snapshot.id;
  const caregiverID = normalizeString(data.caregiverID);
  const weekStart = normalizeString(data.weekStart);
  const date = normalizeString(data.date);
  const client = normalizeString(data.client);
  const startTime = normalizeString(data.startTime);
  const endTime = normalizeString(data.endTime);

  if (!shiftID || !caregiverID || !weekStart || !date || !client || !startTime || !endTime) {
    return null;
  }

  return {
    docID: snapshot.id,
    shiftID,
    caregiverID,
    weekStart,
    date,
    client,
    startTime,
    endTime,
  };
}

async function resolveConversationMeta(
  conversationID: string,
  fallbackName: string
): Promise<ConversationMeta> {
  if (conversationMetaCache.has(conversationID)) {
    return conversationMetaCache.get(conversationID)!;
  }

  if (conversationMetaPromiseCache.has(conversationID)) {
    return conversationMetaPromiseCache.get(conversationID)!;
  }

  const pending = (async () => {
    let resolved: ConversationMeta;

    if (conversationID === "System-Group-1") {
      resolved = { displayName: "All Staff", type: "group", section: "top" };
    } else if (conversationID.startsWith("CL-")) {
      const clientSnapshot = await getDoc(doc(firebaseDb, "clientsAdmin", conversationID));
      const clientData = clientSnapshot.exists() ? (clientSnapshot.data() as Record<string, unknown>) : {};
      resolved = {
        displayName: normalizeString(clientData.name) || fallbackName || conversationID,
        type: "client",
        section: "clients",
      };
    } else {
      const userSnapshot = await getDoc(doc(firebaseDb, "users", conversationID));
      const userData = userSnapshot.exists() ? (userSnapshot.data() as Record<string, unknown>) : {};
      const userType = normalizeRole(userData.role);
      resolved = {
        displayName:
          normalizeString(userData.displayName) ||
          normalizeString(userData.nameOnSchedule) ||
          normalizeString(userData.name) ||
          fallbackName ||
          conversationID,
        type: userType,
        section: userType === "admin" ? "staff" : "caregivers",
      };
    }

    conversationMetaCache.set(conversationID, resolved);
    conversationMetaPromiseCache.delete(conversationID);
    return resolved;
  })();

  conversationMetaPromiseCache.set(conversationID, pending);
  return pending;
}

function sortConversations(conversations: HiveConversation[]) {
  return conversations.sort((a, b) => {
    const sectionDelta = sectionOrder[a.section] - sectionOrder[b.section];
    if (sectionDelta !== 0) return sectionDelta;

    const unreadDelta = Number(b.unreadCount > 0) - Number(a.unreadCount > 0);
    if (unreadDelta !== 0) return unreadDelta;

    const aTime = a.lastTimestamp?.getTime() ?? 0;
    const bTime = b.lastTimestamp?.getTime() ?? 0;
    if (aTime !== bTime) return bTime - aTime;

    return a.displayName.localeCompare(b.displayName);
  });
}

export function subscribeConversations(
  myUserID: string,
  callback: ConversationsCallback
): Unsubscribe {
  const messagesQuery = query(
    collection(firebaseDb, "messages"),
    orderBy("timestamp", "desc"),
    limit(500)
  );

  return onSnapshot(messagesQuery, async (snapshot) => {
    const grouped = new Map<
      string,
      { latest: HiveMessage; unreadCount: number; fallbackName: string }
    >();

    snapshot.docs.forEach((docSnapshot) => {
      const message = normalizeMessageDoc(docSnapshot);
      if (!message.conversationID || message.deletedForAll) return;

      const existing = grouped.get(message.conversationID);
      const unread =
        message.senderID !== myUserID && !message.readBy.includes(myUserID) ? 1 : 0;

      if (!existing) {
        grouped.set(message.conversationID, {
          latest: message,
          unreadCount: unread,
          fallbackName:
            message.senderID === message.conversationID
              ? message.senderName
              : message.senderName || message.conversationID,
        });
        return;
      }

      existing.unreadCount += unread;
    });

    const conversations = await Promise.all(
      Array.from(grouped.entries()).map(async ([conversationID, entry]) => {
        const meta = await resolveConversationMeta(conversationID, entry.fallbackName);
        return {
          id: conversationID,
          displayName: meta.displayName,
          type: meta.type,
          section: meta.section,
          lastMessage: entry.latest.body,
          lastTimestamp: entry.latest.timestamp,
          unreadCount: entry.unreadCount,
        } satisfies HiveConversation;
      })
    );

    callback(sortConversations(conversations));
  });
}

export function subscribeThread(
  conversationID: string,
  callback: ThreadCallback
): Unsubscribe {
  const canonicalConversationID = normalizeConversationKey(conversationID);
  const threadQuery = query(collection(firebaseDb, "messages"), orderBy("timestamp", "asc"));

  return onSnapshot(threadQuery, (snapshot) => {
    const messages = snapshot.docs
      .map((docSnapshot) => normalizeMessageDoc(docSnapshot))
      .filter((message) => {
        if (message.deletedForAll) return false;
        const messageConversationKey = normalizeConversationKey(message.conversationID);
        if (!messageConversationKey || !canonicalConversationID) return false;
        if (messageConversationKey === canonicalConversationID) return true;

        const targetMatches = message.queryTargets.some(
          (target) => normalizeConversationKey(target) === canonicalConversationID
        );
        return targetMatches;
      });

    callback(messages);
  });
}

export async function sendMessage({
  conversationID,
  body,
  senderID,
  senderName,
  category,
  queryTargets,
  scheduleOfferShiftIDs,
}: SendMessageParams): Promise<string> {
  const trimmedBody = body.trim();
  if (!trimmedBody) {
    throw new Error("Message body is required");
  }

  const uniqueTargets = Array.from(new Set(queryTargets.map((item) => item.trim()).filter(Boolean)));
  const uniqueShiftIDs = Array.from(
    new Set((scheduleOfferShiftIDs || []).map((item) => item.trim()).filter(Boolean))
  );

  const payload: Record<string, unknown> = {
    conversationID,
    message: trimmedBody,
    body: trimmedBody,
    recipientID: conversationID,
    senderID,
    senderName,
    category,
    queryTargets: uniqueTargets,
    status: "",
    notified: false,
    timestamp: serverTimestamp(),
    readReceipts: {
      [senderID]: serverTimestamp(),
    },
    readBy: [senderID],
    deletedForAll: false,
  };

  if (uniqueShiftIDs.length > 0) {
    payload.scheduleOfferShiftIDs = uniqueShiftIDs;
  }

  const docRef = await addDoc(collection(firebaseDb, "messages"), payload);

  currentUserUidByMessageId.set(docRef.id, senderID);
  return docRef.id;
}

export async function fetchShiftsByIDs(shiftIDs: string[]): Promise<ShiftRecord[]> {
  const uniqueShiftIDs = Array.from(new Set(shiftIDs.map((id) => normalizeString(id)).filter(Boolean)));
  if (!uniqueShiftIDs.length) return [];

  const results: ShiftRecord[] = [];

  for (let index = 0; index < uniqueShiftIDs.length; index += 30) {
    const chunk = uniqueShiftIDs.slice(index, index + 30);
    const snapshot = await getDocs(
      query(collection(firebaseDb, "shifts"), where("shiftID", "in", chunk))
    );

    snapshot.docs.forEach((docSnapshot) => {
      const record = normalizeShiftRecord(docSnapshot);
      if (!record) return;
      results.push(record);
    });
  }

  return results;
}

export async function markThreadRead(
  conversationID: string,
  myUserID: string
): Promise<void> {
  const canonicalConversationID = normalizeConversationKey(conversationID);
  const snapshot = await getDocs(
    query(collection(firebaseDb, "messages"), orderBy("timestamp", "asc"))
  );

  const matchingDocs = snapshot.docs.filter((docSnapshot) => {
    const message = normalizeMessageDoc(docSnapshot);
    if (message.deletedForAll) return false;

    const messageConversationKey = normalizeConversationKey(message.conversationID);
    if (messageConversationKey && messageConversationKey === canonicalConversationID) return true;

    return message.queryTargets.some(
      (target) => normalizeConversationKey(target) === canonicalConversationID
    );
  });

  const writableDocs = matchingDocs.filter((docSnapshot) => {
    const message = normalizeMessageDoc(docSnapshot);
    return !message.id || (message.senderID !== myUserID && !message.readBy.includes(myUserID));
  });

  for (let index = 0; index < writableDocs.length; index += 450) {
    const batch = writeBatch(firebaseDb);
    const chunk = writableDocs.slice(index, index + 450);

    chunk.forEach((docSnapshot) => {
      batch.update(docSnapshot.ref, {
        [`readReceipts.${myUserID}`]: serverTimestamp(),
        readBy: arrayUnion(myUserID),
      });
    });

    if (chunk.length > 0) {
      await batch.commit();
    }
  }
}

export async function updateMessage(msgID: string, newBody: string): Promise<void> {
  const trimmedBody = newBody.trim();
  if (!trimmedBody) {
    throw new Error("Message body is required");
  }

  const currentUid = firebaseAuth.currentUser?.uid;
  if (!currentUid) {
    throw new Error("Not authenticated");
  }

  const messageRef = doc(firebaseDb, "messages", msgID);
  const messageSnapshot = await getDoc(messageRef);

  if (!messageSnapshot.exists()) {
    throw new Error("Message not found");
  }

  const data = messageSnapshot.data() as Record<string, unknown>;
  const senderID = normalizeString(data.senderID);
  const expectedUid = currentUserUidByMessageId.get(msgID) || senderID;

  if (expectedUid !== currentUid || senderID !== currentUid) {
    throw new Error("You can only edit your own messages");
  }

  console.log("[messages] updateMessage", { msgID, currentUid });
  await updateDoc(messageRef, {
    message: trimmedBody,
    body: trimmedBody,
    editedAt: serverTimestamp(),
  });
  console.log("[messages] updateMessage success", { msgID });
}

export async function markScheduleOfferAccepted(msgID: string): Promise<void> {
  const currentUid = firebaseAuth.currentUser?.uid;
  if (!currentUid) {
    throw new Error("Not authenticated");
  }

  const messageRef = doc(firebaseDb, "messages", msgID);
  const messageSnapshot = await getDoc(messageRef);

  if (!messageSnapshot.exists()) {
    throw new Error("Message not found");
  }

  const data = messageSnapshot.data() as Record<string, unknown>;
  if (normalizeString(data.senderID) !== currentUid) {
    throw new Error("You can only update your own schedule offers");
  }

  await updateDoc(messageRef, {
    scheduleOfferAcceptedAt: serverTimestamp(),
  });
}

export async function updateShiftStatusesByShiftIDs(
  shiftIDs: string[],
  status: string
): Promise<number> {
  const uniqueShiftIDs = Array.from(new Set(shiftIDs.map((id) => normalizeString(id)).filter(Boolean)));
  if (!uniqueShiftIDs.length) return 0;

  let updatedCount = 0;

  for (let index = 0; index < uniqueShiftIDs.length; index += 30) {
    const chunk = uniqueShiftIDs.slice(index, index + 30);
    const snapshot = await getDocs(
      query(collection(firebaseDb, "shifts"), where("shiftID", "in", chunk))
    );

    if (!snapshot.docs.length) continue;

    const batch = writeBatch(firebaseDb);
    snapshot.docs.forEach((docSnapshot) => {
      batch.update(docSnapshot.ref, { status });
      updatedCount += 1;
    });
    await batch.commit();
  }

  return updatedCount;
}

function normalizeConversationKey(value: string): string {
  return normalizeString(value).replace(/[^a-z0-9]/gi, "").toUpperCase();
}
