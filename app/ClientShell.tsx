"use client";

import React from "react";
import { SessionProvider } from "next-auth/react";
import { MessagesProvider } from "@/app/api/messages/MessagesContext";
import MessagesPopup from "@/app/api/messages/MessagesPopup";

export default function ClientShell({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <MessagesProvider>
        {children}
        {/* ✅ One global popup for the whole app */}
        <MessagesPopup />
      </MessagesProvider>
    </SessionProvider>
  );
}