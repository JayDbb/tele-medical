"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, FileText, User } from "lucide-react";
import { cn } from "@/app/_lib/utils/cn";
import type { PatientLogHistoryResult } from "@/app/_lib/db/drizzle/queries/visit";

interface LogHistoryContentProps {
  patientId: string;
  patientName: string;
  entries: PatientLogHistoryResult["entries"];
}

function formatDateTime(date: Date | string) {
  return new Date(date).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatActionName(action: string) {
  switch (action) {
    case "finalized":
      return "Signed & Complete";
    case "edited_after_signing":
      return "Edited";
    case "created":
      return "Created";
    case "sent_to_waiting_room":
      return "Sent to Waiting Room";
    case "assigned_to_me":
      return "Assigned";
    default:
      return action.replace(/_/g, " ");
  }
}

function getStatusBadge(status: string | null) {
  if (!status) {
    return { variant: "secondary" as const, className: "" };
  }

  const statusLower = status.toLowerCase();
  if (
    status === "Signed & Complete" ||
    statusLower === "signed" ||
    statusLower === "completed"
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

  return { variant: "outline" as const, className: "" };
}

export function LogHistoryContent({
  patientId,
  patientName,
  entries,
}: LogHistoryContentProps) {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Log History</h1>
          <p className="text-sm text-muted-foreground">
            Audit trail for {patientName}
          </p>
        </div>
        <Link href={`/patients/${patientId}/visit-history`}>
          <Button variant="outline">View Visit History</Button>
        </Link>
      </div>

      {entries.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <Clock className="h-10 w-10 text-muted-foreground" />
            <div>
              <p className="font-medium text-foreground">No log history available</p>
              <p className="text-sm text-muted-foreground">
                Audit events will appear here after patient visits are created or updated.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {entries.map((entry, index) => {
            const badge = getStatusBadge(entry.toStatus);

            return (
              <Card key={`${entry.visitId}-${entry.timestamp.toISOString()}-${index}`}>
                <CardHeader className="pb-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-2">
                      <CardTitle className="text-base">
                        {formatActionName(entry.action)}
                      </CardTitle>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={badge.variant} className={cn("text-xs", badge.className)}>
                          {entry.toStatus}
                        </Badge>
                        {entry.appointmentType && (
                          <Badge variant="outline" className="text-xs">
                            {entry.appointmentType}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Link href={`/patients/${patientId}/visit-history/${entry.visitId}`}>
                      <Button variant="ghost" size="sm">
                        <FileText className="mr-2 h-4 w-4" />
                        View Visit
                      </Button>
                    </Link>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Clock className="h-4 w-4" />
                      <span>{formatDateTime(entry.timestamp)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <User className="h-4 w-4" />
                      <span>{entry.userName || entry.userId || "Unknown user"}</span>
                    </div>
                  </div>

                  <div className="grid gap-2 md:grid-cols-2">
                    <div>
                      <span className="font-medium">Visit Date: </span>
                      <span className="text-muted-foreground">
                        {formatDateTime(entry.visitCreatedAt)}
                      </span>
                    </div>
                    <div>
                      <span className="font-medium">Visit Status: </span>
                      <span className="text-muted-foreground">
                        {entry.visitStatus || "Unknown"}
                      </span>
                    </div>
                  </div>

                  {entry.fromStatus && (
                    <div>
                      <span className="font-medium">Status Change: </span>
                      <span className="text-muted-foreground">
                        {entry.fromStatus} to {entry.toStatus}
                      </span>
                    </div>
                  )}

                  {entry.reason && (
                    <div>
                      <span className="font-medium">Reason: </span>
                      <span className="text-muted-foreground whitespace-pre-wrap">
                        {entry.reason}
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
