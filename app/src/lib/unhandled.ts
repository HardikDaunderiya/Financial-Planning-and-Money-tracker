import { log as defaultLog } from "./log";

type Tracker = {
  allRejections: boolean;
  onUnhandled: (id: number, reason: unknown) => void;
  onHandled: (id: number) => void;
};
type Hermes = { enablePromiseRejectionTracker?: (options: Tracker) => void };
type ErrorUtilsLike = {
  getGlobalHandler(): ((e: Error, isFatal?: boolean) => void) | undefined;
  setGlobalHandler(h: (e: Error, isFatal?: boolean) => void): void;
};

export type GlobalHandlerDeps = {
  log: { error: (event: string, data?: Record<string, unknown>) => void };
  hermes: Hermes | null;
  errorUtils: ErrorUtilsLike | null;
  addEventListener?: ((name: "unhandledrejection", fn: (e: { reason: unknown }) => void) => void) | undefined;
};

function messageOf(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return typeof reason === "string" ? reason : "non-error rejection";
}

function detect(): GlobalHandlerDeps {
  const g = globalThis as {
    HermesInternal?: Hermes;
    ErrorUtils?: ErrorUtilsLike;
    addEventListener?: GlobalHandlerDeps["addEventListener"];
  };
  return {
    log: defaultLog,
    hermes: g.HermesInternal ?? null,
    errorUtils: g.ErrorUtils ?? null,
    addEventListener:
      typeof g.addEventListener === "function" ? g.addEventListener.bind(globalThis) : undefined,
  };
}

/** ERR-18: unhandled rejections and uncaught errors are logged; the app keeps running. Call once at startup. */
export function installGlobalHandlers(deps: GlobalHandlerDeps = detect()): void {
  const onUnhandled = (reason: unknown) =>
    deps.log.error("promise.unhandled", { message: messageOf(reason) });
  if (deps.hermes?.enablePromiseRejectionTracker) {
    deps.hermes.enablePromiseRejectionTracker({
      allRejections: true,
      onUnhandled: (_id, reason) => onUnhandled(reason),
      onHandled: () => undefined,
    });
  } else if (deps.addEventListener) {
    deps.addEventListener("unhandledrejection", (e) => onUnhandled(e.reason));
  }
  if (deps.errorUtils) {
    const previous = deps.errorUtils.getGlobalHandler();
    deps.errorUtils.setGlobalHandler((e, isFatal) => {
      deps.log.error("js.uncaught", { message: e.message, fatal: !!isFatal });
      previous?.(e, isFatal);
    });
  }
}
