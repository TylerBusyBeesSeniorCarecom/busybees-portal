"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

export type ComposeRequest = {
  caregiverId: string;
  caregiverName?: string;
  category?: "General" | "Scheduling" | "Payroll";
  text?: string;

  // behavior
  replaceText?: boolean; // default false (append if draft exists)
  focusComposer?: boolean; // default true
};

type MessagesUI = {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
  openPanel: () => void;
  closePanel: () => void;

  // ✅ "open messages + jump to thread + prefill composer"
  composeRequest: ComposeRequest | null;
  openCompose: (req: ComposeRequest) => void;
  clearComposeRequest: () => void;
};

const Ctx = createContext<MessagesUI | null>(null);

const STORAGE_KEY = "bb_messages_open_v1";

export function MessagesProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  // ✅ one-shot command bus for MessagesPopup
  const [composeRequest, setComposeRequest] = useState<ComposeRequest | null>(null);

  // restore persisted open/closed
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === "1") setOpen(true);
    } catch {}
  }, []);

  // persist open/closed
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, open ? "1" : "0");
    } catch {}
  }, [open]);

  const clearComposeRequest = () => setComposeRequest(null);

  const openCompose = (req: ComposeRequest) => {
    const normalized: ComposeRequest = {
      replaceText: false,
      focusComposer: true,
      category: "Scheduling",
      ...req,
    };

    // set the request first, then open
    setComposeRequest(normalized);
    setOpen(true);
  };

  const value = useMemo<MessagesUI>(
    () => ({
      open,
      setOpen,
      toggle: () => setOpen((v) => !v),
      openPanel: () => setOpen(true),
      closePanel: () => setOpen(false),

      composeRequest,
      openCompose,
      clearComposeRequest,
    }),
    [open, composeRequest]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMessagesUI() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMessagesUI must be used inside <MessagesProvider>");
  return v;
}
