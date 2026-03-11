"use client";

import React from "react";
import { MessagesProvider } from "@/app/api/messages/MessagesContext";
import MessagesPopup from "@/app/api/messages/MessagesPopup";


export default function ClientShell({ children }: { children: React.ReactNode }) {
  return (
    <MessagesProvider>
      {children}
      {/* ✅ One global popup for the whole app */}
      <MessagesPopup />
    </MessagesProvider>
  );
}
