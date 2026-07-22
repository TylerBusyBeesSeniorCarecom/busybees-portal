"use client";

import { useEffect, useState } from "react";

import { subscribeConversations, subscribeThread } from "@/lib/messages/firestoreClient";
import type { HiveConversation, HiveMessage } from "@/lib/messages/types";
import { useFirebaseAuth } from "@/lib/firebase/useFirebaseAuth";

type HookState<T> = {
  data: T;
  loading: boolean;
  error: string | null;
};

export function useConversations(): {
  conversations: HiveConversation[];
  loading: boolean;
  error: string | null;
} {
  const { user, loading: authLoading, error: authError } = useFirebaseAuth();
  const [state, setState] = useState<HookState<HiveConversation[]>>({
    data: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (authLoading) {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      return;
    }

    if (authError) {
      setState({ data: [], loading: false, error: authError });
      return;
    }

    if (!user) {
      setState({ data: [], loading: false, error: null });
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    const unsubscribe = subscribeConversations(user.uid, (conversations) => {
      setState({ data: conversations, loading: false, error: null });
    });

    return unsubscribe;
  }, [authError, authLoading, user]);

  return {
    conversations: state.data,
    loading: state.loading,
    error: state.error,
  };
}

export function useThread(conversationID: string | null): {
  messages: HiveMessage[];
  loading: boolean;
  error: string | null;
} {
  const { user, loading: authLoading, error: authError } = useFirebaseAuth();
  const [state, setState] = useState<HookState<HiveMessage[]>>({
    data: [],
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (authLoading) {
      setState((prev) => ({ ...prev, loading: Boolean(conversationID), error: null }));
      return;
    }

    if (authError) {
      setState({ data: [], loading: false, error: authError });
      return;
    }

    if (!user || !conversationID) {
      setState({ data: [], loading: false, error: null });
      return;
    }

    setState({ data: [], loading: true, error: null });

    const unsubscribe = subscribeThread(conversationID, (messages) => {
      setState({ data: messages, loading: false, error: null });
    });

    return () => {
      unsubscribe();
      setState({ data: [], loading: false, error: null });
    };
  }, [authError, authLoading, conversationID, user]);

  return {
    messages: state.data,
    loading: state.loading,
    error: state.error,
  };
}
