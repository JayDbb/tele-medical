"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileText, Clock, User, Video, Copy, Check, QrCode } from "lucide-react";
import { formatDateTime } from "@/app/_lib/utils/format-date";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { formatVisitStatusLabel } from "@/app/_lib/utils/visit-status-label";

interface OpenVisit {
  id: string;
  patientId: string;
  patientName: string;
  status: string | null;
  priority: string | null;
  appointmentType: string | null;
  createdAt: Date;
  patientJoinToken: string | null;
  twilioRoomName: string | null;
}

interface OpenNotesContentProps {
  visits: OpenVisit[];
}

export function OpenNotesContent({ visits }: OpenNotesContentProps) {
  const [searchQuery, setSearchQuery] = useState("");

  // Sync search with top bar search input
  React.useEffect(() => {
    const topBarSearch = document.getElementById("open-notes-search") as HTMLInputElement;
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

  // Filter visits based on search query
  const filteredVisits = useMemo(() => {
    if (!searchQuery) return visits;
    const query = searchQuery.toLowerCase();
    return visits.filter(visit => {
      return (
        visit.patientName.toLowerCase().includes(query) ||
        (visit.status?.toLowerCase().includes(query) ?? false) ||
        (visit.priority?.toLowerCase().includes(query) ?? false) ||
        (visit.appointmentType?.toLowerCase().includes(query) ?? false)
      );
    });
  }, [visits, searchQuery]);

  const getStatusBadge = (status: string | null) => {
    if (!status) {
      return { variant: "secondary" as const, className: "" };
    }
    const statusLower = status.toLowerCase();

    if (
      status === "Signed & Complete" ||
      statusLower === "signed" ||
      statusLower === "completed" ||
      statusLower === "signed & complete"
    ) {
      return {
        variant: "default" as const,
        className: "bg-green-500 text-white border-green-600 dark:bg-green-600",
      };
    }
    if (status === "Waiting" || statusLower === "waiting") {
      return {
        variant: "outline" as const,
        className: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500 dark:border-blue-400",
      };
    }
    if (
      status === "In Progress" ||
      statusLower === "in_progress" ||
      statusLower === "in progress"
    ) {
      return {
        variant: "outline" as const,
        className: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500 dark:border-yellow-400",
      };
    }
    if (statusLower === "draft") {
      return {
        variant: "secondary" as const,
        className: "bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500 dark:border-gray-400",
      };
    }
    if (statusLower === "finalized" || statusLower === "signed_and_complete") {
      return {
        variant: "default" as const,
        className: "bg-green-500 text-white border-green-600 dark:bg-green-600",
      };
    }
    return { variant: "outline" as const, className: "" };
  };

  const getPriorityBadge = (priority: string | null) => {
    if (!priority) {
      return null;
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
      return { variant: "default" as const, label: priority, className: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500" };
    }
    return { variant: "outline" as const, label: priority };
  };

  const getAppointmentTypeBadge = (type: string | null) => {
    if (!type) {
      return null;
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

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Open Notes</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Visits assigned to you that are in progress or waiting
        </p>
      </div>

      {filteredVisits.length === 0 && visits.length > 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">No visits found matching your search</p>
          </CardContent>
        </Card>
      ) : visits.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">No open notes</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {filteredVisits.map((visit) => {
            const statusBadge = getStatusBadge(visit.status);
            const priorityBadge = getPriorityBadge(visit.priority);
            const appointmentBadge = getAppointmentTypeBadge(visit.appointmentType);

            const isVirtual = visit.appointmentType?.toLowerCase() === "virtual";
            const hasJoinToken = !!visit.patientJoinToken;

            // Don't show virtual visit link for signed and complete visits
            const statusLower = visit.status?.toLowerCase() || "";
            const isCompleted = statusLower === "signed & complete" ||
              statusLower === "signed_and_complete" ||
              statusLower === "completed";
            const canShowVirtualLink = isVirtual && hasJoinToken && !isCompleted;

            return (
              <Card key={visit.id} className="w-full hover:shadow-md transition-shadow">
                <CardHeader>
                  <CardTitle className="text-lg font-semibold flex items-center gap-2">
                    <User className="h-5 w-5 text-muted-foreground" />
                    {visit.patientName}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Created:</span>
                    <span className="font-medium">
                      {formatDateTime(visit.createdAt)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge variant={statusBadge.variant} className={statusBadge.className}>
                      {formatVisitStatusLabel(visit.status)}
                    </Badge>
                  </div>

                  {(priorityBadge || appointmentBadge) && (
                    <div className="flex flex-wrap gap-2">
                      {priorityBadge && (
                        <Badge variant={priorityBadge.variant} className={priorityBadge.className || ""}>
                          {priorityBadge.label}
                        </Badge>
                      )}
                      {appointmentBadge && (
                        <Badge variant={appointmentBadge.variant} className={appointmentBadge.className || ""}>
                          {appointmentBadge.label}
                        </Badge>
                      )}
                    </div>
                  )}

                  {/* Virtual Appointment Actions - Only show if not completed and token exists */}
                  {canShowVirtualLink && visit.patientJoinToken && (
                    <VirtualAppointmentActions
                      visitId={visit.id}
                      patientJoinToken={visit.patientJoinToken}
                    />
                  )}

                  <Link href={`/patients/${visit.patientId}/new-visit?visitId=${visit.id}`}>
                    <Button className="w-full" variant="default">
                      <FileText className="h-4 w-4 mr-2" />
                      Continue Note
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Virtual Appointment Actions Component
function VirtualAppointmentActions({
  visitId,
  patientJoinToken,
}: {
  visitId: string;
  patientJoinToken: string;
}) {
  const router = useRouter();
  const [showQR, setShowQR] = useState(false);
  const [copied, setCopied] = useState(false);

  const joinUrl = typeof window !== "undefined"
    ? `${window.location.origin}/visit/${visitId}/call`
    : "";

  const handleCopyLink = async () => {
    if (!joinUrl) return;
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      toast.success("Link copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast.error("Failed to copy link");
    }
  };

  return (
    <div className="space-y-2 pt-2 border-t">
      <div className="flex flex-col gap-2">
        <Button
          variant="default"
          size="sm"
          className="w-full"
          onClick={() => router.push(`/visit/${visitId}/call`)}
        >
          <Video className="h-4 w-4 mr-2" />
          Join Call
        </Button>
        <div className="flex gap-2 flex-nowrap">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 min-w-0"
            onClick={() => setShowQR(true)}
          >
            <QrCode className="h-4 w-4 mr-1" />
            QR Code
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 min-w-0"
            onClick={handleCopyLink}
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
      </div>

      {/* QR Code Dialog */}
      <Dialog open={showQR} onOpenChange={setShowQR}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Doctor Join Link</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            <p className="text-sm text-muted-foreground text-center">
              Scan this QR code or copy the link to join the call
            </p>
            {joinUrl && (
              <div className="p-4 bg-white rounded-lg">
                <QRCodeSVG value={joinUrl} size={200} />
              </div>
            )}
            <div className="w-full">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleCopyLink}
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Copied!
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

