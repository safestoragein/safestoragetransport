"use client";

// The active country tab (AppShell writes, every view reads). A module-level store rather than
// React context because the views RENDER AppShell themselves (shell-inside-component), so a
// provider in AppShell could never reach them.
import { useSyncExternalStore } from "react";
import { Country } from "./country";

let current: Country = "india";
const subs = new Set<() => void>();

export function setActiveCountry(c: Country) {
  current = c;
  subs.forEach((f) => f());
}

export function useCountry(): Country {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => subs.delete(cb); },
    () => current,
    () => "india", // SSR snapshot
  );
}
