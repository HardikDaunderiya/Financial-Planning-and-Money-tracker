import React, { createContext, use, useCallback, useEffect, useMemo, useState } from "react";
import { kv } from "@/lib/kv";
import type { PaydayRule } from "@/lib/cycle";
import type { Personality } from "./api";

export type SetupDraft = {
  incomePaise: number;
  /** null until a payday option is picked; "Another date" without a day is `{ rule: "FIXED_DAY", day: null }`. */
  payday: PaydayRule | { rule: "FIXED_DAY"; day: null } | null;
  savingsPaise: number;
  /** null until the user edits the pre-filled money-left figure. */
  moneyLeftPaise: number | null;
  personality: Personality;
  morningTime: string;
  nightTime: string;
};

export const emptyDraft: SetupDraft = {
  incomePaise: 0,
  payday: null,
  savingsPaise: 0,
  moneyLeftPaise: null,
  personality: "CHILL",
  morningTime: "08:00",
  nightTime: "22:00",
};

type Setup = {
  draft: SetupDraft;
  set: (patch: Partial<SetupDraft>) => void;
  reset: () => void;
  hydrated: boolean;
};

const SetupContext = createContext<Setup | null>(null);
const KEY = "setup-draft";

/** The answers given during setup, kept across the five steps and across an app restart. */
export function SetupProvider({
  children,
  persist = true,
}: {
  children: React.ReactNode;
  persist?: boolean;
}) {
  const [draft, setDraft] = useState<SetupDraft>(emptyDraft);
  const [hydrated, setHydrated] = useState(!persist);

  useEffect(() => {
    if (!persist) return;
    let alive = true;
    void kv.get(KEY).then((raw) => {
      if (!alive) return;
      if (raw) {
        try {
          setDraft({ ...emptyDraft, ...(JSON.parse(raw) as Partial<SetupDraft>) });
        } catch {
          void kv.remove(KEY);
        }
      }
      setHydrated(true);
    });
    return () => {
      alive = false;
    };
  }, [persist]);

  const set = useCallback(
    (patch: Partial<SetupDraft>) =>
      setDraft((d) => {
        const next = { ...d, ...patch };
        if (persist) void kv.set(KEY, JSON.stringify(next));
        return next;
      }),
    [persist],
  );

  const reset = useCallback(() => {
    setDraft(emptyDraft);
    if (persist) void kv.remove(KEY);
  }, [persist]);

  const value = useMemo(() => ({ draft, set, reset, hydrated }), [draft, set, reset, hydrated]);
  return <SetupContext value={value}>{children}</SetupContext>;
}

export function useSetup(): Setup {
  const s = use(SetupContext);
  if (!s) throw new Error("useSetup needs a SetupProvider");
  return s;
}

export function paydayIsComplete(p: SetupDraft["payday"]): p is PaydayRule {
  return p !== null && (p.rule === "LAST_WORKING_DAY" || p.day !== null);
}
