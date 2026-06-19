'use client'

import { createContext, useContext } from 'react'

// The browser's Date.getTimezoneOffset() in minutes (UTC+8 → -480), captured into the
// `tzo` cookie and read server-side (in the root layout) so SSR and the client render
// dates for the SAME calendar day. Defaults to 0 (UTC) until the cookie exists (the
// first ever visit) — and on that first paint server and client BOTH use 0, so even then
// there's no UTC→local flash; the real offset kicks in from the next navigation.
const TzOffsetContext = createContext(0)

export function TzOffsetProvider({ offset, children }: { offset: number; children: React.ReactNode }) {
  return <TzOffsetContext.Provider value={offset}>{children}</TzOffsetContext.Provider>
}

export function useTzOffset(): number {
  return useContext(TzOffsetContext)
}
