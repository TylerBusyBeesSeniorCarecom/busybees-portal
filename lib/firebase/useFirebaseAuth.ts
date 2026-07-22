"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { onAuthStateChanged, signInWithCustomToken, type User } from "firebase/auth";

import { firebaseAuth } from "@/lib/firebase/client";

type FirebaseAuthState = {
  user: User | null;
  loading: boolean;
  error: string | null;
};

export function useFirebaseAuth(): FirebaseAuthState {
  const { data: session, status } = useSession();
  const [user, setUser] = useState<User | null>(firebaseAuth.currentUser);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      firebaseAuth,
      (nextUser) => {
        setUser(nextUser);
        if (status !== "loading") {
          setLoading(false);
        }
      },
      (authError) => {
        setError(authError instanceof Error ? authError.message : "Failed to subscribe to Firebase auth");
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [status]);

  useEffect(() => {
    let cancelled = false;

    async function ensureFirebaseAuth() {
      if (status === "loading") {
        setLoading(true);
        return;
      }

      if (status === "unauthenticated") {
        setUser(null);
        setLoading(false);
        return;
      }

      if (!session?.user || firebaseAuth.currentUser) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const response = await fetch("/api/firebase/mint-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });

        const payload = await response.json().catch(() => ({}));

        if (!response.ok || typeof payload?.token !== "string") {
          throw new Error(
            typeof payload?.error === "string" ? payload.error : "Failed to mint Firebase token"
          );
        }

        await signInWithCustomToken(firebaseAuth, payload.token);

        if (!cancelled) {
          setError(null);
        }
      } catch (mintError) {
        if (!cancelled) {
          setError(mintError instanceof Error ? mintError.message : "Failed to sign in to Firebase");
          setLoading(false);
        }
      }
    }

    void ensureFirebaseAuth();

    return () => {
      cancelled = true;
    };
  }, [session?.user, status]);

  return { user, loading, error };
}
