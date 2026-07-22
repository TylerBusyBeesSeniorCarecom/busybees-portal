"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";

import SignInCard from "@/app/components/auth/SignInCard";

export default function ExtensionSignInPage() {
  const { status } = useSession();
  const [showFallbackMessage, setShowFallbackMessage] = useState(false);

  const handleSuccess = useCallback(() => {
    if (typeof window === "undefined") return;

    window.opener?.postMessage({ type: "busybees-auth-success" }, "*");
    window.close();

    window.setTimeout(() => {
      if (!window.closed) {
        setShowFallbackMessage(true);
      }
    }, 250);
  }, []);

  useEffect(() => {
    if (status === "authenticated") {
      handleSuccess();
    }
  }, [handleSuccess, status]);

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top left, rgba(250,204,21,0.14), transparent 30%), linear-gradient(180deg, #0f172a 0%, #111827 55%, #0b1220 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          display: "grid",
          gap: 12,
        }}
      >
        <SignInCard minimal onSuccess={handleSuccess} />
        {showFallbackMessage ? (
          <div
            style={{
              color: "rgba(255,255,255,0.86)",
              fontSize: 13,
              textAlign: "center",
              lineHeight: 1.5,
            }}
          >
            Signed in successfully. You can close this window.
          </div>
        ) : null}
      </div>
    </main>
  );
}
