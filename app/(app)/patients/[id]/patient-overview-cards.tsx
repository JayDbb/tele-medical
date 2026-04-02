"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Calendar, Heart, Pill, History, AlertTriangle, FileText, Video, Copy, Check } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";

interface PatientOverviewCardsProps {
  patient: {
    id: string;
    fullName: string;
    dob: string | null;
    allergies: unknown;
    vitals: unknown;
    currentMedications: unknown;
    vaccines: unknown;
    familyHistory: unknown;
    socialHistory: unknown;
    pastMedicalHistory: unknown;
    surgicalHistory: unknown;
  };
  stats: {
    ordersCount: number;
    documentsCount: number;
  };
  latestVisit: {
    id: string;
    createdAt: Date;
    status: string | null;
    notesStatus: string | null;
    appointmentType: string | null;
    clinicianId: string | null;
    patientJoinToken: string | null;
    twilioRoomName: string | null;
    chiefComplaint: string | null;
  } | null;
  userRole: string;
}

/**
 * Normalize JSONB data to array format
 */
function normalizeJsonb(data: unknown): unknown[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (typeof data === "object") return Object.values(data);
  return [];
}

/**
 * Calculate visit note progress based on status
 */
function calculateVisitProgress(notesStatus: string | null): number {
  if (!notesStatus) return 0;
  if (notesStatus === "draft") return 25;
  if (notesStatus === "in-progress") return 50;
  if (notesStatus === "review") return 75;
  if (notesStatus === "finalized") return 100;
  return 0;
}

