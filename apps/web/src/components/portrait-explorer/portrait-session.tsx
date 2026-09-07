import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react";
import { clearExplorerMemory, createExplorerMemory, type ExplorerMemory } from "./use-explorer-navigation.js";
import type { PortraitMeshAsset } from "./types.js";

export interface VerifiedPortraitArtifact {
  image: Blob;
  mesh: Blob;
  asset: PortraitMeshAsset;
}

interface PortraitSession {
  sourceIdentity: string;
  verified: { identity: string; artifacts: VerifiedPortraitArtifact[] } | null;
  memory: ExplorerMemory;
}
interface SessionStore { current: PortraitSession | null; }
const PortraitSessionContext = createContext<SessionStore | null>(null);

/** One in-memory portrait per signed-in chart. The app unmounts this boundary
 * on sign-out, account access loss or chart replacement. Never persist blobs. */
export function PortraitSessionProvider({ children }: { children: ReactNode }) {
  const store = useRef<SessionStore>({ current: null });
  return <PortraitSessionContext value={store.current}>{children}</PortraitSessionContext>;
}

export function usePortraitSession(sourceIdentity: string): PortraitSession {
  const local = useRef<SessionStore>({ current: null });
  const store = useContext(PortraitSessionContext) ?? local.current;
  return useMemo(() => {
    if (store.current?.sourceIdentity !== sourceIdentity) {
      store.current = { sourceIdentity, verified: null, memory: createExplorerMemory() };
    }
    return store.current;
  }, [store, sourceIdentity]);
}

export function useClearPortraitSession(): () => void {
  const store = useContext(PortraitSessionContext);
  return useCallback(() => {
    if (!store?.current) return;
    store.current.verified = null;
    clearExplorerMemory(store.current.memory);
    store.current = null;
  }, [store]);
}
