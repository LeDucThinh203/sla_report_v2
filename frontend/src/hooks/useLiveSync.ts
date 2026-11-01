import { useCallback, useEffect, useRef, useState } from "react";
import { fetchMetadata } from "../services/report.api";
import {
  LIVE_SYNC_POLL_INTERVAL_MS,
  type AppMetadataResponse,
} from "../types/report.types";

interface UseLiveSyncCallbacks {
  onBecameReady: () => void;
  onVersionChanged: () => void;
}

/**
 * Polls `/api/metadata` to track server readiness and `data_version` updates.
 * Keeps React state updates pure and invokes callbacks outside `setState`.
 */
export function useLiveSync({ onBecameReady, onVersionChanged }: UseLiveSyncCallbacks) {
  const [metadata, setMetadata] = useState<AppMetadataResponse | null>(null);
  const metadataRef = useRef<AppMetadataResponse | null>(null);
  const callbacksRef = useRef<UseLiveSyncCallbacks>({
    onBecameReady,
    onVersionChanged,
  });

  useEffect(() => {
    callbacksRef.current = { onBecameReady, onVersionChanged };
  }, [onBecameReady, onVersionChanged]);

  const updateMetadata = useCallback((meta: AppMetadataResponse) => {
    metadataRef.current = meta;
    setMetadata(meta);
  }, []);

  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const meta = await fetchMetadata();
        const prev = metadataRef.current;
        updateMetadata(meta);

        const becameReady = Boolean(prev && !prev.ready && meta.ready);
        const versionChanged = Boolean(
          prev && meta.ready && prev.data_version !== meta.data_version
        );

        if (becameReady) {
          callbacksRef.current.onBecameReady();
        } else if (versionChanged) {
          callbacksRef.current.onVersionChanged();
        }
      } catch {
        // Ignore transient background poll errors
      }
    }, LIVE_SYNC_POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [updateMetadata]);

  return {
    metadata,
    updateMetadata,
  };
}
