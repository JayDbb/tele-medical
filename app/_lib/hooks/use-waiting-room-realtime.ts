"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createSupabaseBrowserClient } from "@/app/_lib/supabase/client";

interface VisitInfo {
  id: string;
  priority: string | null;
  appointmentType: string | null;
  createdAt: Date;
  status: string | null;
  clinicianId: string | null;
  twilioRoomName: string | null;
  patientJoinToken: string | null;
}

interface Patient {
  id: string;
  fullName: string;
  createdAt: Date | null;
  visit: VisitInfo | null;
}

interface UseWaitingRoomRealtimeOptions {
  initialPatients: Patient[];
  onError?: (error: Error) => void;
}

interface UseWaitingRoomRealtimeReturn {
  patients: Patient[];
  isConnected: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

/**
 * Hook to poll for waiting room updates (no Realtime subscription needed)
 * Polls the database every 3 seconds to check for changes
 */
export function useWaitingRoomRealtime({
  initialPatients,
  onError,
}: UseWaitingRoomRealtimeOptions): UseWaitingRoomRealtimeReturn {
  const [patients, setPatients] = useState<Patient[]>(initialPatients);
  const [isConnected, setIsConnected] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const supabaseRef = useRef<ReturnType<
    typeof createSupabaseBrowserClient
  > | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isFetchingRef = useRef<boolean>(false);
  const fetchAllPatientsRef = useRef<(() => Promise<void>) | undefined>(
    undefined
  );

  // Initialize Supabase client
  useEffect(() => {
    try {
      supabaseRef.current = createSupabaseBrowserClient();
    } catch (err) {
      const error =
        err instanceof Error
          ? err
          : new Error("Failed to create Supabase client");
      setError(error);
      onError?.(error);
      return;
    }
  }, [onError]);

  // Fetch all waiting room patients
  const fetchAllPatients = useCallback(async () => {
    if (!supabaseRef.current) return;

    // Prevent concurrent fetches
    if (isFetchingRef.current) {
      return;
    }

    isFetchingRef.current = true;

    try {
      // Fetch all unassigned patients
      const { data: patientsData, error: patientsError } =
        await supabaseRef.current
          .from("patients")
          .select("id, full_name, created_at, is_assigned")
          .eq("is_assigned", false)
          .order("created_at", { ascending: false });

      if (patientsError || !patientsData) {
        throw patientsError || new Error("Failed to fetch patients");
      }

      if (patientsData.length === 0) {
        setPatients([]);
        setIsConnected(true);
        setError(null);
        return;
      }

      // Get patient IDs
      const patientIds = patientsData.map((p) => p.id);

      // Fetch visits for these patients
      const { data: visitsData, error: visitsError } = await supabaseRef.current
        .from("visits")
        .select(
          "id, patient_id, priority, appointment_type, created_at, status, clinician_id, twilio_room_name, patient_join_token"
        )
        .in("patient_id", patientIds)
        .in("status", ["Waiting", "In Progress", "waiting", "in_progress"])
        .order("created_at", { ascending: false });

      if (visitsError) {
        throw visitsError;
      }

      // Map visits to patients (get most recent visit per patient)
      const visitMap = new Map<string, any>();
      if (visitsData) {
        for (const visit of visitsData) {
          if (!visitMap.has(visit.patient_id)) {
            visitMap.set(visit.patient_id, visit);
          }
        }
      }

      // Combine patient data with visit data
      const transformedPatients: Patient[] = patientsData.map((patient) => {
        const visitData = visitMap.get(patient.id);

        const visit: VisitInfo | null = visitData
          ? {
              id: visitData.id,
              priority: visitData.priority,
              appointmentType: visitData.appointment_type,
              createdAt: visitData.created_at
                ? visitData.created_at instanceof Date
                  ? visitData.created_at
                  : new Date(visitData.created_at)
                : new Date(),
              status: visitData.status,
              clinicianId: visitData.clinician_id,
              twilioRoomName: visitData.twilio_room_name,
              patientJoinToken: visitData.patient_join_token,
            }
          : null;

        return {
          id: patient.id,
          fullName: patient.full_name,
          createdAt: patient.created_at
            ? patient.created_at instanceof Date
              ? patient.created_at
              : new Date(patient.created_at)
            : null,
          visit,
        };
      });

      setPatients(transformedPatients);
      setIsConnected(true);
      setError(null);
    } catch (err) {
      const error =
        err instanceof Error
          ? err
          : new Error("Failed to fetch waiting room patients");
      setError(error);
      setIsConnected(false);
      onError?.(error);
      console.error("Error fetching waiting room patients:", err);
    } finally {
      isFetchingRef.current = false;
    }
  }, [onError]);

  // Store the function in a ref so it doesn't cause effect re-runs
  useEffect(() => {
    fetchAllPatientsRef.current = fetchAllPatients;
  }, [fetchAllPatients]);

  // Manual refresh function
  const refresh = useCallback(async () => {
    await fetchAllPatients();
  }, [fetchAllPatients]);

  // Set up polling
  useEffect(() => {
    const supabase = supabaseRef.current;
    if (!supabase) {
      if (process.env.NODE_ENV === "development") {
        console.warn("⚠️ Polling: Supabase client not initialized");
      }
      return;
    }

    // Clear any existing interval first
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    // Poll immediately on mount
    if (fetchAllPatientsRef.current) {
      fetchAllPatientsRef.current();
    }

    // Set up polling interval (every 3 seconds)
    pollingIntervalRef.current = setInterval(() => {
      if (fetchAllPatientsRef.current) {
        fetchAllPatientsRef.current();
      }
    }, 3000);

    // Cleanup on unmount
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, []); // Empty dependency array - only run once on mount

  // Update patients when initialPatients changes (e.g., on page refresh)
  useEffect(() => {
    setPatients(initialPatients);
  }, [initialPatients]);

  return {
    patients,
    isConnected,
    error,
    refresh,
  };
}
