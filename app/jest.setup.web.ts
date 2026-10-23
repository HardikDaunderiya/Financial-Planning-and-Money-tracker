// Web project setup: logic tests only (*.web.test.*), so no Reanimated or RNTL matchers here.
jest.mock("expo-crypto", () => ({ randomUUID: () => "00000000-0000-4000-8000-000000000000" }));

process.env.EXPO_PUBLIC_API_URL = "http://test.local/api/v1";
