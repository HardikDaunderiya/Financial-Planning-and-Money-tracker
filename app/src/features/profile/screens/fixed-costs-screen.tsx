import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, ScrollView, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ErrorState } from "@/components/ui/error-state";
import { Screen } from "@/components/ui/screen";
import { Skeleton } from "@/components/ui/skeleton";
import { StepHeader } from "@/components/ui/step-header";
import { Text } from "@/components/ui/text";
import { describeError } from "@/lib/api-errors";
import { messageFor } from "@/lib/errors";
import { formatRupees } from "@/lib/money";
import { colors, rowHeight, spacing } from "@/theme";
import type { FixedCost } from "../api";
import { FixedCostForm, FixedCostRow, presets } from "../components/fixed-cost-list";
import { UndoBar } from "../components/undo-bar";
import { useAddFixedCost, useFixedCosts, usePatchFixedCost, useRemoveFixedCost } from "../hooks";

export function FixedCostsScreen({ onContinue, onBack }: { onContinue: () => void; onBack: () => void }) {
  const costs = useFixedCosts();
  const add = useAddFixedCost();
  const patch = usePatchFixedCost();
  const remove = useRemoveFixedCost();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<FixedCost | null>(null);
  const [pending, setPending] = useState<FixedCost | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [continuing, setContinuing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const pendingRef = useRef<FixedCost | null>(null);
  const addingRef = useRef(false);
  const removeRef = useRef(remove.mutateAsync);
  useEffect(() => {
    removeRef.current = remove.mutateAsync;
  });

  const list = (costs.data ?? []).filter((c) => c.id !== pending?.id && !hidden.includes(c.id));
  const total = list.reduce((s, c) => s + c.amountPaise, 0);
  const unused = presets.filter((p) => !list.some((c) => c.name === p.name));
  const busy = add.isPending || patch.isPending || remove.isPending || hidden.length > 0 || continuing;

  /** Sends the pending removal now. Resolves true when nothing is left to lose. */
  const commitPending = useCallback(async (): Promise<boolean> => {
    const cost = pendingRef.current;
    if (!cost) return true;
    pendingRef.current = null;
    setPending(null);
    setHidden((h) => [...h, cost.id]);
    try {
      await removeRef.current(cost.id);
      return true;
    } catch (e) {
      setRemoveError(describeError(e, messageFor));
      return false;
    } finally {
      setHidden((h) => h.filter((x) => x !== cost.id));
    }
  }, []);

  const commitRef = useRef(commitPending);
  useEffect(() => {
    commitRef.current = commitPending;
  });

  // Back, navigation away, or the app going to the background must never lose a removal.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") void commitRef.current();
    });
    return () => {
      sub.remove();
      void commitRef.current();
    };
  }, []);

  function startRemove(cost: FixedCost) {
    setRemoveError(null);
    void commitPending();
    pendingRef.current = cost;
    setPending(cost);
  }

  async function handleContinue() {
    if (continuing) return;
    setContinuing(true);
    const ok = await commitPending();
    setContinuing(false);
    if (ok) onContinue();
  }

  function addCost(v: { name: string; amountPaise: number }) {
    if (addingRef.current) return;
    addingRef.current = true;
    setFormError(null);
    add.mutate(v, {
      onSuccess: () => {
        setAdding(false);
        setFormError(null);
      },
      onError: (e) => setFormError(describeError(e, messageFor)),
      onSettled: () => {
        addingRef.current = false;
      },
    });
  }

  function savePatch(id: string, body: { name: string; amountPaise: number }) {
    setFormError(null);
    patch.mutate(
      { id, body },
      {
        onSuccess: () => {
          setEditing(null);
          setFormError(null);
        },
        onError: (e) => setFormError(describeError(e, messageFor)),
      },
    );
  }

  return (
    <Screen
      testID="setup-fixed-costs"
      footer={<Button title="Continue" onPress={() => void handleContinue()} disabled={busy} />}
    >
      <StepHeader step={2} total={4} name="Fixed costs" onBack={onBack} />
      <Text variant="heading">Fixed costs</Text>
      <Text variant="bodyMuted">
        Bills that come every month. They never count against your daily budget.
      </Text>
      {removeError ? (
        <Text variant="label" color={colors.bad} accessibilityRole="alert">
          {removeError}
        </Text>
      ) : null}
      {costs.isLoading ? (
        <View style={{ gap: spacing.sm }}>
          <Skeleton height={rowHeight} />
          <Skeleton height={rowHeight} />
        </View>
      ) : costs.error && !costs.data ? (
        <ErrorState body={describeError(costs.error, messageFor)} onRetry={() => void costs.refetch()} />
      ) : (
        <View>
          {list.map((c) =>
            editing?.id === c.id ? (
              <FixedCostForm
                key={c.id}
                initial={c}
                submitLabel="Save"
                busy={patch.isPending}
                error={formError ?? undefined}
                onCancel={() => {
                  setFormError(null);
                  setEditing(null);
                }}
                onSubmit={(v) => savePatch(c.id, v)}
              />
            ) : (
              <FixedCostRow
                key={c.id}
                cost={c}
                onEdit={() => {
                  setFormError(null);
                  setEditing(c);
                }}
                onRemove={() => startRemove(c)}
              />
            ),
          )}
          {pending ? (
            <UndoBar
              key={pending.id}
              message={`${pending.name} removed`}
              onUndo={() => {
                pendingRef.current = null;
                setPending(null);
              }}
              onExpire={() => void commitPending()}
            />
          ) : null}
          <View
            style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: spacing.cm }}
          >
            <Text variant="bodyStrong">Total</Text>
            <Text variant="bodyStrong" testID="fixed-total" style={{ fontVariant: ["tabular-nums"] }}>
              {formatRupees(total)}
            </Text>
          </View>
        </View>
      )}
      {formError && !adding && !editing ? (
        <Text variant="label" color={colors.bad} accessibilityRole="alert">
          {formError}
        </Text>
      ) : null}
      {adding ? (
        <FixedCostForm
          submitLabel="Add"
          busy={add.isPending}
          error={formError ?? undefined}
          onCancel={() => {
            setFormError(null);
            setAdding(false);
          }}
          onSubmit={addCost}
        />
      ) : (
        <View style={{ gap: spacing.sm }}>
          {unused.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: spacing.sm }}
            >
              {unused.map((p) => (
                <Chip
                  key={p.name}
                  label={`Add ${p.name}, ${formatRupees(p.amountPaise)}`}
                  disabled={add.isPending}
                  onPress={() => addCost(p)}
                />
              ))}
            </ScrollView>
          ) : null}
          <Button
            title="Add another"
            variant="secondary"
            onPress={() => {
              setFormError(null);
              setAdding(true);
            }}
          />
        </View>
      )}
      <Text variant="caption">SIPs and RDs go in the next step, as savings</Text>
    </Screen>
  );
}
