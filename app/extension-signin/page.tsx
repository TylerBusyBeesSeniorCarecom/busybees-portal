"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";

import SignInCard from "@/app/components/auth/SignInCard";

export default function ExtensionSignInPage() {
  const { data: session, status } = useSession();
  const [showFallbackMessage, setShowFallbackMessage] = useState(false);
  const successStartedRef = useRef(false);

  useEffect(() => {
    console.log(
      "[bb-signin] /extension-signin page mounted. window.opener exists:",
      !!window.opener,
      "window.top === window:",
      window.top === window
    );
  }, []);

  useEffect(() => {
    console.log(
      "[bb-signin] Session status:",
      status,
      "session.user:",
      session?.user ? { email: session.user.email, name: session.user.name } : null
    );
  }, [session, status]);

  const handleSuccess = useCallback(() => {
    if (typeof window === "undefined") return;
    if (successStartedRef.current) return;

    console.log("[bb-signin] handleSuccess() called. Preparing to postMessage + close.");
    successStartedRef.current = true;

    try {
      console.log("[bb-signin] Calling window.opener.postMessage with type: busybees-auth-success");
      window.opener?.postMessage({ type: "busybees-auth-success" }, "*");
      console.log("[bb-signin] window.opener.postMessage returned (no throw)");
    } catch (error) {
      console.log("[bb-signin] Error during close/postMessage:", error);
    }

    try {
      console.log("[bb-signin] Calling window.top.postMessage as backup");
      window.top?.postMessage({ type: "busybees-auth-success" }, "*");
    } catch (error) {
      console.log("[bb-signin] Error during close/postMessage:", error);
    }

    try {
      console.log("[bb-signin] Calling window.close()");
      window.close();
      console.log("[bb-signin] window.close() returned. Window may or may not be closed.");
    } catch (error) {
      console.log("[bb-signin] Error during close/postMessage:", error);
    }

    window.setTimeout(() => {
      console.log(
        "[bb-signin] 500ms elapsed. window.closed:",
        window.closed,
        "Showing fallback message."
      );
      if (!window.closed) {
        setShowFallbackMessage(true);
      }
    }, 500);
  }, []);

  useEffect(() => {
    if (status === "authenticated" && session?.user) {
      handleSuccess();
    }
  }, [handleSuccess, session?.user, status]);

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
        <SignInCard
          minimal
          callbackUrl="/extension-signin"
          onSuccess={handleSuccess}
        />
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
