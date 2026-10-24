import { Redirect, useLocalSearchParams } from "expo-router";
import React from "react";
import { Screen } from "@/components/ui/screen";
import { authApi } from "@/features/auth/api";
import { CodeForm } from "@/features/auth/components/code-form";
import { useSession } from "@/features/auth/session";

export default function LoginCodeScreen() {
  const { email } = useLocalSearchParams<{ email?: string }>();
  const session = useSession();
  if (!email) return <Redirect href="/login" />;
  return (
    <Screen testID="login-code">
      <CodeForm
        email={email}
        verifyCode={authApi.verifyCode}
        requestCode={authApi.requestCode}
        onVerified={(pair) =>
          void session.signIn({ accessToken: pair.accessToken, refreshToken: pair.refreshToken })
        }
      />
    </Screen>
  );
}
