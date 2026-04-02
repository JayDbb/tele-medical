"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Calendar, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/app/_lib/utils/cn";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { VisitHistoryResult } from "@/app/_lib/db/drizzle/queries/visit-history";
import { formatDateTime } from "@/app/_lib/utils/format-date";
import { formatVisitStatusLabel } from "@/app/_lib/utils/visit-status-label";

interface VisitHistoryContentProps {
  patientId: string;
  userRole: string;
  data: VisitHistoryResult;
  searchQuery: string | null;
}

export function VisitHistoryContent({
  patientId,
  userRole: _userRole,
  data,
  searchQuery: initialSearchQuery,
}: VisitHistoryContentProps) {
  void _userRole;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = React.useState(initialSearchQuery || "");

  // Get current filter values from URL
  const currentStatus = searchParams.get("status") || "all";
  const currentFrom = searchParams.get("from") || "";
  const currentTo = searchParams.get("to") || "";
  // Format date for input (YYYY-MM-DD)
  const formatDateForInput = (date: string | null) => {
    if (!date) return "";
    const d = new Date(date);
    if (isNaN(d.getTime())) return "";
    return d.toISOString().split("T")[0];
  };

  // Update URL with new params
  const updateFilters = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());

    Object.entries(updates).forEach(([key, value]) => {
      if (value && value !== "all" && value !== "") {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });

    // Reset to page 1 when filters change
    if (!updates.page) {
      params.set("page", "1");
    }

    router.push(`/patients/${patientId}/visit-history?${params.toString()}`);
  };

  const handleStatusChange = (value: string) => {
    updateFilters({ status: value });
  };

  const handleFromChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateFilters({ from: e.target.value || null });
  };

  const handleToChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateFilters({ to: e.target.value || null });
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateFilters({ q: searchQuery || null });
  };

  const handleClearFilters = () => {
    setSearchQuery("");
    router.push(`/patients/${patientId}/visit-history`);
  };

  const handlePageChange = (newPage: number) => {
    updateFilters({ page: newPage.toString() });
  };

  // Client-side search filter (optional enhancement)
  const filteredVisits = React.useMemo(() => {
    if (!searchQuery) return data.visits;

    const query = searchQuery.toLowerCase();
    return data.visits.filter((visit) => {
      const visitId = visit.id.toLowerCase();
      const appointmentType = (visit.appointmentType || "").toLowerCase();
      const priority = (visit.priority || "").toLowerCase();
      const status = (visit.status || "").toLowerCase();

      return (
        visitId.includes(query) ||
        appointmentType.includes(query) ||
        priority.includes(query) ||
        status.includes(query)
      );
    });
  }, [data.visits, searchQuery]);

  // Get new visit path based on role
  const getNewVisitPath = () => {
    return `/patients/${patientId}/new-visit`;
  };

  // Calculate pagination
  const totalPages = Math.ceil(data.total / data.pageSize);
  const hasNextPage = data.page < totalPages;
  const hasPrevPage = data.page > 1;

  // Get status badge with color coding
  const getStatusBadge = (status: string | null) => {
    if (!status) {
      return { variant: "secondary" as const, className: "" };
    }
    const statusLower = status.toLowerCase();
    
    // Handle both new and old status values for backward compatibility
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

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Visit History</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Review previous visits for this patient.
          </p>
        </div>
        <Link href={getNewVisitPath()}>
          <Button>
            Log New Visit
          </Button>
        </Link>
      </div>

      {/* Filters Row */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-4">
            {/* Search and Status Row */}
            <div className="flex flex-col gap-4 sm:flex-row">
              <form
                onSubmit={handleSearchSubmit}
                className="flex-1 flex gap-2"
              >
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search by visit ID, location, priority, status..."
                    value={searchQuery}
                    onChange={handleSearchChange}
                    className="pl-9"
                  />
                </div>
                <Button type="submit" variant="outline" size="default">
                  Search
                </Button>
              </form>

              <Select value={currentStatus} onValueChange={handleStatusChange}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="In Progress">In Progress</SelectItem>
                  <SelectItem value="Waiting">Waiting</SelectItem>
                  <SelectItem value="Signed & Complete">Signed & Complete</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Date Range Row */}
            <div className="flex flex-col gap-4 sm:flex-row">
              <div className="flex items-center gap-2 flex-1">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <Input
                  type="date"
                  placeholder="From date"
                  value={formatDateForInput(currentFrom)}
                  onChange={handleFromChange}
                  className="flex-1"
                />
                <span className="text-sm text-muted-foreground">to</span>
                <Input
                  type="date"
                  placeholder="To date"
                  value={formatDateForInput(currentTo)}
                  onChange={handleToChange}
                  className="flex-1"
                />
              </div>

              <Button
                variant="outline"
                onClick={handleClearFilters}
                className="w-full sm:w-auto"
              >
                <X className="h-4 w-4 mr-2" />
                Clear
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Visit List */}
      {filteredVisits.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <div className="text-center">
              <p className="text-muted-foreground">No visits yet.</p>
              {data.total === 0 && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Start by logging a new visit.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-6">
            {filteredVisits.map((visit) => (
              <Link
                key={visit.id}
                href={`/patients/${patientId}/visit-history/${visit.id}`}
              >
                <Card className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      {/* Left: Date and Status */}
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-foreground">
                            {formatDateTime(visit.createdAt)}
                          </span>
                          {(() => {
                            const badge = getStatusBadge(visit.status);
                            return (
                              <Badge variant={badge.variant} className={badge.className}>
                            {formatVisitStatusLabel(visit.status)}
                          </Badge>
                            );
                          })()}
                        </div>

                        {/* Metadata Row */}
                        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                          {visit.appointmentType && (
                          <span>
                              Appointment: {visit.appointmentType === "in-person" ? "In-Person" : visit.appointmentType === "virtual" ? "Virtual" : visit.appointmentType}
                          </span>
                          )}
                          {visit.priority && visit.appointmentType && (
                            <Separator orientation="vertical" className="h-4" />
                          )}
                          {visit.priority && (
                            <>
                          <Separator orientation="vertical" className="h-4" />
                              <span className="flex items-center gap-1">
                                Priority:{" "}
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "text-xs",
                                    visit.priority.toLowerCase() === "high" || visit.priority.toLowerCase() === "urgent"
                                      ? "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500 dark:border-red-400"
                                      : visit.priority.toLowerCase() === "medium"
                                      ? "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500 dark:border-yellow-400"
                                      : "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500 dark:border-green-400"
                                  )}
                                >
                                  {visit.priority}
                                </Badge>
                          </span>
                            </>
                          )}
                        </div>
                      </div>

                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Showing {((data.page - 1) * data.pageSize) + 1} to{" "}
                {Math.min(data.page * data.pageSize, data.total)} of{" "}
                {data.total} visits
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(data.page - 1)}
                  disabled={!hasPrevPage}
                >
                  Previous
                </Button>
                <div className="text-sm text-muted-foreground">
                  Page {data.page} of {totalPages}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(data.page + 1)}
                  disabled={!hasNextPage}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

