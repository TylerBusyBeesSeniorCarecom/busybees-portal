"use client";

import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import type { CSSProperties } from "react";

import { useSheetsToolsShared } from "@/app/sheets-tools/SheetsToolsSharedProvider";
import { UI } from "@/app/sheets-tools/shared";
import { firebaseDb } from "@/lib/firebase/client";
import { formatReceiptTimestamp } from "@/lib/messages/messageTime";
import type { HiveMessage } from "@/lib/messages/types";

type ReadReceiptsProps = {
  message: HiveMessage;
  myUserID: string;
};

const userNameCache = new Map<string, string>();

function resolveNameFromDocData(data: Record<string, unknown>, fallbackID: string): string {
  const candidates = [data.displayName, data.nameOnSchedule, data.name, data.email];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return fallbackID;
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" style={iconStyle}>
      <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 5.8v4.4l2.8 1.7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" style={iconStyle}>
      <circle cx="10" cy="10" r="8" fill="#22c55e" />
      <path d="M6.2 10.3 8.6 12.7 13.8 7.7" fill="none" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronIcon({ up }: { up: boolean }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" style={iconStyle}>
      <path d={up ? "M5 12.5 10 7.5 15 12.5" : "M5 7.5 10 12.5 15 7.5"} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function useResolvedNames(userIDs: string[]) {
  const { caregiversById } = useSheetsToolsShared();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const missingIDs = userIDs.filter((id) => id && !userNameCache.has(id) && !caregiversById[id]);
    if (missingIDs.length === 0) return;

    let cancelled = false;

    void Promise.all(
      missingIDs.map(async (userID) => {
        const snapshot = await getDoc(doc(firebaseDb, "users", userID));
        const data = snapshot.exists() ? (snapshot.data() as Record<string, unknown>) : {};
        userNameCache.set(userID, resolveNameFromDocData(data, userID));
      })
    ).finally(() => {
      if (!cancelled) setTick((value) => value + 1);
    });

    return () => {
      cancelled = true;
    };
  }, [caregiversById, userIDs.join("|")]);

  return useMemo(() => {
    const resolved = new Map<string, string>();
    for (const userID of userIDs) {
      const caregiver = caregiversById[userID];
      resolved.set(
        userID,
        caregiver?.name || caregiver?.nameOnSchedule || userNameCache.get(userID) || userID
      );
    }
    return resolved;
  }, [caregiversById, tick, userIDs.join("|")]);
}

function formatReadAtTime(date: Date | null): string {
  return formatReceiptTimestamp(date);
}

export default function ReadReceipts({ message, myUserID }: ReadReceiptsProps) {
  const [expanded, setExpanded] = useState(false);
  const isMine = message.senderID === myUserID;

  const readers = useMemo(() => {
    return Object.entries(message.readAtByUser || {})
      .filter(([userID, readAt]) => Boolean(userID) && readAt instanceof Date)
      .filter(([userID]) => userID !== message.senderID)
      .sort((a, b) => a[1].getTime() - b[1].getTime());
  }, [message.readAtByUser, message.senderID]);

  const visibleReaders = readers.filter(([userID]) => userID !== myUserID || !isMine);
  const readerIDs = visibleReaders.map(([userID]) => userID);
  const resolvedNames = useResolvedNames(readerIDs);

  const collapsed = useMemo(() => {
    if (isMine) {
      if (visibleReaders.length === 0) {
        return { icon: <ClockIcon />, text: "Sent" };
      }
    } else if (visibleReaders.length === 0) {
      return { icon: <ClockIcon />, text: "Not read yet" };
    }

    const labels = visibleReaders.map(([userID]) => resolvedNames.get(userID) || userID);
    if (labels.length === 1) {
      return { icon: <CheckIcon />, text: `Read by ${labels[0]}` };
    }
    if (labels.length === 2) {
      return { icon: <CheckIcon />, text: `Read by ${labels[0]}, ${labels[1]}` };
    }
    return {
      icon: <CheckIcon />,
      text: `Read by ${labels[0]}, ${labels[1]} +${labels.length - 2} more`,
    };
  }, [isMine, resolvedNames, visibleReaders]);

  return (
    <div style={{ ...receiptWrapStyle, alignSelf: isMine ? "flex-end" : "flex-start" }}>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        style={collapsedRowButtonStyle}
      >
        <span style={leadingStyle}>
          {collapsed.icon}
          <span style={collapsedTextStyle}>{collapsed.text}</span>
        </span>
        <ChevronIcon up={expanded} />
      </button>

      {expanded && visibleReaders.length > 0 ? (
        <div style={expandedListStyle}>
          {visibleReaders.map(([userID, readAt]) => (
            <div key={userID} style={expandedRowStyle}>
              <div style={expandedNameStyle}>{resolvedNames.get(userID) || userID}</div>
              <div style={expandedSeparatorStyle}>·</div>
              <div style={expandedTimeStyle}>{formatReadAtTime(readAt)}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const receiptWrapStyle: CSSProperties = {
  width: "fit-content",
  maxWidth: "100%",
};

const collapsedRowButtonStyle: CSSProperties = {
  width: "100%",
  minWidth: 120,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  border: "none",
  background: "transparent",
  cursor: "pointer",
  padding: "4px 2px 0",
  color: UI.textDim,
  textAlign: "left",
};

const leadingStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  minWidth: 0,
};

const collapsedTextStyle: CSSProperties = {
  fontSize: 10,
  color: UI.textDim,
  whiteSpace: "nowrap",
};

const expandedListStyle: CSSProperties = {
  marginTop: 6,
  paddingLeft: 2,
  display: "grid",
  gap: 4,
};

const expandedRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 10,
  flexWrap: "wrap",
};

const expandedNameStyle: CSSProperties = {
  fontSize: 11,
  color: "#1a1a1a",
};

const expandedTimeStyle: CSSProperties = {
  fontSize: 10,
  color: UI.textDim,
  flex: "0 0 auto",
  whiteSpace: "nowrap",
};

const expandedSeparatorStyle: CSSProperties = {
  fontSize: 10,
  color: UI.textDim,
  flex: "0 0 auto",
};

const iconStyle: CSSProperties = {
  width: 14,
  height: 14,
  flex: "0 0 auto",
};
