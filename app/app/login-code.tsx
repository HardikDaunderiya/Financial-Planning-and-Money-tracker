import { Redirect, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { authApi } from "@/features/auth/api";
import { CodeForm } from "@/features/auth/components/code-form";
import { isValidEmail, normaliseEmail } from "@/features/auth/email";
import { useSession } from "@/features/auth/session";
import { colors } from "@/theme";

export default function LoginCodeScreen() {
  const { email } = useLocalSearchParams<{ email?: string | string[] }>();
  const session = useSession();
  const [error, setError] = useState<string | null>(null);
  // One string, at most 254 characters, shaped like an email once normalised; anything else goes back to the form.
  if (typeof email !== "string" || email !== normaliseEmail(email) || !isValidEmail(email)) {
    return <Redirect href="/login" />;
  }
  return (
    <Screen testID="login-code">
      <CodeForm
        email={email}
        verifyCode={authApi.verifyCode}
        requestCode={authApi.requestCode}
        onVerified={(pair) => {
          session
            .signIn({ accessToken: pair.accessToken, refreshToken: pair.refreshToken }, email)
            .catch(() => setError("Something went wrong. Try again in a moment."));
        }}
      />
      {error ? (
        <Text variant="label" color={colors.bad} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </Screen>
  );
}
