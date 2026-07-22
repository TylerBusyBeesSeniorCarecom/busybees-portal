"use client";

import FirebaseMessagesPanel from "@/app/components/messages/FirebaseMessagesPanel";

import FloatingPanel from "./FloatingPanel";
import { useFloatingWindows } from "../useFloatingWindows";

export default function FirebaseMessagesToolPanel() {
  const { panels } = useFloatingWindows();
  const panel = panels.messages;

  if (!panel.open) return null;

  return (
    <FloatingPanel id="messages" title="Messages">
      <FirebaseMessagesPanel />
    </FloatingPanel>
  );
}
