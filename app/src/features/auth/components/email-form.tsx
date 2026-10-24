import React, { useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Text } from "@/components/ui/text";
import { describeError } from "@/lib/api-errors";
import { messageFor } from "@/lib/errors";
import { spacing } from "@/theme";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function EmailForm({
  requestCode,
  onSent,
}: {
  requestCode: (email: string) => Promise<void>;
  onSent: (email: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function send() {
    const clean = normaliseEmail(email);
    if (!EMAIL.test(clean)) {
      setError("Enter a valid email address");
      return;
    }
    setError(null);
    setSending(true);
    try {
      await requestCode(clean);
      onSent(clean);
    } catch (e) {
      setError(describeError(e, messageFor));
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={{ gap: spacing.md }}>
      <Text variant="heading">Sign in</Text>
      <Text variant="bodyMuted">We send a 6-digit code to your email. No password to remember.</Text>
      <Field
        label="Email"
        value={email}
        onChangeText={(t) => {
          setEmail(t);
          if (error) setError(null);
        }}
        {...(error ? { error } : {})}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="send"
        onSubmitEditing={() => void send()}
      />
      <Button title="Send code" onPress={() => void send()} loading={sending} />
    </View>
  );
}
