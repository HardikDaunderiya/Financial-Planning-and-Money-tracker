import React, { useRef, useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Text } from "@/components/ui/text";
import { describeError } from "@/lib/api-errors";
import { messageFor } from "@/lib/errors";
import { spacing } from "@/theme";
import { EMAIL_MAX, isValidEmail, normaliseEmail } from "../email";

export { normaliseEmail };

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
  const sendingRef = useRef(false);

  async function send() {
    const clean = normaliseEmail(email);
    if (sendingRef.current) return;
    if (!isValidEmail(clean)) {
      setError("Enter a valid email address");
      return;
    }
    setError(null);
    sendingRef.current = true;
    setSending(true);
    try {
      await requestCode(clean);
      onSent(clean);
    } catch (e) {
      setError(describeError(e, messageFor));
    } finally {
      sendingRef.current = false;
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
        maxLength={EMAIL_MAX}
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
