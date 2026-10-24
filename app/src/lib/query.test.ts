import AsyncStorage from "@react-native-async-storage/async-storage";
import { closePersistence, openPersistence, persister } from "./query";

const client = { timestamp: 1, buster: "b", clientState: { mutations: [], queries: [] } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  await AsyncStorage.clear();
  openPersistence();
});
afterAll(() => closePersistence());

describe("persister", () => {
  it("removeClient only removes the key: persistence stays open (a discarded restore must not silence the session)", async () => {
    await AsyncStorage.setItem("gullak.query-cache", "x");
    await persister.removeClient();
    expect(await AsyncStorage.getItem("gullak.query-cache")).toBeNull();
    await persister.persistClient(client);
    await sleep(1200);
    expect(await AsyncStorage.getItem("gullak.query-cache")).toContain('"buster":"b"');
  });

  it("closePersistence drops a pending write and blocks later ones until reopened", async () => {
    await persister.persistClient(client);
    closePersistence();
    await sleep(1200);
    expect(await AsyncStorage.getItem("gullak.query-cache")).toBeNull();
    await persister.persistClient(client);
    await sleep(1200);
    expect(await AsyncStorage.getItem("gullak.query-cache")).toBeNull();
    openPersistence();
    await persister.persistClient(client);
    await sleep(1200);
    expect(await AsyncStorage.getItem("gullak.query-cache")).not.toBeNull();
  });
});
