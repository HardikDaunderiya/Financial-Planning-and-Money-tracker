import { useRouter } from "expo-router";
import React from "react";
import { Screen } from "@/components/ui/screen";
import { authApi } from "@/features/auth/api";
import { EmailForm } from "@/features/auth/components/email-form";

export default function LoginScreen() {
  const router = useRouter();
  return (
    <Screen testID="login">
      <EmailForm
        requestCode={authApi.requestCode}
        onSent={(email) => router.push({ pathname: "/login-code", params: { email } })}
      />
    </Screen>
  );
}
