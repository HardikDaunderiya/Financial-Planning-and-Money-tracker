import React, { useCallback, useState } from "react";
import { ScrollView, View } from "react-native";
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
import { colors, spacing } from "@/theme";
import type { FixedCost } from "../api";
import { FixedCostForm, FixedCostRow, presets } from "../components/fixed-cost-list";
import { UndoBar } from "../components/undo-bar";
import { useAddFixedCost, useFixedCosts, usePatchFixedCost, useRemoveFixedCost } from "../hooks";

type Pending = { cost: FixedCost };

export function FixedCostsScreen({ onContinue, onBack }: { onContinue: () => void; onBack: () => void }) {
  const costs = useFixedCosts();
  const add = useAddFixedCost();
  const patch = usePatchFixedCost();
  const remove = useRemoveFixedCost();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<FixedCost | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);

  const list = (costs.data ?? []).filter((c) => c.id !== pending?.cost.id);
  const total = list.reduce((s, c) => s + c.amountPaise, 0);
  const unused = presets.filter((p) => !list.some((c) => c.name === p.name));

  const commitRemove = useCallback(() => {
    if (!pending) return;
    const { cost } = pending;
    setPending(null);
    remove.mutate(cost.id, { onError: (e) => setError(describeError(e, messageFor)) });
  }, [pending, remove]);

  function addCost(v: { name: string; amountPaise: number }) {
    setError(null);
    add.mutate(v, {
      onSuccess: () => setAdding(false),
      onError: (e) => setError(describeError(e, messageFor)),
    });
  }

  return (
    <Screen testID="setup-fixed-costs" footer={<Button title="Continue" onPress={onContinue} />}>
      <StepHeader step={2} total={4} name="Fixed costs" onBack={onBack} />
      <Text variant="heading">Fixed costs</Text>
      <Text variant="bodyMuted">
        Bills that come every month. They never count against your daily budget.
      </Text>
      {costs.isLoading ? (
        <View style={{ gap: spacing.sm }}>
          <Skeleton height={52} />
          <Skeleton height={52} />
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
                error={error ?? undefined}
                onCancel={() => setEditing(null)}
                onSubmit={(v) =>
                  patch.mutate(
                    { id: c.id, body: v },
                    {
                      onSuccess: () => setEditing(null),
                      onError: (e) => setError(describeError(e, messageFor)),
                    },
                  )
                }
              />
            ) : (
              <FixedCostRow
                key={c.id}
                cost={c}
                onEdit={() => setEditing(c)}
                onRemove={() => setPending({ cost: c })}
              />
            ),
          )}
          {pending ? (
            <UndoBar
              message={`${pending.cost.name} removed`}
              onUndo={() => setPending(null)}
              onExpire={commitRemove}
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
      {error && !adding && !editing ? (
        <Text variant="label" color={colors.bad} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {adding ? (
        <FixedCostForm
          submitLabel="Add"
          busy={add.isPending}
          error={error ?? undefined}
          onCancel={() => setAdding(false)}
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
                  onPress={() => addCost(p)}
                />
              ))}
            </ScrollView>
          ) : null}
          <Button title="Add another" variant="secondary" onPress={() => setAdding(true)} />
        </View>
      )}
      <Text variant="caption">SIPs and RDs go in the next step, as savings</Text>
    </Screen>
  );
}
