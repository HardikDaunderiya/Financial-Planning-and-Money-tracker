import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Gullak",
  slug: "gullak",
  version: "0.1.0",
  orientation: "portrait",
  scheme: "gullak",
  userInterfaceStyle: "light",
  icon: "./assets/images/icon.png",
  ios: {
    bundleIdentifier: "in.gullak.app",
    supportsTablet: false,
    infoPlist: { CADisableMinimumFrameDurationOnPhone: true },
  },
  android: {
    package: "in.gullak.app",
    adaptiveIcon: {
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundColor: "#FBF6EF",
    },
  },
  web: { bundler: "metro", output: "single", favicon: "./assets/images/favicon.png" },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-notifications",
    "expo-font",
    [
      "expo-splash-screen",
      { image: "./assets/images/splash-icon.png", backgroundColor: "#FBF6EF", imageWidth: 200 },
    ],
  ],
  experiments: { typedRoutes: true },
};

export default config;
