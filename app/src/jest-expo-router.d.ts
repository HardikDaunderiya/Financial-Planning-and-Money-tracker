// expo-router's own jest matchers (toHavePathname and friends), which its package does not type-export.
declare namespace jest {
  interface Matchers<R> {
    toHavePathname(pathname: string): R;
  }
}
