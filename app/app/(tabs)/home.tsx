import React from "react";
import { HomeScreen } from "@/features/home/home-screen";

export { RouteErrorFallback as ErrorBoundary } from "@/components/error-boundary";

export default function HomeRoute() {
  return <HomeScreen />;
}
