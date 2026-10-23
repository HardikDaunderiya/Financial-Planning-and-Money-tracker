/* The only module allowed to call console. Task 3 replaces this with the real logger. */
export const log = {
  debug(message: string, data?: Record<string, unknown>): void {
    console.debug(message, data);
  },
};
