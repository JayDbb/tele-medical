"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QRCodeSVG } from "qrcode.react";
import { Input } from "@/components/ui/input";
import { Video, Copy, Check, Phone, Mail, Calendar, User, Pill, AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { formatDate, formatDateTime } from "@/app/_lib/utils/format-date";

interface VisitInfo {
  id: string;
  status: string | null;
  appointmentType: string | null;
  clinicianId: string | null;
  patientJoinToken: string | null;
  twilioRoomName: string | null;
  createdAt: Date;
}

interface Patient {
  id: string;
  fullName: string;
  dob: string | Date | null;
  phone: string | null;
  email: string | null;
  clinicianName: string | null;
  clinicianEmail: string | null;
  allergiesCount: number;
  medicationsCount: number;
  createdAt: Date | null;
  visit: VisitInfo | null;
}

interface PatientsListProps {
  patients: Patient[];
  userRole: string;
}

export function PatientsList({ patients, userRole }: PatientsListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showVirtualModal, setShowVirtualModal] = useState<{ patientId: string; visitId: string; joinUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const initialSearchQuery = searchParams.get("search") || "";
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  const [currentPage, setCurrentPage] = useState(1);

  const PATIENTS_PER_PAGE = 3;

  // Initialize search input from URL param on mount (run once; URL param is fixed for this mount)
  React.useEffect(() => {
    const topBarSearch = document.getElementById("patients-search") as HTMLInputElement;
    if (topBarSearch && initialSearchQuery) {
      topBarSearch.value = initialSearchQuery;
      setSearchQuery(initialSearchQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only URL → local state sync
  }, []);

  // Sync search with top bar search input
  React.useEffect(() => {
    const topBarSearch = document.getElementById("patients-search") as HTMLInputElement;
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
    const topBarSearch = document.getElementById("patients-search") as HTMLInputElement;
    if (topBarSearch && topBarSearch.value !== searchQuery) {
      topBarSearch.value = searchQuery;
    }
  }, [searchQuery]);

  const calculateAge = (dob: string | Date | null) => {
    if (!dob) return null;
    try {
      const birthDate = new Date(dob);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      return age;
    } catch {
      return null;
    }
  };

  const getStatusBadge = (status: string | null) => {
    if (!status) return null;
    const statusLower = status.toLowerCase();
    if (statusLower === "in progress" || statusLower === "in_progress") {
      return <Badge variant="default" className="bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500">In Progress</Badge>;
    }
    if (statusLower === "signed & complete" || statusLower === "signed_and_complete") {
      return <Badge variant="default" className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500">Signed & Complete</Badge>;
    }
    if (statusLower === "waiting") {
      return <Badge variant="default" className="bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500">Waiting</Badge>;
    }
    return <Badge variant="outline">{status}</Badge>;
  };

  const getAppointmentTypeBadge = (type: string | null) => {
    if (!type) return null;
    const typeLower = type.toLowerCase();
    if (typeLower === "virtual") {
      return <Badge variant="default" className="bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500">Virtual</Badge>;
    }
    if (typeLower === "in-person" || typeLower === "in person") {
      return <Badge variant="default" className="bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500">In-Person</Badge>;
    }
    return <Badge variant="outline">{type}</Badge>;
  };

  const isVirtualVisitReady = (visit: VisitInfo | null) => {
    if (!visit) return false;

    // Don't show link for signed and complete visits
    const statusLower = visit.status?.toLowerCase() || "";
    if (statusLower === "signed & complete" || statusLower === "signed_and_complete" || statusLower === "completed") {
      return false;
    }

    return visit.appointmentType?.toLowerCase() === "virtual" &&
      visit.clinicianId !== null &&
      visit.patientJoinToken !== null;
  };

  const getJoinUrl = (visit: VisitInfo | null) => {
    if (!visit?.patientJoinToken) return "";
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
    return `${baseUrl}/join/${visit.patientJoinToken}`;
  };

  const handleCopyLink = async (joinUrl: string) => {
    await navigator.clipboard.writeText(joinUrl);
    setCopied(true);
    toast.success("Link copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleJoinCall = (joinUrl: string) => {
    // Navigate to patient join page using the join token
    router.push(joinUrl);
  };

  // Filter patients based on search query
  const filteredPatients = useMemo(() => {
    if (!searchQuery.trim()) {
      return patients;
    }

    const query = searchQuery.toLowerCase();
    return patients.filter((patient) => {
      const fullName = patient.fullName.toLowerCase();
      const phone = patient.phone?.toLowerCase() || "";
      const email = patient.email?.toLowerCase() || "";
      const clinicianName = patient.clinicianName?.toLowerCase() || "";
      const clinicianEmail = patient.clinicianEmail?.toLowerCase() || "";

      return (
        fullName.includes(query) ||
        phone.includes(query) ||
        email.includes(query) ||
        clinicianName.includes(query) ||
        clinicianEmail.includes(query)
      );
    });
  }, [patients, searchQuery]);

  // Calculate pagination
  const totalPages = Math.ceil(filteredPatients.length / PATIENTS_PER_PAGE);
  const startIndex = (currentPage - 1) * PATIENTS_PER_PAGE;
  const endIndex = startIndex + PATIENTS_PER_PAGE;
  const paginatedPatients = filteredPatients.slice(startIndex, endIndex);

  // Reset to page 1 when search changes (must not use useMemo — side effects belong in useEffect)
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
    // Scroll to top when page changes
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <>
      {/* Results Count */}
      {filteredPatients.length > 0 && (
        <div className="text-sm text-muted-foreground mb-4">
          Showing {startIndex + 1}-{Math.min(endIndex, filteredPatients.length)} of {filteredPatients.length} patients
          {searchQuery && ` matching "${searchQuery}"`}
        </div>
      )}

      {/* Patient Cards */}
      {paginatedPatients.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">
              {searchQuery ? `No patients found matching "${searchQuery}"` : "No patients found"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {paginatedPatients.map((patient) => {
              const virtualReady = isVirtualVisitReady(patient.visit);
              const joinUrl = getJoinUrl(patient.visit);

              const age = calculateAge(patient.dob);

              return (
                <Card key={patient.id} className="w-full hover:shadow-md transition-shadow">
                  <Link href={`/patients/${patient.id}`}>
                    <CardHeader>
                      <CardTitle className="text-lg font-semibold">
                        {patient.fullName}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {/* Age and DOB */}
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        {age !== null && (
                          <div className="flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5" />
                            <span>{age} years old</span>
                          </div>
                        )}
                        {patient.dob && (
                          <span className="text-xs">DOB: {formatDate(patient.dob)}</span>
                        )}
                      </div>

                      {/* Physician */}
                      {patient.clinicianName && (
                        <div className="flex items-center gap-1.5 text-sm">
                          <User className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-muted-foreground">Physician:</span>
                          <span className="font-medium">{patient.clinicianName}</span>
                        </div>
                      )}

                      {/* Contact Info */}
                      {(patient.phone || patient.email) && (
                        <div className="space-y-1.5 text-sm">
                          {patient.phone && (
                            <div className="flex items-center gap-1.5">
                              <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="text-muted-foreground">{patient.phone}</span>
                            </div>
                          )}
                          {patient.email && (
                            <div className="flex items-center gap-1.5">
                              <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="text-muted-foreground truncate">{patient.email}</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Quick Stats */}
                      <div className="flex items-center gap-3 pt-1 border-t">
                        {patient.allergiesCount > 0 && (
                          <div className="flex items-center gap-1.5 text-xs">
                            <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                            <span className="text-muted-foreground">
                              {patient.allergiesCount} {patient.allergiesCount === 1 ? "allergy" : "allergies"}
                            </span>
                          </div>
                        )}
                        {patient.medicationsCount > 0 && (
                          <div className="flex items-center gap-1.5 text-xs">
                            <Pill className="h-3.5 w-3.5 text-blue-600" />
                            <span className="text-muted-foreground">
                              {patient.medicationsCount} {patient.medicationsCount === 1 ? "medication" : "medications"}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Latest Visit Date & Time */}
                      {patient.visit && (
                        <div className="text-xs text-muted-foreground pt-1 border-t">
                          <div className="flex items-center gap-1.5">
                            <Calendar className="h-3 w-3" />
                            <span>Last visit: {formatDateTime(patient.visit.createdAt)}</span>
                          </div>
                        </div>
                      )}

                      {/* Visit Status - Show for nurses */}
                      {userRole === "nurse" && patient.visit && (
                        <div className="space-y-2 pt-2 border-t">
                          <div className="flex flex-wrap gap-2">
                            {getStatusBadge(patient.visit.status)}
                            {getAppointmentTypeBadge(patient.visit.appointmentType)}
                          </div>

                          {/* Virtual Visit Join Button for Nurses */}
                          {virtualReady && (
                            <Button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setShowVirtualModal({
                                  patientId: patient.id,
                                  visitId: patient.visit!.id,
                                  joinUrl,
                                });
                              }}
                              variant="outline"
                              className="w-full"
                              size="sm"
                            >
                              <Video className="h-4 w-4 mr-2" />
                              View Virtual Visit
                            </Button>
                          )}
                        </div>
                      )}

                      {/* Added Date */}
                      <div className="text-xs text-muted-foreground pt-1 border-t">
                        <span>Added: {formatDate(patient.createdAt)}</span>
                      </div>
                    </CardContent>
                  </Link>
                </Card>
              );
            })}
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6 pt-4 border-t">
              <div className="text-sm text-muted-foreground">
                Page {currentPage} of {totalPages}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Virtual Visit Modal for Nurses */}
      {showVirtualModal && (
        <Dialog open={!!showVirtualModal} onOpenChange={(open) => !open && setShowVirtualModal(null)}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Virtual Visit - Patient Join Link</DialogTitle>
              <DialogDescription>
                Share this QR code or link with the patient to join the call
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="p-4 bg-white rounded-lg">
                <QRCodeSVG value={showVirtualModal.joinUrl} size={250} />
              </div>
              <div className="w-full space-y-3">
                <Input value={showVirtualModal.joinUrl} readOnly className="text-xs" />
                <div className="flex gap-2">
                  <Button
                    onClick={() => handleCopyLink(showVirtualModal.joinUrl)}
                    variant="outline"
                    className="flex-1"
                    size="sm"
                  >
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
                  <Button
                    onClick={() => handleJoinCall(showVirtualModal.joinUrl)}
                    variant="default"
                    className="flex-1"
                    size="sm"
                  >
                    <Video className="h-4 w-4 mr-2" />
                    Join as Patient
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

