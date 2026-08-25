/**
 * Thin wrapper over chrome.* so a future Firefox build only touches this file
 * (spec §12.2). MV3 chrome APIs are already promise-based.
 */
declare const browser: typeof chrome | undefined;

export const ext: typeof chrome =
  typeof browser !== 'undefined'
    ? (browser as typeof chrome)
    : typeof chrome !== 'undefined'
      ? chrome
      : (undefined as unknown as typeof chrome);
