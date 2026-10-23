/** @type {import('jest').Config} */
module.exports = {
  projects: [
    {
      displayName: "native",
      globalSetup: "<rootDir>/jest.global-setup.js",
      preset: "jest-expo/ios",
      resolver: require.resolve("react-native-reanimated/jest/resolver"),
      setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
      testMatch: ["<rootDir>/src/**/*.test.ts", "<rootDir>/src/**/*.test.tsx"],
      testPathIgnorePatterns: ["\\.web\\.test\\."],
      moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
      transformIgnorePatterns: [
        "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|expo-[^/]+|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|react-native-reanimated|react-native-worklets)/)",
      ],
    },
    {
      displayName: "web",
      preset: "jest-expo/web",
      setupFilesAfterEnv: ["<rootDir>/jest.setup.web.ts"],
      testMatch: ["<rootDir>/src/**/*.web.test.ts", "<rootDir>/src/**/*.web.test.tsx"],
      moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
    },
  ],
};