export function PatientOverviewCards({
  patient,
  stats,
  latestVisit,
  userRole,
}: PatientOverviewCardsProps) {
  const router = useRouter();
  const [showVirtualModal, setShowVirtualModal] = useState(false);
  const [copied, setCopied] = useState(false);

  const isVirtualVisitReady = () => {
    if (!latestVisit) return false;

    // Don't show link for signed and complete visits
    const statusLower = latestVisit.status?.toLowerCase() || "";
    if (statusLower === "signed & complete" ||
      statusLower === "signed_and_complete" ||
      statusLower === "completed") {
      return false;
    }

    return latestVisit.appointmentType?.toLowerCase() === "virtual" &&
      latestVisit.clinicianId !== null &&
      latestVisit.patientJoinToken !== null;
  };

  const getJoinUrl = () => {
    if (!latestVisit?.patientJoinToken) return "";
    // Use forwarded port URL for testing on phone
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
    return `${baseUrl}/join/${latestVisit.patientJoinToken}`;
  };

  const handleCopyLink = async () => {
    const joinUrl = getJoinUrl();
    await navigator.clipboard.writeText(joinUrl);
    setCopied(true);
    toast.success("Link copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleJoinCall = () => {
    const joinUrl = getJoinUrl();
    if (joinUrl) {
      router.push(joinUrl);
    }
  };
  const allergies = normalizeJsonb(patient.allergies) as Array<{ name?: string; type?: string }>;
  const medications = normalizeJsonb(patient.currentMedications) as Array<{
    id?: string;
    brandName?: string;
    genericName?: string;
    name?: string; // Legacy field
    medication?: string; // Legacy field
    dosage?: string;
    frequency?: string;
    status?: string;
  }>;
  // Vitals is an array of VitalEntry objects, get the most recent one
  const vitalsArray = normalizeJsonb(patient.vitals) as Array<{
    id?: string;
    date?: string;
    bp?: string;
    hr?: string;
    temp?: string;
    weight?: string;
    height?: string;
    bmi?: string;
    spo2?: string;
    rr?: string;
  }>;
  const familyHistory = normalizeJsonb(patient.familyHistory);
  const socialHistory = normalizeJsonb(patient.socialHistory);
  const pastMedicalHistory = normalizeJsonb(patient.pastMedicalHistory);
  const surgicalHistory = normalizeJsonb(patient.surgicalHistory);

  // Get the most recent vital entry (sorted by date, most recent first)
  const latestVital = vitalsArray.length > 0
    ? vitalsArray.sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
      return dateB - dateA;
    })[0]
    : null;

  // Extract vitals from the most recent entry
  const bp = latestVital?.bp;
  const hr = latestVital?.hr;
  const temp = latestVital?.temp;
  const weight = latestVital?.weight;

  // Calculate risk flags
  const hasHighBP = bp && (bp.includes("/") ? parseInt(bp.split("/")[0]) > 140 : false);
  const hasFever = temp && parseFloat(temp) > 100.4;
  const hasRiskFlags = hasHighBP || hasFever;

  // Visit progress
  const visitProgress = latestVisit ? calculateVisitProgress(latestVisit.notesStatus) : 0;
  const visitDate = latestVisit
    ? new Date(latestVisit.createdAt).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
    : null;

  return (
    <div className="grid gap-6 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
      {/* Last Visit Card */}
      <Link href={`/patients/${patient.id}/visit-history`}>
        <Card className="cursor-pointer hover:shadow-md transition-shadow">
          <CardHeader>
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Calendar className="h-5 w-5 text-muted-foreground" />
              Last Visit
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {latestVisit ? (
              <>
                <div>
                  <p className="text-sm font-medium text-foreground">{visitDate}</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {latestVisit.chiefComplaint && latestVisit.chiefComplaint.trim()
                      ? latestVisit.chiefComplaint
                      : "No chief complaint recorded"}
                  </p>
                </div>
                <div>
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className="text-muted-foreground">Visit note progress</span>
                    <span className="font-medium">{visitProgress}%</span>
                  </div>
                  <Progress value={visitProgress} />
                </div>

                {/* Visit Status - Show for nurses */}
                {userRole === "nurse" && (
                  <div className="space-y-2 pt-2 border-t">
                    <div className="flex flex-wrap gap-2">
                      {latestVisit.status && (
                        <Badge variant={latestVisit.status === "In Progress" ? "default" : "outline"}>
                          {latestVisit.status}
                        </Badge>
                      )}
                      {latestVisit.appointmentType && (
                        <Badge
                          variant="default"
                          className={
                            latestVisit.appointmentType.toLowerCase() === "virtual"
                              ? "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500"
                              : "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500"
                          }
                        >
                          {latestVisit.appointmentType}
                        </Badge>
                      )}
                    </div>

                    {/* Virtual Visit Join Button for Nurses */}
                    {isVirtualVisitReady() && (
                      <Button
                        onClick={(e) => {
                          e.preventDefault();
                          setShowVirtualModal(true);
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
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No visits recorded</p>
            )}
          </CardContent>
        </Card>
      </Link>

      {/* Vitals Summary Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Heart className="h-5 w-5 text-muted-foreground" />
            Vitals Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">BP</p>
              <p className="text-sm font-medium">{bp || "--"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">HR</p>
              <p className="text-sm font-medium">{hr ? `${hr} bpm` : "--"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Temp</p>
              <p className="text-sm font-medium">{temp ? `${temp}°F` : "--"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Weight</p>
              <p className="text-sm font-medium">{weight ? `${weight} lbs` : "--"}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Allergies Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold flex items-center justify-between">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-muted-foreground" />
              Allergies
            </span>
            <Badge variant="secondary" className="bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500 dark:border-orange-400">
              {allergies.length} active
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {allergies.length > 0 ? (
            <ul className="space-y-2">
              {allergies.slice(0, 3).map((allergy, index) => (
                <li key={index} className="text-sm text-foreground">
                  {allergy.name || allergy.type || "Unknown allergy"}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No known allergies</p>
          )}
        </CardContent>
      </Card>

      {/* Current Medications Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Pill className="h-5 w-5 text-muted-foreground" />
            Current Medications
          </CardTitle>
        </CardHeader>
        <CardContent>
          {medications.length > 0 ? (
            <ul className="space-y-2">
              {medications.slice(0, 3).map((med, index) => {
                // Get medication display name - prioritize brandName/genericName, fallback to legacy fields
                let medName = "Unknown medication";
                if (med.brandName && med.genericName) {
                  medName = `${med.brandName} (${med.genericName})`;
                } else if (med.brandName) {
                  medName = med.brandName;
                } else if (med.genericName) {
                  medName = med.genericName;
                } else if (med.name) {
                  medName = med.name; // Legacy field
                } else if (med.medication) {
                  medName = med.medication; // Legacy field
                }

                return (
                  <li key={med.id || index} className="text-sm text-foreground">
                    {medName}
                    {med.dosage && (
                      <span className="text-muted-foreground ml-2">({med.dosage})</span>
                    )}
                    {med.frequency && !med.dosage && (
                      <span className="text-muted-foreground ml-2">({med.frequency})</span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No medications recorded</p>
          )}
        </CardContent>
      </Card>

      {/* History Highlights Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <History className="h-5 w-5 text-muted-foreground" />
            History Highlights
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Family History</p>
              <p className="text-lg font-semibold">{familyHistory.length}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Social History</p>
              <p className="text-lg font-semibold">{socialHistory.length}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Surgical History</p>
              <p className="text-lg font-semibold">{surgicalHistory.length}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Past Medical History</p>
              <p className="text-lg font-semibold">{pastMedicalHistory.length}</p>
            </div>
          </div>
          <Separator />
          <div>
            <p className="text-xs text-muted-foreground mb-2">Risk Flags</p>
            {hasRiskFlags ? (
              <div className="flex flex-wrap gap-2">
                {hasHighBP && (
                  <Badge variant="destructive">High BP</Badge>
                )}
                {hasFever && (
                  <Badge variant="destructive">Fever</Badge>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No flags</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Orders & Documents Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <FileText className="h-5 w-5 text-muted-foreground" />
            Orders & Documents
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Orders</p>
              <p className="text-lg font-semibold">{stats.ordersCount}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Documents</p>
              <p className="text-lg font-semibold">{stats.documentsCount}</p>
            </div>
          </div>
          <Separator />
        </CardContent>
      </Card>

      {/* Virtual Visit Modal for Nurses */}
      {showVirtualModal && isVirtualVisitReady() && (
        <Dialog open={showVirtualModal} onOpenChange={setShowVirtualModal}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Virtual Visit - Patient Join Link</DialogTitle>
              <DialogDescription>
                Share this QR code or link with the patient to join the call
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="p-4 bg-white rounded-lg">
                <QRCodeSVG value={getJoinUrl()} size={250} />
              </div>
              <div className="w-full space-y-3">
                <Input value={getJoinUrl()} readOnly className="text-xs" />
                <div className="flex gap-2">
                  <Button
                    onClick={handleCopyLink}
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
                    onClick={handleJoinCall}
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
    </div>
  );
}

