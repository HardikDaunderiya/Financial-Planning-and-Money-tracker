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
});
