"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { getSyncEngine } from "@/app/_lib/offline/sync-engine";
import { getOperationCounts } from "@/app/_lib/offline/repos/outbox.repo";
import { isOnline, onOnline, onOffline } from "@/app/_lib/offline/sync/network";

interface OfflineContextValue {
  isOnline: boolean;
  pendingCount: number;
  syncing: boolean;
  failedCount: number;
}

const OfflineContext = createContext<OfflineContextValue | undefined>(undefined);

export function useOffline() {
  const context = useContext(OfflineContext);
  if (!context) {
    throw new Error("useOffline must be used within OfflineProvider");
  }
  return context;
}

export function OfflineProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(isOnline());
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [failedCount, setFailedCount] = useState(0);

  useEffect(() => {
    // Initialize sync engine — guard against IndexedDB failures
    let syncEngine: ReturnType<typeof getSyncEngine>;
    try {
      syncEngine = getSyncEngine();
      syncEngine.start();
    } catch (err) {
      console.warn("Offline sync engine failed to start:", err);
      return;
    }

    // Update online status
    const updateOnlineStatus = () => setOnline(isOnline());
    updateOnlineStatus();

    // Listen for online/offline events
    const cleanupOnline = onOnline(() => {
      setOnline(true);
      syncEngine.start(); // Restart sync when coming online
    });
    const cleanupOffline = onOffline(() => {
      setOnline(false);
    });

    // Update operation counts periodically
    const updateCounts = async () => {
      try {
        const counts = await getOperationCounts();
        setPendingCount(counts.queued);
        setFailedCount(counts.failed);
        setSyncing(counts.syncing > 0);
      } catch (error) {
        console.error("Error updating operation counts:", error);
      }
    };

    updateCounts();
    const countInterval = setInterval(updateCounts, 5000); // Update every 5 seconds

    return () => {
      syncEngine.stop();
      cleanupOnline();
      cleanupOffline();
      clearInterval(countInterval);
    };
  }, []);

  return (
    <OfflineContext.Provider
      value={{
        isOnline: online,
        pendingCount,
        syncing,
        failedCount,
      }}
    >
      {children}
    </OfflineContext.Provider>
  );
}
