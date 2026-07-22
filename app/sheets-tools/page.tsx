"use client";

"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import { useMessagesUI } from "@/app/api/messages/MessagesContext";
import { SheetsToolsSharedProvider } from "./SheetsToolsSharedProvider";
import BulkEditToolPanel from "./components/BulkEditToolPanel";
import FirebaseMessagesToolPanel from "./components/FirebaseMessagesToolPanel";
import FloatingToolbar from "./components/FloatingToolbar";
import RecommendationsToolPanel from "./components/RecommendationsToolPanel";
import { UI } from "./shared";
import { FloatingWindowsProvider } from "./useFloatingWindows";

function CenterMessage({ children }: { children: ReactNode }) {
  return (
    <main
      style={{
        minHeight: "100vh",
        width: "100%",
        background: UI.pageBg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 520,
          background: UI.panelBg,
          border: `1px solid ${UI.borderSoft}`,
          borderRadius: 18,
          boxShadow: "0 12px 30px rgba(15,23,42,0.10)",
          padding: "28px 32px",
          textAlign: "center",
          color: UI.text,
          fontSize: 15,
          lineHeight: 1.6,
        }}
      >
        {children}
      </div>
    </main>
  );
}

function SheetsToolsChrome() {
  const messagesUI = useMessagesUI();

  useEffect(() => {
    document.body.classList.add("sheets-tools-route");
    messagesUI.closePanel();
    return () => {
      document.body.classList.remove("sheets-tools-route");
    };
  }, [messagesUI]);

  return (
    <>
      <style jsx global>{`
        body.sheets-tools-route button[title="Messages"]:not([data-sheets-tools-toolbar-message]) {
          display: none !important;
        }
      `}</style>
      <main
        style={{
          minHeight: "100vh",
          width: "100%",
          background: "rgba(243,244,246,0.88)",
        }}
      >
        <FloatingToolbar />
        <BulkEditToolPanel />
        <FirebaseMessagesToolPanel />
        <RecommendationsToolPanel />
      </main>
    </>
  );
}

export default function SheetsToolsPage() {
  const { status } = useSession();

  if (status === "loading") return <CenterMessage>Loading...</CenterMessage>;

  if (status === "unauthenticated") {
    return (
      <CenterMessage>
        Please sign in to your portal account to use this tool.{" "}
        <Link
          href="/api/auth/signin"
          style={{ color: UI.accentText, fontWeight: 700, textDecoration: "none" }}
        >
          Sign in
        </Link>
      </CenterMessage>
    );
  }

  return (
    <SheetsToolsSharedProvider>
      <FloatingWindowsProvider>
        <SheetsToolsChrome />
      </FloatingWindowsProvider>
    </SheetsToolsSharedProvider>
  );
}
