import React, { createContext, use, useCallback, useEffect, useMemo, useState } from "react";
import { kv, kvKeys } from "@/lib/kv";
import { MAX_AMOUNT_PAISE } from "@/lib/money";
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
const KEY = kvKeys.setupDraft;
const personalities: readonly Personality[] = ["CHILL", "SAVAGE", "MOM", "HYPE"];

const isPaise = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_AMOUNT_PAISE;
const isTime = (v: unknown): v is string => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

function validPayday(v: unknown): SetupDraft["payday"] | undefined {
  if (v === null) return null;
  if (typeof v !== "object") return undefined;
  const p = v as { rule?: unknown; day?: unknown };
  if (p.rule === "LAST_WORKING_DAY") return { rule: "LAST_WORKING_DAY" };
  if (p.rule !== "FIXED_DAY") return undefined;
  if (p.day === null) return { rule: "FIXED_DAY", day: null };
  if (typeof p.day === "number" && Number.isInteger(p.day) && p.day >= 1 && p.day <= 28) {
    return { rule: "FIXED_DAY", day: p.day };
  }
  return undefined;
}

/** A stored draft is untrusted input: keep each field that is valid and drop the rest. */
function sanitise(raw: unknown): Partial<SetupDraft> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<SetupDraft> = {};
  if (isPaise(r.incomePaise)) out.incomePaise = r.incomePaise;
  const payday = validPayday(r.payday);
  if (payday !== undefined) out.payday = payday;
  if (isPaise(r.savingsPaise)) out.savingsPaise = r.savingsPaise;
  if (r.moneyLeftPaise === null || isPaise(r.moneyLeftPaise)) out.moneyLeftPaise = r.moneyLeftPaise;
  if (personalities.includes(r.personality as Personality)) out.personality = r.personality as Personality;
  if (isTime(r.morningTime)) out.morningTime = r.morningTime;
  if (isTime(r.nightTime)) out.nightTime = r.nightTime;
  return out;
}

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
          setDraft({ ...emptyDraft, ...sanitise(JSON.parse(raw)) });
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

  // Persist after hydration only; the empty draft is never written (reset removes the key instead).
  useEffect(() => {
    if (persist && hydrated && draft !== emptyDraft) void kv.set(KEY, JSON.stringify(draft));
  }, [persist, hydrated, draft]);

  const set = useCallback((patch: Partial<SetupDraft>) => setDraft((d) => ({ ...d, ...patch })), []);

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
