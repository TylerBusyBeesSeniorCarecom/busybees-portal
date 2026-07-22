"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { signIn, useSession } from "next-auth/react";

export interface SignInCardProps {
  minimal?: boolean;
  onSuccess?: () => void;
  callbackUrl?: string;
}

export default function SignInCard({
  minimal = false,
  onSuccess,
  callbackUrl,
}: SignInCardProps) {
  const { status } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isGoogleSigningIn, setIsGoogleSigningIn] = useState(false);
  const [isCredentialsSigningIn, setIsCredentialsSigningIn] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const successCalledRef = useRef(false);

  const effectiveCallbackUrl = callbackUrl ?? (minimal ? "/extension-signin" : "/schedule");
  const isBusy = isGoogleSigningIn || isCredentialsSigningIn;

  useEffect(() => {
    if (!onSuccess || status !== "authenticated" || successCalledRef.current) return;
    successCalledRef.current = true;
    onSuccess();
  }, [onSuccess, status]);

  async function handleGoogleSignIn() {
    try {
      setErrorMessage("");
      setIsGoogleSigningIn(true);
      console.log("[bb-card] Google sign-in button clicked. callbackUrl:", effectiveCallbackUrl);
      await signIn("google", { callbackUrl: effectiveCallbackUrl });
    } catch (error) {
      console.error("Google sign-in failed:", error);
      setErrorMessage("Google sign-in failed. Please try again.");
      setIsGoogleSigningIn(false);
    }
  }

  async function handleCredentialsSignIn(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    try {
      setErrorMessage("");

      const cleanUsername = username.trim();
      console.log("[bb-card] Credentials sign-in submitted. email:", cleanUsername);

      if (!cleanUsername || !password) {
        setErrorMessage("Please enter your username and password.");
        return;
      }

      setIsCredentialsSigningIn(true);

      const result = await signIn("credentials", {
        username: cleanUsername,
        password,
        redirect: false,
        callbackUrl: effectiveCallbackUrl,
      });
      console.log("[bb-card] Credentials signIn result:", {
        ok: result?.ok,
        error: result?.error,
        status: result?.status,
      });

      if (!result) {
        setErrorMessage("Sign-in failed. Please try again.");
        setIsCredentialsSigningIn(false);
        return;
      }

      if (result.error) {
        setErrorMessage(result.error ?? "Invalid email or password");
        setIsCredentialsSigningIn(false);
        return;
      }

      if (onSuccess) {
        console.log("[bb-card] onSuccess() will fire in 100ms");
        window.setTimeout(() => {
          console.log("[bb-card] Calling onSuccess() now");
          onSuccess();
        }, 100);
        return;
      }

      if (!result.ok) {
        setErrorMessage(result.error ?? "Invalid email or password");
        setIsCredentialsSigningIn(false);
        return;
      }

      if (!onSuccess) {
        window.location.href = result.url || effectiveCallbackUrl;
      }
    } catch (error) {
      console.error("Credentials sign-in failed:", error);
      setErrorMessage("Sign-in failed. Please try again.");
      setIsCredentialsSigningIn(false);
    }
  }

  return (
    <section
      style={{
        background: "rgba(255,255,255,0.96)",
        borderRadius: 28,
        padding: minimal ? "28px 24px" : "38px 34px",
        boxShadow: "0 30px 90px rgba(0,0,0,0.34)",
        border: "1px solid rgba(255,255,255,0.65)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        minHeight: minimal ? undefined : 620,
        width: "100%",
      }}
    >
      {!minimal ? (
        <>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 18,
              background: "linear-gradient(180deg, #fde68a 0%, #facc15 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 30,
              boxShadow: "0 14px 30px rgba(234,179,8,0.28)",
              marginBottom: 22,
            }}
          >
            🐝
          </div>

          <div
            style={{
              color: "#b45309",
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: 0.5,
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            Welcome back
          </div>

          <h2
            style={{
              margin: 0,
              fontSize: 34,
              lineHeight: 1.15,
              color: "#111827",
              fontWeight: 800,
              letterSpacing: -0.8,
            }}
          >
            Sign in to continue
          </h2>

          <p
            style={{
              marginTop: 14,
              marginBottom: 28,
              color: "#4b5563",
              fontSize: 15,
              lineHeight: 1.7,
            }}
          >
            Sign in with your Busy Bees admin email and password, or continue
            with Google if your account is enabled for it.
          </p>
        </>
      ) : null}

      <div
        style={{
          background: "#fffaf0",
          border: "1px solid #fde68a",
          color: "#92400e",
          borderRadius: 16,
          padding: "14px 16px",
          fontSize: 13,
          lineHeight: 1.5,
          marginBottom: minimal ? 18 : 22,
        }}
      >
        This portal is restricted to authorized admin users.
      </div>

      {minimal ? (
        <>
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={isBusy}
            style={{
              width: "100%",
              padding: "15px 16px",
              borderRadius: 14,
              border: "1px solid #d1d5db",
              background: isBusy
                ? "#e5e7eb"
                : "linear-gradient(180deg, #ffffff 0%, #f9fafb 100%)",
              color: "#111827",
              fontSize: 16,
              fontWeight: 700,
              cursor: isBusy ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              boxShadow: isBusy ? "none" : "0 10px 24px rgba(15,23,42,0.08)",
              transition: "all 0.18s ease",
            }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: 999,
                background: "#fff",
                border: "1px solid #e5e7eb",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 900,
                flexShrink: 0,
              }}
            >
              G
            </span>
            {isGoogleSigningIn ? "Signing you in..." : "Continue with Google"}
          </button>

          <div
            style={{
              marginTop: 18,
              marginBottom: 18,
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div style={{ flex: 1, height: 1, background: "#e5e7eb" }} />
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "#9ca3af",
                letterSpacing: 0.4,
                textTransform: "uppercase",
              }}
            >
              Or
            </div>
            <div style={{ flex: 1, height: 1, background: "#e5e7eb" }} />
          </div>
        </>
      ) : null}

      <form
        onSubmit={handleCredentialsSignIn}
        style={{
          display: "grid",
          gap: 14,
        }}
      >
        <div style={{ display: "grid", gap: 8 }}>
          <label
            htmlFor={minimal ? "extension-username" : "username"}
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#374151",
            }}
          >
            Username
          </label>
          <input
            id={minimal ? "extension-username" : "username"}
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Email address"
            disabled={isBusy}
            style={{
              width: "100%",
              padding: "15px 16px",
              borderRadius: 14,
              border: "1px solid #d1d5db",
              background: "#ffffff",
              color: "#111827",
              fontSize: 15,
              outline: "none",
            }}
          />
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <label
            htmlFor={minimal ? "extension-password" : "password"}
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#374151",
            }}
          >
            Password
          </label>
          <input
            id={minimal ? "extension-password" : "password"}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            disabled={isBusy}
            style={{
              width: "100%",
              padding: "15px 16px",
              borderRadius: 14,
              border: "1px solid #d1d5db",
              background: "#ffffff",
              color: "#111827",
              fontSize: 15,
              outline: "none",
            }}
          />
        </div>

        {errorMessage ? (
          <div
            style={{
              background: "#fef2f2",
              border: "1px solid #fecaca",
              color: "#b91c1c",
              borderRadius: 14,
              padding: "12px 14px",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {errorMessage}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={isBusy}
          style={{
            width: "100%",
            padding: "15px 16px",
            borderRadius: 14,
            border: "none",
            background: isBusy
              ? "#e5e7eb"
              : "linear-gradient(180deg, #facc15 0%, #f59e0b 100%)",
            color: "#111827",
            fontSize: 16,
            fontWeight: 800,
            cursor: isBusy ? "not-allowed" : "pointer",
            boxShadow: isBusy ? "none" : "0 14px 28px rgba(245,158,11,0.22)",
            transition: "all 0.18s ease",
          }}
        >
          {isCredentialsSigningIn ? "Signing you in..." : "Sign in with username and password"}
        </button>
      </form>

      {!minimal ? (
        <>
          <div
            style={{
              marginTop: 22,
              marginBottom: 22,
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div style={{ flex: 1, height: 1, background: "#e5e7eb" }} />
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "#9ca3af",
                letterSpacing: 0.4,
                textTransform: "uppercase",
              }}
            >
              Or
            </div>
            <div style={{ flex: 1, height: 1, background: "#e5e7eb" }} />
          </div>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={isBusy}
            style={{
              width: "100%",
              padding: "15px 16px",
              borderRadius: 14,
              border: "1px solid #d1d5db",
              background: isBusy
                ? "#e5e7eb"
                : "linear-gradient(180deg, #ffffff 0%, #f9fafb 100%)",
              color: "#111827",
              fontSize: 16,
              fontWeight: 700,
              cursor: isBusy ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              boxShadow: isBusy ? "none" : "0 10px 24px rgba(15,23,42,0.08)",
              transition: "all 0.18s ease",
            }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: 999,
                background: "#fff",
                border: "1px solid #e5e7eb",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 900,
                flexShrink: 0,
              }}
            >
              G
            </span>
            {isGoogleSigningIn ? "Signing you in..." : "Continue with Google"}
          </button>

          <div
            style={{
              marginTop: 18,
              fontSize: 12,
              color: "#6b7280",
              textAlign: "center",
              lineHeight: 1.6,
            }}
          >
            Need help accessing the portal? Contact a Busy Bees administrator or
            your team lead.
          </div>

          <div
            style={{
              marginTop: 30,
              paddingTop: 18,
              borderTop: "1px solid #e5e7eb",
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              fontSize: 12,
              color: "#6b7280",
            }}
          >
            <span>Busy Bees Senior Care</span>
            <span>Secure staff access</span>
          </div>
        </>
      ) : null}
    </section>
  );
}
