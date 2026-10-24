import React, { useEffect, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { describeError, isApiError } from "@/lib/api-errors";
import { messageFor } from "@/lib/errors";
import { colors, fonts, radius, spacing } from "@/theme";
import type { TokenPair } from "../api";
import { isValidEmail } from "../email";

type Props = {
  email: string;
  verifyCode: (email: string, code: string) => Promise<TokenPair>;
  requestCode: (email: string) => Promise<void>;
  onVerified: (pair: TokenPair) => void;
};

export function CodeForm({ email, verifyCode, requestCode, onVerified }: Props) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const mounted = useRef(true);
  const verifyingRef = useRef(false);
  const resendingRef = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Verifies exactly once per complete code. After success the form stays busy while the app moves on. */
  async function submit(complete: string) {
    if (verifyingRef.current) return;
    if (!isValidEmail(email)) {
      setCode("");
      setError("Something went wrong. Try again in a moment.");
      return;
    }
    verifyingRef.current = true;
    setVerifying(true);
    try {
      const pair = await verifyCode(email, complete);
      if (mounted.current) onVerified(pair);
    } catch (e) {
      verifyingRef.current = false;
      if (!mounted.current) return;
      setVerifying(false);
      setCode("");
      setLocked(isApiError(e, "OTP_LOCKED") || isApiError(e, "OTP_EXPIRED"));
      setError(describeError(e, messageFor));
    }
  }

  async function resend() {
    if (resendingRef.current || verifyingRef.current) return;
    resendingRef.current = true;
    setResending(true);
    setError(null);
    try {
      await requestCode(email);
      if (!mounted.current) return;
      setLocked(false);
      setResent(true);
      if (!verifyingRef.current) setCode("");
    } catch (e) {
      if (mounted.current) setError(describeError(e, messageFor));
    } finally {
      resendingRef.current = false;
      if (mounted.current) setResending(false);
    }
  }

  function onChange(raw: string) {
    setError(null);
    const digits = raw.normalize("NFKC").replace(/\D/g, "");
    if (digits.length > 6) {
      setCode("");
      setError("Enter the 6-digit code");
      return;
    }
    setCode(digits);
    if (digits.length === 6) void submit(digits);
  }

  return (
    <View style={{ gap: spacing.md }}>
      <Text variant="heading">Enter the code</Text>
      <Text variant="bodyMuted">{`Sent to ${email}. It works for 10 minutes.`}</Text>
      <Pressable onPress={() => input.current?.focus()} accessibilityRole="none">
        <View style={{ flexDirection: "row", gap: spacing.sm, justifyContent: "space-between" }}>
          {Array.from({ length: 6 }, (_, i) => (
            <View
              key={i}
              testID={`code-box-${i}`}
              style={{
                flex: 1,
                height: 56,
                borderRadius: radius.md,
                borderCurve: "continuous",
                borderWidth: code.length === i ? 2 : 1,
                borderColor: error ? colors.bad : code.length === i ? colors.ink : colors.control,
                backgroundColor: colors.surface,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontFamily: fonts.head700, fontSize: 28 }}>{code[i] ?? ""}</Text>
            </View>
          ))}
        </View>
      </Pressable>
      <TextInput
        ref={input}
        accessibilityLabel="6-digit code"
        value={code}
        onChangeText={onChange}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        autoFocus
        editable={!verifying && !locked}
        style={{ position: "absolute", opacity: 0, height: 1, width: 1 }}
      />
      {error ? (
        <Text variant="label" color={colors.bad} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {resent ? <Text variant="caption">A new code is on its way</Text> : null}
      <Button
        title={locked ? "Send a new code" : "Resend code"}
        variant="secondary"
        onPress={() => void resend()}
        loading={resending}
        disabled={verifying}
      />
    </View>
  );
}
