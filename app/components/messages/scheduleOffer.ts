"use client";

import type { HiveMessage } from "@/lib/messages/types";

export const SCHEDULE_HEADER = "Hi — here is your schedule for the upcoming week:";
export const SCHEDULE_TRAILER = "Please let me know if this works for you. Thank you!";

export type ScheduleOfferCandidate = {
  messageID: string;
  caregiverName: string;
  shiftIDs: string[];
  senderID: string;
  body: string;
};

export function findLatestScheduleOffer(
  messages: HiveMessage[],
  myUserID: string,
  caregiverName: string
): ScheduleOfferCandidate | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.senderID !== myUserID) continue;
    if (!message.scheduleOfferShiftIDs?.length) continue;
    if (message.scheduleOfferAcceptedAt) continue;
    if (!message.body.includes(SCHEDULE_HEADER)) continue;

    return {
      messageID: message.id,
      caregiverName,
      shiftIDs: message.scheduleOfferShiftIDs,
      senderID: message.senderID,
      body: message.body,
    };
  }

  return null;
}
