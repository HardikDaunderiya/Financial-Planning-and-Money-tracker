import { act, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";
import { Text } from "react-native";
import { SessionProvider, useSession } from "./session";
import type { TokenStore, Tokens } from "@/lib/storage";
import { NetworkError } from "@/lib/api-errors";
import { authEvents } from "@/lib/client";
import { kv } from "@/lib/kv";
import { queryClient } from "@/lib/query";

function store(initial: Tokens | null): TokenStore & { tokens: Tokens | null } {
  const s = {
    tokens: initial,
    load: () => Promise.resolve(s.tokens),
    save: (t: Tokens) => {
      s.tokens = t;
      return Promise.resolve();
    },
    clear: () => {
      s.tokens = null;
      return Promise.resolve();
    },
  };
  return s;
}

function Probe({ onReady }: { onReady?: (s: ReturnType<typeof useSession>) => void }) {
  const session = useSession();
  onReady?.(session);
  return <Text testID="status">{session.status}</Text>;
}

describe("session", () => {
  it("hydrates to signedIn when a pair is stored, and reports loading until then", async () => {
    let release: (t: Tokens | null) => void = () => undefined;
    const slow: TokenStore = {
      load: () => new Promise<Tokens | null>((resolve) => (release = resolve)),
      save: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    };
    await render(
      <SessionProvider store={slow} logout={() => Promise.resolve()}>
        <Probe />
      </SessionProvider>,
    );
    expect(screen.getByTestId("status")).toHaveTextContent("loading");
    await act(() => Promise.resolve(release({ accessToken: "A", refreshToken: "R" })));
    expect(screen.getByTestId("status")).toHaveTextContent("signedIn");
  });

  it("hydrates to signedOut with nothing stored", async () => {
    await render(
      <SessionProvider store={store(null)} logout={() => Promise.resolve()}>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signedOut"));
  });

  it("signIn stores the pair; signOut revokes it on the server and clears it even when the server is unreachable", async () => {
    const s = store(null);
    const logout = jest.fn(() => Promise.reject(new NetworkError("offline")));
    let session: ReturnType<typeof useSession> | undefined;
    await render(
      <SessionProvider store={s} logout={logout}>
        <Probe onReady={(x) => (session = x)} />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signedOut"));
    await act(() => session?.signIn({ accessToken: "A", refreshToken: "R" }) ?? Promise.resolve());
    expect(s.tokens).toEqual({ accessToken: "A", refreshToken: "R" });
    expect(screen.getByTestId("status")).toHaveTextContent("signedIn");
    await act(() => session?.signOut() ?? Promise.resolve());
    expect(logout).toHaveBeenCalledWith("R");
    expect(s.tokens).toBeNull();
    expect(screen.getByTestId("status")).toHaveTextContent("signedOut");
  });

  it("a rejected refresh moves the session to signedOut and clears the query cache", async () => {
    queryClient.setQueryData(["budget"], { budgetPaise: 1 });
    await render(
      <SessionProvider
        store={store({ accessToken: "A", refreshToken: "R" })}
        logout={() => Promise.resolve()}
      >
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signedIn"));
    await act(() => Promise.resolve(authEvents.emitSignedOut()));
    expect(screen.getByTestId("status")).toHaveTextContent("signedOut");
    expect(queryClient.getQueryData(["budget"])).toBeUndefined();
  });

  it("sign-out and a forced sign-out both clear the setup draft", async () => {
    const remove = jest.spyOn(kv, "remove").mockResolvedValue(undefined);
    let session: ReturnType<typeof useSession> | undefined;
    await render(
      <SessionProvider
        store={store({ accessToken: "A", refreshToken: "R" })}
        logout={() => Promise.resolve()}
      >
        <Probe onReady={(x) => (session = x)} />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signedIn"));
    await act(() => session?.signOut() ?? Promise.resolve());
    expect(remove).toHaveBeenCalledWith("setup-draft");
    remove.mockClear();
    await act(() => Promise.resolve(authEvents.emitSignedOut()));
    expect(remove).toHaveBeenCalledWith("setup-draft");
    remove.mockRestore();
  });

  it("signOut wipes the persisted query cache so the next person sees nothing", async () => {
    const s = store({ accessToken: "A", refreshToken: "R" });
    const removeClient = jest.fn(() => Promise.resolve());
    let session: ReturnType<typeof useSession> | undefined;
    await render(
      <SessionProvider store={s} logout={() => Promise.resolve()} wipeCache={removeClient}>
        <Probe onReady={(x) => (session = x)} />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signedIn"));
    await act(() => session?.signOut() ?? Promise.resolve());
    expect(removeClient).toHaveBeenCalledTimes(1);
  });

  it("a forced sign-out also wipes the persisted cache and the stored email", async () => {
    const removeClient = jest.fn(() => Promise.resolve());
    const remove = jest.spyOn(kv, "remove").mockResolvedValue(undefined);
    await render(
      <SessionProvider
        store={store({ accessToken: "A", refreshToken: "R" })}
        logout={() => Promise.resolve()}
        wipeCache={removeClient}
      >
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signedIn"));
    await act(() => Promise.resolve(authEvents.emitSignedOut()));
    await waitFor(() => expect(removeClient).toHaveBeenCalledTimes(1));
    expect(remove).toHaveBeenCalledWith("me.email");
    remove.mockRestore();
  });

  it("signIn keeps the email, it is restored on the next start, and sign-out forgets it", async () => {
    const mem = new Map<string, string>();
    const get = jest.spyOn(kv, "get").mockImplementation((k) => Promise.resolve(mem.get(k) ?? null));
    const set = jest.spyOn(kv, "set").mockImplementation((k, v) => {
      mem.set(k, v);
      return Promise.resolve();
    });
    const remove = jest.spyOn(kv, "remove").mockImplementation((k) => {
      mem.delete(k);
      return Promise.resolve();
    });
    const Email = () => <Text testID="email">{useSession().email ?? "none"}</Text>;
    let session: ReturnType<typeof useSession> | undefined;
    const s = store(null);
    const wipe = () => Promise.resolve();
    const first = await render(
      <SessionProvider store={s} logout={() => Promise.resolve()} wipeCache={wipe}>
        <Probe onReady={(x) => (session = x)} />
        <Email />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signedOut"));
    await act(
      () =>
        session?.signIn({ accessToken: "A", refreshToken: "R" }, "priya@example.com") ?? Promise.resolve(),
    );
    expect(screen.getByTestId("email")).toHaveTextContent("priya@example.com");
    expect(mem.get("me.email")).toBe("priya@example.com");
    await first.unmount();
    await render(
      <SessionProvider store={s} logout={() => Promise.resolve()} wipeCache={wipe}>
        <Probe onReady={(x) => (session = x)} />
        <Email />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("email")).toHaveTextContent("priya@example.com"));
    await act(() => session?.signOut() ?? Promise.resolve());
    expect(screen.getByTestId("email")).toHaveTextContent("none");
    expect(mem.has("me.email")).toBe(false);
    get.mockRestore();
    set.mockRestore();
    remove.mockRestore();
  });

  it("signOut resolves only after the persisted wipe and every per-user kv removal finished", async () => {
    let release: () => void = () => undefined;
    const wipe = jest.fn(() => new Promise<void>((r) => (release = r)));
    const removed: string[] = [];
    const remove = jest.spyOn(kv, "remove").mockImplementation((k) => {
      removed.push(k);
      return Promise.resolve();
    });
    let session: ReturnType<typeof useSession> | undefined;
    await render(
      <SessionProvider
        store={store({ accessToken: "A", refreshToken: "R" })}
        logout={() => Promise.resolve()}
        wipeCache={wipe}
      >
        <Probe onReady={(x) => (session = x)} />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signedIn"));
    let done = false;
    await act(async () => {
      void session?.signOut().then(() => (done = true));
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(wipe).toHaveBeenCalledTimes(1);
    expect(done).toBe(false);
    await act(async () => {
      release();
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(done).toBe(true);
    expect(removed).toEqual(
      expect.arrayContaining(["setup-draft", "me.email", "first-spend-logged", "notifications-asked"]),
    );
    remove.mockRestore();
  });

  it("a failing wipe still completes sign-out and logs only a reason", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    let session: ReturnType<typeof useSession> | undefined;
    await render(
      <SessionProvider
        store={store({ accessToken: "A", refreshToken: "R" })}
        logout={() => Promise.resolve()}
        wipeCache={() => Promise.reject(new Error("disk full secret@x.com"))}
      >
        <Probe onReady={(x) => (session = x)} />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("signedIn"));
    await act(() => session?.signOut() ?? Promise.resolve());
    expect(screen.getByTestId("status")).toHaveTextContent("signedOut");
    expect(JSON.stringify(warn.mock.calls)).toContain("session.wipe_failed");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret@x.com");
    warn.mockRestore();
  });
});
