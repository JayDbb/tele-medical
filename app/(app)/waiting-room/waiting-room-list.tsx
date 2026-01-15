"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useState, useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getPatientOpenVisitAction, assignVisitToMeAction } from "@/app/_actions/visits";
import { toast } from "sonner";
import { Search, Clock, ArrowUpDown, Video, Copy, Check, QrCode, RefreshCw } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useWaitingRoomRealtime } from "@/app/_lib/hooks/use-waiting-room-realtime";

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

interface WaitingRoomListProps {
  patients: Patient[]; // Initial patients from server
}

type SortField = "name" | "waitTime" | "priority" | "appointmentType";
type SortDirection = "asc" | "desc";

export function WaitingRoomList({ patients: initialPatients }: WaitingRoomListProps) {
  const router = useRouter();
  const [loadingPatientId, setLoadingPatientId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("waitTime");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const [virtualVisitData, setVirtualVisitData] = useState<Record<string, { joinUrl: string; visitId: string }>>({});

  // Use polling hook to get live updates
  const { patients, isConnected, error: realtimeError, refresh } = useWaitingRoomRealtime({
    initialPatients,
    onError: (error) => {
      // Only log errors, don't spam console
      // Errors are handled gracefully - the UI will show initial data
      if (process.env.NODE_ENV === "development") {
        console.warn("Polling error:", error.message);
      }
    },
  });

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleAssignToMe = async (patientId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    setLoadingPatientId(patientId);

    try {
      // Check if patient has an open visit
      const result = await getPatientOpenVisitAction(patientId);

      if (result.visit) {
        // Assign the visit to the current user
        const assignResult = await assignVisitToMeAction(result.visit.id);

        // Navigate to the new-visit page for this visit
        router.push(`/patients/${patientId}/new-visit?visitId=${result.visit.id}`);
      } else {
        // No open visit, navigate to new visit page
        router.push(`/patients/${patientId}/new-visit`);
      }
    } catch (error) {
      console.error("Error assigning visit:", error);
      toast.error("Failed to assign visit");
      // Fallback to patient page
      router.push(`/patients/${patientId}`);
    } finally {
      setLoadingPatientId(null);
    }
  };

  // Calculate wait time in minutes
  const getWaitTime = (visit: VisitInfo | null): number => {
    if (!visit || !visit.createdAt) return 0;
    const now = new Date();
    const visitTime = new Date(visit.createdAt);
    const diffMs = now.getTime() - visitTime.getTime();
    return Math.floor(diffMs / (1000 * 60)); // Convert to minutes
  };

  // Format wait time display
  const formatWaitTime = (minutes: number): string => {
    if (minutes < 60) {
      return `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  // Get priority badge variant
  const getPriorityBadge = (priority: string | null) => {
    if (!priority) {
      return { variant: "secondary" as const, label: "Not Set" };
    }
    const priorityLower = priority.toLowerCase();
    if (priorityLower === "critical" || priorityLower === "urgent") {
      return {
        variant: "destructive" as const,
        label: priority,
        className: "bg-red-500 text-white border-red-600 dark:bg-red-600 dark:text-white"
      };
    }
    if (priorityLower === "mild" || priorityLower === "low") {
      return { variant: "default" as const, label: priority };
    }
    return { variant: "outline" as const, label: priority };
  };

  // Get appointment type badge
  const getAppointmentTypeBadge = (type: string | null) => {
    if (!type) {
      return { variant: "secondary" as const, label: "Not Set" };
    }
    const typeLower = type.toLowerCase();
    if (typeLower === "in-person" || typeLower === "in person") {
      return { variant: "default" as const, label: "In-Person", className: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500" };
    }
    if (typeLower === "virtual") {
      return { variant: "default" as const, label: "Virtual", className: "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500" };
    }
    return { variant: "outline" as const, label: type };
  };

  // Filter and sort patients
  const filteredAndSortedPatients = useMemo(() => {
    let filtered = patients.filter(patient => {
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      return (
        patient.fullName.toLowerCase().includes(query) ||
        (patient.visit?.priority?.toLowerCase().includes(query) ?? false) ||
        (patient.visit?.appointmentType?.toLowerCase().includes(query) ?? false)
      );
    });

    // Sort
    filtered.sort((a, b) => {
      let aValue: string | number;
      let bValue: string | number;

      switch (sortField) {
        case "name":
          aValue = a.fullName.toLowerCase();
          bValue = b.fullName.toLowerCase();
          break;
        case "waitTime":
          aValue = getWaitTime(a.visit);
          bValue = getWaitTime(b.visit);
          break;
        case "priority":
          aValue = a.visit?.priority?.toLowerCase() || "zzz";
          bValue = b.visit?.priority?.toLowerCase() || "zzz";
          // Custom priority order: critical > urgent > mild > others
          const priorityOrder: Record<string, number> = { critical: 0, urgent: 1, mild: 2 };
          aValue = priorityOrder[aValue as string] ?? 999;
          bValue = priorityOrder[bValue as string] ?? 999;
          break;
        case "appointmentType":
          aValue = a.visit?.appointmentType?.toLowerCase() || "zzz";
          bValue = b.visit?.appointmentType?.toLowerCase() || "zzz";
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return sortDirection === "asc" ? -1 : 1;
      if (aValue > bValue) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [patients, searchQuery, sortField, sortDirection]);

  const handleSortChange = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  // Sync search with top bar search input
  React.useEffect(() => {
    const topBarSearch = document.getElementById("waiting-room-search") as HTMLInputElement;
    if (topBarSearch) {
      const handleInput = (e: Event) => {
        const target = e.target as HTMLInputElement;
        setSearchQuery(target.value);
      };
      topBarSearch.addEventListener("input", handleInput);
      // Sync initial value
      if (topBarSearch.value !== searchQuery) {
        topBarSearch.value = searchQuery;
      }
      return () => {
        topBarSearch.removeEventListener("input", handleInput);
      };
    }
  }, [searchQuery]);

  // Update top bar search when searchQuery changes (for external updates)
  React.useEffect(() => {
    const topBarSearch = document.getElementById("waiting-room-search") as HTMLInputElement;
    if (topBarSearch && topBarSearch.value !== searchQuery) {
      topBarSearch.value = searchQuery;
    }
  }, [searchQuery]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* Refresh Button and Sort Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="w-fit"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
          {isRefreshing ? "Refreshing..." : "Refresh"}
        </Button>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-end">
        <div className="flex items-center gap-2">
          <Select value={sortField} onValueChange={(value) => handleSortChange(value as SortField)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="waitTime">Wait Time</SelectItem>
              <SelectItem value="priority">Priority</SelectItem>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="appointmentType">Appointment Type</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setSortDirection(sortDirection === "asc" ? "desc" : "asc")}
            title={`Sort ${sortDirection === "asc" ? "Descending" : "Ascending"}`}
          >
            <ArrowUpDown className="h-4 w-4" />
          </Button>
        </div>
        </div>
      </div>

      {/* Patient Cards */}
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {filteredAndSortedPatients.map((patient) => {
          const waitTime = getWaitTime(patient.visit);
          const priorityBadge = getPriorityBadge(patient.visit?.priority ?? null);
          const appointmentBadge = getAppointmentTypeBadge(patient.visit?.appointmentType ?? null);

          return (
            <Card 
              key={patient.id} 
              className="w-full hover:shadow-md transition-shadow"
            >
              <CardHeader>
                <CardTitle className="text-lg font-semibold">
                  {patient.fullName}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Wait Time */}
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Waiting:</span>
                  <span className="font-medium">
                    {waitTime > 0 ? formatWaitTime(waitTime) : "Just arrived"}
                  </span>
                </div>

                {/* Priority and Appointment Type */}
                <div className="flex flex-wrap gap-2">
                  <Badge
                    variant={priorityBadge.variant}
                    className={
                      priorityBadge.className ||
                      (priorityBadge.variant === "default" && priorityBadge.label === "mild" ? "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500" : "")
                    }
                  >
                    {priorityBadge.label}
                  </Badge>
                  <Badge
                    variant={appointmentBadge.variant}
                    className={appointmentBadge.className || ""}
                  >
                    {appointmentBadge.label}
                  </Badge>
                </div>

                {/* Show virtual appointment actions if:
                  1. We have virtual visit data for this patient, OR
                  2. The visit is virtual and has a clinician assigned (already assigned) */}
                {(virtualVisitData[patient.id] ||
                  (patient.visit?.appointmentType?.toLowerCase() === "virtual" &&
                    patient.visit?.status === "In Progress" &&
                    patient.visit?.patientJoinToken)) ? (
                  <div onClick={(e) => e.stopPropagation()}>
                    <VirtualAppointmentActions
                      patientId={patient.id}
                      visitId={virtualVisitData[patient.id]?.visitId || patient.visit?.id || ""}
                      joinUrl={
                        typeof window !== 'undefined'
                          ? `${window.location.origin}/visit/${virtualVisitData[patient.id]?.visitId || patient.visit?.id || ""}/call`
                          : ""
                      }
                      onJoin={() => router.push(`/visit/${virtualVisitData[patient.id]?.visitId || patient.visit?.id || ""}/call`)}
                    />
                  </div>
                ) : (
                  <Button
                    onClick={(e) => handleAssignToMe(patient.id, e)}
                    className="w-full"
                    variant="default"
                    disabled={loadingPatientId === patient.id}
                  >
                    {loadingPatientId === patient.id ? "Loading..." : "Assign To Me"}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filteredAndSortedPatients.length === 0 && (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">No patients found matching your search</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Virtual Appointment Actions Component
function VirtualAppointmentActions({
  patientId,
  visitId,
  joinUrl,
  onJoin,
}: {
  patientId: string;
  visitId: string;
  joinUrl: string;
  onJoin: () => void;
}) {
  const [showQR, setShowQR] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(joinUrl);
    setCopied(true);
    toast.success("Link copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-2">
      <Button onClick={onJoin} className="w-full" variant="default">
        <Video className="h-4 w-4 mr-2" />
        Join Call
      </Button>
      <div className="flex gap-2 flex-nowrap">
        <Button
          onClick={() => setShowQR(true)}
          variant="outline"
          className="flex-1 min-w-0"
          size="sm"
        >
          <QrCode className="h-4 w-4 mr-1" />
          QR Code
        </Button>
        <Button
          onClick={handleCopy}
          variant="outline"
          className="flex-1 min-w-0"
          size="sm"
        >
          {copied ? (
            <>
              <Check className="h-4 w-4 mr-1" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-4 w-4 mr-1" />
              Copy Link
            </>
          )}
        </Button>
      </div>
      <Dialog open={showQR} onOpenChange={setShowQR}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Doctor Join Link</DialogTitle>
            <DialogDescription>
              Scan this QR code or copy the link to join the call
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="p-4 bg-white rounded-lg">
              <QRCodeSVG value={joinUrl} size={200} />
            </div>
            <div className="w-full space-y-2">
              <Input value={joinUrl} readOnly className="text-xs" />
              <Button onClick={handleCopy} variant="outline" className="w-full" size="sm">
                {copied ? (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-2" />
                    Copy Link
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
