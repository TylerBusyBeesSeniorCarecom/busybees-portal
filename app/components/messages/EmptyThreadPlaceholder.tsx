"use client";

import { UI } from "@/app/sheets-tools/shared";

type EmptyThreadPlaceholderProps = {
  title?: string;
  subtitle?: string;
  icon?: string;
};

export default function EmptyThreadPlaceholder({
  title = "Select a conversation",
  subtitle = "Your thread will appear here",
  icon = "📥",
}: EmptyThreadPlaceholderProps) {
  return (
    <div
      style={{
        minHeight: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 320 }}>
        <div style={{ fontSize: 48, lineHeight: 1, marginBottom: 16 }}>{icon}</div>
        <div style={{ fontSize: 16, fontWeight: 600, color: "#1a1a1a", marginBottom: 6 }}>
          {title}
        </div>
        <div style={{ fontSize: 13, color: UI.textDim }}>{subtitle}</div>
      </div>
    </div>
  );
}

