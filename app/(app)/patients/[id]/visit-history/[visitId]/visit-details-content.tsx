"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Edit, FileText, AudioWaveform, File, Clock, User, CheckCircle2, AlertCircle, FileSignature, Eye, Download, Image, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { markVisitInProgressAction, finalizeVisitAction } from "@/app/_actions/visits";
import { getDocumentSignedUrlAction } from "@/app/_actions/documents";
import { cn } from "@/app/_lib/utils/cn";
import Link from "next/link";

interface VisitDetailsContentProps {
  visitId: string;
  patientId: string;
  visit: {
    id: string;
    status: string | null;
    createdAt: Date;
    notesFinalizedBy: string | null;
    notesFinalizedAt: Date | null;
    priority: string | null;
    appointmentType: string | null;
    clinicianId: string | null;
    twilioRoomName: string | null;
  };
  currentUserId: string;
  patient: {
    id: string;
    fullName: string;
    clinicianId: string | null;
  };
  notes: Array<{
    id: string;
    note: unknown;
    content: string | null;
    status: string | null;
    finalizedBy: string | null;
    finalizedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  transcripts: Array<{
    id: string;
    text: string | null;
    rawText: string | null;
    createdAt: Date;
  }>;
  documents: Array<{
    id: string;
    filename: string;
    mimeType: string;
    size: string;
    uploadedAt: Date;
    storageUrl: string;
  }>;
  finalizedByName: string | null;
  auditLogs: Array<{
    timestamp: Date;
    userId: string | null;
    userName: string | null;
    action: string;
    fromStatus: string | null;
    toStatus: string;
    reason?: string;
  }>;
}

export function VisitDetailsContent({
  visitId,
  patientId,
  visit,
  patient,
  notes,
  transcripts,
  documents,
  finalizedByName,
  auditLogs,
  currentUserId,
}: VisitDetailsContentProps) {
  const router = useRouter();
  const [isMarkingInProgress, setIsMarkingInProgress] = React.useState(false);
  const [isSigning, setIsSigning] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState("notes");
  const [previewDocument, setPreviewDocument] = React.useState<typeof documents[0] | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = React.useState(false);
  const [isDownloading, setIsDownloading] = React.useState<string | null>(null);

  const isSigned = visit.status === "Signed & Complete";
  const isInProgress = visit.status === "In Progress";
  const canEdit = isSigned || isInProgress; // Can edit if signed or in progress
  // Match server finalize rules: patient assignee OR visit row clinician
  const canSignNote =
    patient.clinicianId === currentUserId ||
    visit.clinicianId === currentUserId;

  const handleEdit = async () => {
    if (!canEdit) return;

    // If already in progress, just navigate to edit
    if (isInProgress) {
      router.push(`/patients/${patientId}/new-visit?visitId=${visitId}`);
      return;
    }

    // If signed, mark as in progress first
    if (isSigned) {
      setIsMarkingInProgress(true);
      try {
        await markVisitInProgressAction(visitId, "User initiated edit of signed note");
        toast.success("Visit marked as in progress. You can now edit the note.");
        router.push(`/patients/${patientId}/new-visit?visitId=${visitId}`);
      } catch (error) {
        console.error("Error marking visit in progress:", error);
        toast.error("Failed to mark visit as in progress");
      } finally {
        setIsMarkingInProgress(false);
      }
    }
  };

  const handleSign = async () => {
    if (isSigned) return;

    setIsSigning(true);
    try {
      await finalizeVisitAction(visitId, "signed");
      toast.success("Note signed successfully");
      // Refresh the page to show updated status
      router.refresh();
    } catch (error) {
      console.error("Error signing note:", error);
      toast.error("Failed to sign note");
    } finally {
      setIsSigning(false);
    }
  };

  const formatDateTime = (date: Date | string | null) => {
    if (!date) return "—";
    const d = new Date(date);
    return d.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

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
    return { variant: "outline" as const, className: "" };
  };

  const getActionIcon = (action: string) => {
    switch (action) {
      case "finalized":
      case "signed":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "edited_after_signing":
        return <AlertCircle className="h-4 w-4 text-orange-500" />;
      case "sent_to_waiting_room":
        return <Clock className="h-4 w-4 text-blue-500" />;
      case "assigned_to_me":
        return <User className="h-4 w-4 text-purple-500" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const formatActionName = (action: string) => {
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
  };

  const formatStatus = (status: string | null) => {
    if (!status) return "—";
    const statusLower = status.toLowerCase();
    // Map old status values to new ones
    if (statusLower === "finalized" || statusLower === "signed" || statusLower === "completed") {
      return "Signed & Complete";
    }
    if (statusLower === "draft" || statusLower === "in_progress" || statusLower === "in progress") {
      return "In Progress";
    }
    return status;
  };

  // Parse note content
  const noteData = notes[0]?.note as any;
  const noteContent = notes[0]?.content;

  // Deduplicate documents - remove duplicates by ID, storageUrl, or filename+size combination
  // Use a Map to track seen documents for better performance
  const uniqueDocuments = React.useMemo(() => {
    const seen = new Map<string, boolean>();

    return documents.filter((doc) => {
      // Create unique keys for checking duplicates
      const idKey = `id:${doc.id}`;
      const storageKey = doc.storageUrl ? `storage:${doc.storageUrl}` : null;
      const fileKey = `file:${doc.filename}:${doc.size}`;

      // Check if we've seen this document by any identifier
      if (seen.has(idKey) || (storageKey && seen.has(storageKey)) || seen.has(fileKey)) {
        return false;
      }

      // Mark all identifiers as seen
      seen.set(idKey, true);
      if (storageKey) {
        seen.set(storageKey, true);
      }
      seen.set(fileKey, true);

      return true;
    });
  }, [documents]);

  const handlePreview = async (doc: typeof documents[0]) => {
    setIsLoadingPreview(true);
    setPreviewDocument(doc);
    try {
      const result = await getDocumentSignedUrlAction(doc.storageUrl);
      if (!result.success || !result.signedUrl) {
        throw new Error(result.error || "Failed to get preview URL");
      }
      setPreviewUrl(result.signedUrl);
    } catch (error) {
      console.error("Error loading preview:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to load preview"
      );
      setPreviewDocument(null);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleDownload = async (doc: typeof documents[0]) => {
    setIsDownloading(doc.id);
    try {
      const result = await getDocumentSignedUrlAction(doc.storageUrl);
      if (!result.success || !result.signedUrl) {
        throw new Error(result.error || "Failed to get download URL");
      }

      // Open in new tab for viewing/downloading
      window.open(result.signedUrl, "_blank");
      toast.success("Opening document...");
    } catch (error) {
      console.error("Error downloading document:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to download document"
      );
    } finally {
      setIsDownloading(null);
    }
  };

  const handleClosePreview = () => {
    setPreviewDocument(null);
    setPreviewUrl(null);
  };

  const canPreview = (mimeType: string) => {
    return mimeType.startsWith("image/") || mimeType === "application/pdf";
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith("image/")) {
      return <Image className="h-5 w-5" />;
    }
    if (mimeType === "application/pdf") {
      return <FileText className="h-5 w-5" />;
    }
    return <File className="h-5 w-5" />;
  };

  const formatFileSize = (size: string | number) => {
    const bytes = typeof size === "string" ? parseInt(size, 10) : size;
    if (isNaN(bytes)) return "Unknown size";

    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={`/patients/${patientId}/visit-history`}>
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-foreground">Visit Details</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {patient.fullName} • {formatDateTime(visit.createdAt)}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {/* Join Call button for virtual visits */}
          {visit.appointmentType?.toLowerCase() === "virtual" && visit.twilioRoomName && (
            <Button
              onClick={() => router.push(`/visit/${visitId}/call`)}
              variant="default"
              className="bg-purple-600 hover:bg-purple-700"
            >
              <Video className="h-4 w-4 mr-2" />
              Join Call
            </Button>
          )}
          {canEdit && (
            <Button onClick={handleEdit} disabled={isMarkingInProgress}>
              <Edit className="h-4 w-4 mr-2" />
              {isMarkingInProgress ? "Processing..." : "Edit Note"}
            </Button>
          )}
          {isInProgress && !isSigned && canSignNote && (
            <Button onClick={handleSign} disabled={isSigning} variant="default">
              <FileSignature className="h-4 w-4 mr-2" />
              {isSigning ? "Signing..." : "Sign Note"}
            </Button>
          )}
        </div>
      </div>

      {/* Status Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Visit Status</CardTitle>
        </CardHeader>
        <CardContent>
          {(() => {
            const badge = getStatusBadge(visit.status);
            return (
              <Badge variant={badge.variant} className={badge.className}>
                {visit.status || "—"}
              </Badge>
            );
          })()}
          {finalizedByName && visit.notesFinalizedAt && (
            <div className="mt-3 text-sm text-muted-foreground">
              <div>Finalized by {finalizedByName}</div>
              <div>{formatDateTime(visit.notesFinalizedAt)}</div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="notes">
            <FileText className="h-4 w-4 mr-2" />
            Notes
          </TabsTrigger>
          <TabsTrigger value="transcripts">
            <AudioWaveform className="h-4 w-4 mr-2" />
            Transcripts ({transcripts.length})
          </TabsTrigger>
          <TabsTrigger value="documents">
            <File className="h-4 w-4 mr-2" />
            Documents ({uniqueDocuments.length})
          </TabsTrigger>
          <TabsTrigger value="audit">
            <Clock className="h-4 w-4 mr-2" />
            Audit Log ({auditLogs.length})
          </TabsTrigger>
        </TabsList>

        {/* Notes Tab */}
        <TabsContent value="notes" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Visit Notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {noteData ? (
                <div className="space-y-6">
                  {noteData.subjective && (
                    <div>
                      <h3 className="font-semibold mb-2">Subjective</h3>
                      <div className="space-y-2 text-sm">
                        {noteData.subjective.chiefComplaint && (
                          <div>
                            <span className="font-medium">Chief Complaint: </span>
                            {noteData.subjective.chiefComplaint}
                          </div>
                        )}
                        {noteData.subjective.hpi && (
                          <div>
                            <span className="font-medium">HPI: </span>
                            {noteData.subjective.hpi}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {noteData.objective && (
                    <div>
                      <h3 className="font-semibold mb-2">Objective</h3>
                      <div className="grid gap-2 md:grid-cols-2 text-sm">
                        {Object.entries(noteData.objective).map(([key, value]) => {
                          if (!value || value === "") return null;
                          return (
                            <div key={key}>
                              <span className="font-medium capitalize">
                                {key.replace(/([A-Z])/g, " $1").trim()}:{" "}
                              </span>
                              {String(value)}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {noteData.assessmentPlan && (
                    <div>
                      <h3 className="font-semibold mb-2">Assessment & Plan</h3>
                      <div className="space-y-4 text-sm">
                        {Array.isArray(noteData.assessmentPlan) ? (
                          // New format: array of detailed assessment-plan entries
                          noteData.assessmentPlan.map((item: any, index: number) => (
                            <div key={index} className="space-y-2 pb-3 border-b last:border-b-0 last:pb-0">
                              {item.assessment && (
                                <div>
                                  <span className="font-medium">Assessment: </span>
                                  <div className="mt-1 whitespace-pre-wrap">{item.assessment}</div>
                                </div>
                              )}
                              {item.plan && (
                                <div>
                                  <span className="font-medium">Plan: </span>
                                  <div className="mt-1 whitespace-pre-wrap">{item.plan}</div>
                                </div>
                              )}
                              {item.medications && Array.isArray(item.medications) && item.medications.length > 0 && (
                                <div>
                                  <span className="font-medium">Medications: </span>
                                  <div className="mt-1 space-y-1">
                                    {item.medications.map((med: any, medIndex: number) => (
                                      <div key={medIndex} className="pl-2">
                                        {med.brandName} {med.dosage && med.dosage} {med.frequency && med.frequency}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {item.orders && Array.isArray(item.orders) && item.orders.length > 0 ? (
                                <div>
                                  <span className="font-medium">Orders: </span>
                                  <div className="mt-1 space-y-1">
                                    {item.orders.map((order: any, orderIndex: number) => (
                                      <div key={orderIndex} className="pl-2">
                                        {order.details || "None"}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                <div>
                                  <span className="font-medium">Orders: </span>
                                  <span className="text-muted-foreground">None</span>
                                </div>
                              )}
                              {item.followUp && (
                                <div>
                                  <span className="font-medium">Follow-up: </span>
                                  <div className="mt-1 whitespace-pre-wrap">{item.followUp}</div>
                                </div>
                              )}
                              {item.education && (
                                <div>
                                  <span className="font-medium">Education: </span>
                                  <div className="mt-1 whitespace-pre-wrap">{item.education}</div>
                                </div>
                              )}
                              {item.coordination && (
                                <div>
                                  <span className="font-medium">Coordination: </span>
                                  <div className="mt-1 whitespace-pre-wrap">{item.coordination}</div>
                                </div>
                              )}
                            </div>
                          ))
                        ) : (
                          // Backward compatibility: old format
                          <>
                            {noteData.assessmentPlan.assessment && (
                              <div>
                                <span className="font-medium">Assessment: </span>
                                <div className="mt-1 whitespace-pre-wrap">{noteData.assessmentPlan.assessment}</div>
                              </div>
                            )}
                            {noteData.assessmentPlan.plan && (
                              <div>
                                <span className="font-medium">Plan: </span>
                                <div className="mt-1 whitespace-pre-wrap">{noteData.assessmentPlan.plan}</div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {noteData && (
                    <div>
                      <Separator className="my-4" />
                      <h3 className="font-semibold mb-4">All Data</h3>
                      <div className="space-y-4">
                        {/* Subjective */}
                        {noteData.subjective && (noteData.subjective.chiefComplaint || noteData.subjective.hpi) && (
                          <Card>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-base">Subjective</CardTitle>
                            </CardHeader>
                            <CardContent className="pt-0 space-y-2 text-sm">
                              {noteData.subjective.chiefComplaint && (
                                <div>
                                  <span className="font-medium">Chief Complaint: </span>
                                  <span>{noteData.subjective.chiefComplaint}</span>
                                </div>
                              )}
                              {noteData.subjective.hpi && (
                                <div>
                                  <span className="font-medium">HPI: </span>
                                  <span>{noteData.subjective.hpi}</span>
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        )}

                        {/* Objective */}
                        {noteData.objective && Object.values(noteData.objective).some((v: any) => v && v !== "") && (
                          <Card>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-base">Objective</CardTitle>
                            </CardHeader>
                            <CardContent className="pt-0">
                              <div className="grid gap-2 md:grid-cols-2 text-sm">
                                {noteData.objective.bp && (
                                  <div><span className="font-medium">Blood Pressure: </span>{noteData.objective.bp}</div>
                                )}
                                {noteData.objective.hr && (
                                  <div><span className="font-medium">Heart Rate: </span>{noteData.objective.hr}</div>
                                )}
                                {noteData.objective.temp && (
                                  <div><span className="font-medium">Temperature: </span>{noteData.objective.temp}</div>
                                )}
                                {noteData.objective.weight && (
                                  <div><span className="font-medium">Weight: </span>{noteData.objective.weight} lbs</div>
                                )}
                                {noteData.objective.height && (
                                  <div><span className="font-medium">Height: </span>{noteData.objective.height} cm</div>
                                )}
                                {noteData.objective.examFindings && (
                                  <div className="md:col-span-2 space-y-3">
                                    <div className="font-medium text-base border-b pb-1">Physical Examination</div>
                                    {typeof noteData.objective.examFindings === "string" ? (
                                      // Backward compatibility: if it's a string, display as before
                                      <div>
                                        <span className="font-medium">Exam Findings: </span>
                                        {noteData.objective.examFindings}
                                      </div>
                                    ) : (
                                      // New format: display by category
                                      <div className="grid gap-3 md:grid-cols-2 text-sm">
                                        {[
                                          { key: "general", label: "General" },
                                          { key: "heent", label: "HEENT" },
                                          { key: "neck", label: "Neck" },
                                          { key: "cardiovascular", label: "Cardiovascular" },
                                          { key: "lungs", label: "Lungs" },
                                          { key: "abdomen", label: "Abdomen" },
                                          { key: "musculoskeletal", label: "Musculoskeletal" },
                                          { key: "neurologic", label: "Neurologic" },
                                          { key: "skin", label: "Skin" },
                                          { key: "psychological", label: "Psychological" },
                                        ].map((category) => {
                                          const value = noteData.objective.examFindings?.[category.key as keyof typeof noteData.objective.examFindings];
                                          return value && value !== "" ? (
                                            <div key={category.key} className="space-y-1">
                                              <div className="font-medium text-foreground">{category.label}:</div>
                                              <div className="text-muted-foreground pl-2 whitespace-pre-wrap">{value}</div>
                                            </div>
                                          ) : null;
                                        })}
                                      </div>
                                    )}
                                  </div>
                                )}
                                {(noteData.objective.visionOd || noteData.objective.visionOs || noteData.objective.visionOu) && (
                                  <div className="md:col-span-2 space-y-1">
                                    <div className="font-medium">Vision:</div>
                                    {noteData.objective.visionOd && <div className="pl-4">OD: {noteData.objective.visionOd}</div>}
                                    {noteData.objective.visionOs && <div className="pl-4">OS: {noteData.objective.visionOs}</div>}
                                    {noteData.objective.visionOu && <div className="pl-4">OU: {noteData.objective.visionOu}</div>}
                                    {noteData.objective.visionCorrection && <div className="pl-4">Correction: {noteData.objective.visionCorrection}</div>}
                                    {noteData.objective.visionBlurry && <div className="pl-4">Blurry: {noteData.objective.visionBlurry}</div>}
                                    {noteData.objective.visionFloaters && <div className="pl-4">Floaters: {noteData.objective.visionFloaters}</div>}
                                    {noteData.objective.visionPain && <div className="pl-4">Pain: {noteData.objective.visionPain}</div>}
                                    {noteData.objective.visionLastExamDate && <div className="pl-4">Last Exam Date: {noteData.objective.visionLastExamDate}</div>}
                                  </div>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        )}

                        {/* Point of Care */}
                        {noteData.pointOfCare && (
                          (noteData.pointOfCare.diabetes && Object.values(noteData.pointOfCare.diabetes).some((v: any) => v && v !== "")) ||
                          (noteData.pointOfCare.hiv && noteData.pointOfCare.hiv !== "") ||
                          (noteData.pointOfCare.syphilis && (noteData.pointOfCare.syphilis.result || noteData.pointOfCare.syphilis.reactivity))
                        ) && (
                            <Card>
                              <CardHeader className="pb-2">
                                <CardTitle className="text-base">Point of Care</CardTitle>
                              </CardHeader>
                              <CardContent className="pt-0 space-y-6">
                                {/* Diabetes Subsection */}
                                {noteData.pointOfCare.diabetes && Object.values(noteData.pointOfCare.diabetes).some((v: any) => v && v !== "") && (
                                  <div className="space-y-3">
                                    <h4 className="text-sm font-semibold text-foreground border-b pb-1">Diabetes</h4>
                                    <div className="grid gap-2 md:grid-cols-2 text-sm">
                                      {noteData.pointOfCare.diabetes.fastingGlucose && (
                                        <div><span className="font-medium">Fasting Glucose: </span>{noteData.pointOfCare.diabetes.fastingGlucose}</div>
                                      )}
                                      {noteData.pointOfCare.diabetes.randomGlucose && (
                                        <div><span className="font-medium">Random Glucose: </span>{noteData.pointOfCare.diabetes.randomGlucose}</div>
                                      )}
                                      {noteData.pointOfCare.diabetes.hbA1cValue && (
                                        <div>
                                          <span className="font-medium">HbA1c: </span>
                                          {noteData.pointOfCare.diabetes.hbA1cValue}
                                          {noteData.pointOfCare.diabetes.hbA1cDate && <span className="text-muted-foreground"> ({noteData.pointOfCare.diabetes.hbA1cDate})</span>}
                                        </div>
                                      )}
                                      {noteData.pointOfCare.diabetes.homeMonitoring && (
                                        <div><span className="font-medium">Home Monitoring: </span>{noteData.pointOfCare.diabetes.homeMonitoring}</div>
                                      )}
                                      {noteData.pointOfCare.diabetes.averageReadings && (
                                        <div><span className="font-medium">Average Readings: </span>{noteData.pointOfCare.diabetes.averageReadings}</div>
                                      )}
                                      {noteData.pointOfCare.diabetes.hypoglycemiaEpisodes && (
                                        <div><span className="font-medium">Hypoglycemia Episodes: </span>{noteData.pointOfCare.diabetes.hypoglycemiaEpisodes}</div>
                                      )}
                                      {noteData.pointOfCare.diabetes.hyperglycemiaSymptoms && (
                                        <div><span className="font-medium">Hyperglycemia Symptoms: </span>{noteData.pointOfCare.diabetes.hyperglycemiaSymptoms}</div>
                                      )}
                                      {noteData.pointOfCare.diabetes.footExam && (
                                        <div><span className="font-medium">Foot Exam: </span>{noteData.pointOfCare.diabetes.footExam}</div>
                                      )}
                                      {noteData.pointOfCare.diabetes.eyeExamDue && (
                                        <div><span className="font-medium">Eye Exam Due: </span>{noteData.pointOfCare.diabetes.eyeExamDue}</div>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {/* HIV Subsection */}
                                {noteData.pointOfCare.hiv && noteData.pointOfCare.hiv !== "" && (
                                  <div className="space-y-3">
                                    <h4 className="text-sm font-semibold text-foreground border-b pb-1">HIV</h4>
                                    <div className="grid gap-2 md:grid-cols-2 text-sm">
                                      <div><span className="font-medium">Result: </span>{noteData.pointOfCare.hiv}</div>
                                    </div>
                                  </div>
                                )}

                                {/* Syphilis Subsection */}
                                {noteData.pointOfCare.syphilis && (noteData.pointOfCare.syphilis.result || noteData.pointOfCare.syphilis.reactivity) && (
                                  <div className="space-y-3">
                                    <h4 className="text-sm font-semibold text-foreground border-b pb-1">Syphilis</h4>
                                    <div className="grid gap-2 md:grid-cols-2 text-sm">
                                      {noteData.pointOfCare.syphilis.result && (
                                        <div><span className="font-medium">Result: </span>{noteData.pointOfCare.syphilis.result}</div>
                                      )}
                                      {noteData.pointOfCare.syphilis.reactivity && (
                                        <div><span className="font-medium">Reactivity: </span>{noteData.pointOfCare.syphilis.reactivity}</div>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </CardContent>
                            </Card>
                          )}

                        {/* Medications */}
                        {noteData.medications && Array.isArray(noteData.medications) && noteData.medications.length > 0 && (
                          <Card>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-base">Medications ({noteData.medications.length})</CardTitle>
                            </CardHeader>
                            <CardContent className="pt-0 space-y-4">
                              {noteData.medications.map((med: any, index: number) => (
                                <div key={index} className="border-l-2 pl-4 space-y-1 text-sm">
                                  {med.name && <div className="font-medium">{med.name}</div>}
                                  {med.dosage && <div className="text-muted-foreground">Dosage: {med.dosage}</div>}
                                  <div className="flex gap-4 text-muted-foreground">
                                    <span>Taking as Prescribed: {med.takingAsPrescribed ? "Yes" : "No"}</span>
                                    <span>Missed Doses: {med.missedDoses ? "Yes" : "No"}</span>
                                    <span>Side Effects: {med.sideEffects ? "Yes" : "No"}</span>
                                  </div>
                                  {med.sideEffectsNotes && (
                                    <div className="text-muted-foreground">Side Effects Notes: {med.sideEffectsNotes}</div>
                                  )}
                                </div>
                              ))}
                            </CardContent>
                          </Card>
                        )}

                        {/* Assessment & Plan */}
                        {noteData.assessmentPlan && (
                          (Array.isArray(noteData.assessmentPlan) && noteData.assessmentPlan.length > 0) ||
                          (typeof noteData.assessmentPlan === "object" && (noteData.assessmentPlan.assessment || noteData.assessmentPlan.plan))
                        ) && (
                            <Card>
                              <CardHeader className="pb-2">
                                <CardTitle className="text-base">Assessment & Plan</CardTitle>
                              </CardHeader>
                              <CardContent className="pt-0 space-y-4 text-sm">
                                {Array.isArray(noteData.assessmentPlan) ? (
                                  // New format: array of detailed assessment-plan entries
                                  noteData.assessmentPlan.map((item: any, index: number) => (
                                    <div key={index} className="space-y-3 pb-4 border-b last:border-b-0 last:pb-0">
                                      {item.assessment && (
                                        <div>
                                          <span className="font-medium">Assessment: </span>
                                          <div className="mt-1 whitespace-pre-wrap">{item.assessment}</div>
                                        </div>
                                      )}
                                      {item.plan && (
                                        <div>
                                          <span className="font-medium">Plan: </span>
                                          <div className="mt-1 whitespace-pre-wrap">{item.plan}</div>
                                        </div>
                                      )}
                                      {item.medications && Array.isArray(item.medications) && item.medications.length > 0 && (
                                        <div>
                                          <span className="font-medium">Medications: </span>
                                          <div className="mt-1 space-y-1">
                                            {item.medications.map((med: any, medIndex: number) => (
                                              <div key={medIndex} className="pl-2">
                                                {med.brandName} {med.dosage && med.dosage} {med.frequency && med.frequency}
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                      {item.orders && Array.isArray(item.orders) && item.orders.length > 0 ? (
                                        <div>
                                          <span className="font-medium">Orders: </span>
                                          <div className="mt-1 space-y-1">
                                            {item.orders.map((order: any, orderIndex: number) => (
                                              <div key={orderIndex} className="pl-2">
                                                {order.details || "None"}
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      ) : (
                                        <div>
                                          <span className="font-medium">Orders: </span>
                                          <span className="text-muted-foreground">None</span>
                                        </div>
                                      )}
                                      {item.followUp && (
                                        <div>
                                          <span className="font-medium">Follow-up: </span>
                                          <div className="mt-1 whitespace-pre-wrap">{item.followUp}</div>
                                        </div>
                                      )}
                                      {item.education && (
                                        <div>
                                          <span className="font-medium">Education: </span>
                                          <div className="mt-1 whitespace-pre-wrap">{item.education}</div>
                                        </div>
                                      )}
                                      {item.coordination && (
                                        <div>
                                          <span className="font-medium">Coordination: </span>
                                          <div className="mt-1 whitespace-pre-wrap">{item.coordination}</div>
                                        </div>
                                      )}
                                    </div>
                                  ))
                                ) : (
                                  // Backward compatibility: old format (object with assessment/plan)
                                  <>
                                    {noteData.assessmentPlan.assessment && (
                                      <div>
                                        <span className="font-medium">Assessment: </span>
                                        <div className="mt-1 whitespace-pre-wrap">{noteData.assessmentPlan.assessment}</div>
                                      </div>
                                    )}
                                    {noteData.assessmentPlan.plan && (
                                      <div>
                                        <span className="font-medium">Plan: </span>
                                        <div className="mt-1 whitespace-pre-wrap">{noteData.assessmentPlan.plan}</div>
                                      </div>
                                    )}
                                  </>
                                )}
                              </CardContent>
                            </Card>
                          )}

                        {/* Vaccines */}
                        {noteData.vaccines && Array.isArray(noteData.vaccines) && noteData.vaccines.length > 0 && (
                          <Card>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-base">Vaccines ({noteData.vaccines.length})</CardTitle>
                            </CardHeader>
                            <CardContent className="pt-0 space-y-3">
                              {noteData.vaccines.map((vaccine: any, index: number) => (
                                <div key={index} className="border-l-2 pl-4 space-y-1 text-sm">
                                  {vaccine.name && <div className="font-medium">{vaccine.name}</div>}
                                  <div className="grid gap-1 md:grid-cols-2 text-muted-foreground">
                                    {vaccine.date && <div>Date: {vaccine.date}</div>}
                                    {vaccine.dose && <div>Dose: {vaccine.dose}</div>}
                                    {vaccine.site && <div>Site: {vaccine.site}</div>}
                                    {vaccine.route && <div>Route: {vaccine.route}</div>}
                                    {vaccine.lotNumber && <div>Lot Number: {vaccine.lotNumber}</div>}
                                    {vaccine.manufacturer && <div>Manufacturer: {vaccine.manufacturer}</div>}
                                  </div>
                                </div>
                              ))}
                            </CardContent>
                          </Card>
                        )}

                        {/* Family History */}
                        {noteData.familyHistory && Array.isArray(noteData.familyHistory) && noteData.familyHistory.length > 0 && (
                          <Card>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-base">Family History ({noteData.familyHistory.length})</CardTitle>
                            </CardHeader>
                            <CardContent className="pt-0 space-y-3">
                              {noteData.familyHistory.map((fh: any, index: number) => (
                                <div key={index} className="border-l-2 pl-4 space-y-1 text-sm">
                                  {fh.relationship && <div className="font-medium">{fh.relationship}</div>}
                                  <div className="text-muted-foreground">
                                    {fh.status && <span>Status: {fh.status}</span>}
                                    {fh.conditions && <span className="ml-4">Conditions: {fh.conditions}</span>}
                                  </div>
                                </div>
                              ))}
                            </CardContent>
                          </Card>
                        )}

                        {/* Risk Flags */}
                        {noteData.riskFlags && Object.values(noteData.riskFlags).some((v: any) => v && v !== "") && (
                          <Card>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-base">Risk Flags</CardTitle>
                            </CardHeader>
                            <CardContent className="pt-0">
                              <div className="grid gap-2 md:grid-cols-2 text-sm">
                                {noteData.riskFlags.tobaccoUse && (
                                  <div><span className="font-medium">Tobacco Use: </span>{noteData.riskFlags.tobaccoUse}</div>
                                )}
                                {noteData.riskFlags.tobaccoAmount && (
                                  <div><span className="font-medium">Tobacco Amount: </span>{noteData.riskFlags.tobaccoAmount}</div>
                                )}
                                {noteData.riskFlags.alcoholUse && (
                                  <div><span className="font-medium">Alcohol Use: </span>{noteData.riskFlags.alcoholUse}</div>
                                )}
                                {noteData.riskFlags.alcoholFrequency && (
                                  <div><span className="font-medium">Alcohol Frequency: </span>{noteData.riskFlags.alcoholFrequency}</div>
                                )}
                                {noteData.riskFlags.housingStatus && (
                                  <div><span className="font-medium">Housing Status: </span>{noteData.riskFlags.housingStatus}</div>
                                )}
                                {noteData.riskFlags.occupation && (
                                  <div><span className="font-medium">Occupation: </span>{noteData.riskFlags.occupation}</div>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        )}

                        {/* Surgical History */}
                        {noteData.surgicalHistory && Array.isArray(noteData.surgicalHistory) && noteData.surgicalHistory.length > 0 && (
                          <Card>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-base">Surgical History ({noteData.surgicalHistory.length})</CardTitle>
                            </CardHeader>
                            <CardContent className="pt-0 space-y-3">
                              {noteData.surgicalHistory.map((surg: any, index: number) => (
                                <div key={index} className="border-l-2 pl-4 space-y-1 text-sm">
                                  {surg.procedure && <div className="font-medium">{surg.procedure}</div>}
                                  <div className="grid gap-1 md:grid-cols-2 text-muted-foreground">
                                    {surg.date && <div>Date: {surg.date}</div>}
                                    {surg.site && <div>Site: {surg.site}</div>}
                                    {surg.surgeon && <div>Surgeon: {surg.surgeon}</div>}
                                    {surg.outcome && <div>Outcome: {surg.outcome}</div>}
                                    {surg.source && <div className="md:col-span-2">Source: {surg.source}</div>}
                                  </div>
                                </div>
                              ))}
                            </CardContent>
                          </Card>
                        )}

                        {/* Past Medical History */}
                        {noteData.pastMedicalHistory && Array.isArray(noteData.pastMedicalHistory) && noteData.pastMedicalHistory.length > 0 && (
                          <Card>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-base">Past Medical History ({noteData.pastMedicalHistory.length})</CardTitle>
                            </CardHeader>
                            <CardContent className="pt-0 space-y-3">
                              {noteData.pastMedicalHistory.map((pmh: any, index: number) => (
                                <div key={index} className="border-l-2 pl-4 space-y-1 text-sm">
                                  {pmh.condition && <div className="font-medium">{pmh.condition}</div>}
                                  <div className="grid gap-1 md:grid-cols-2 text-muted-foreground">
                                    {pmh.status && <div>Status: {pmh.status}</div>}
                                    {pmh.diagnosedDate && <div>Diagnosed Date: {pmh.diagnosedDate}</div>}
                                    {pmh.impact && <div>Impact: {pmh.impact}</div>}
                                    {pmh.icd10 && <div>ICD-10: {pmh.icd10}</div>}
                                    {pmh.source && <div className="md:col-span-2">Source: {pmh.source}</div>}
                                  </div>
                                </div>
                              ))}
                            </CardContent>
                          </Card>
                        )}

                        {/* Orders */}
                        {noteData.orders && Array.isArray(noteData.orders) && noteData.orders.length > 0 && (
                          <Card>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-base">Orders ({noteData.orders.length})</CardTitle>
                            </CardHeader>
                            <CardContent className="pt-0 space-y-3">
                              {noteData.orders.map((order: any, index: number) => (
                                <div key={index} className="border-l-2 pl-4 space-y-1 text-sm">
                                  {order.type && <div className="font-medium">{order.type}</div>}
                                  <div className="grid gap-1 md:grid-cols-2 text-muted-foreground">
                                    {order.priority && <div>Priority: {order.priority}</div>}
                                    {order.status && <div>Status: {order.status}</div>}
                                    {order.dateOrdered && <div>Date Ordered: {order.dateOrdered}</div>}
                                    {order.details && <div className="md:col-span-2">Details: {order.details}</div>}
                                  </div>
                                </div>
                              ))}
                            </CardContent>
                          </Card>
                        )}

                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground">No notes available</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Transcripts Tab */}
        <TabsContent value="transcripts" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Transcripts</CardTitle>
            </CardHeader>
            <CardContent>
              {transcripts.length > 0 ? (
                <div className="space-y-4">
                  {transcripts.map((transcript, index) => (
                    <div key={transcript.id} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium">
                          Transcript {index + 1}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(transcript.createdAt)}
                        </span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap">
                        {transcript.text || transcript.rawText || "No transcript text"}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">No transcripts available</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Documents Tab */}
        <TabsContent value="documents" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Documents</CardTitle>
            </CardHeader>
            <CardContent>
              {uniqueDocuments.length > 0 ? (
                <div className="space-y-2">
                  {uniqueDocuments.map((doc) => (
                    <div
                      key={doc.id}
                      className={cn(
                        "flex items-center justify-between border rounded-lg p-4 transition-colors",
                        canPreview(doc.mimeType) && "hover:bg-accent/50 cursor-pointer"
                      )}
                      onClick={() => canPreview(doc.mimeType) && handlePreview(doc)}
                    >
                      <div className="flex items-center gap-3 flex-1">
                        <div className="text-muted-foreground">
                          {getFileIcon(doc.mimeType)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{doc.filename}</div>
                          <div className="text-sm text-muted-foreground">
                            {doc.mimeType} • {formatFileSize(doc.size)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-xs text-muted-foreground">
                          {formatDateTime(doc.uploadedAt)}
                        </div>
                        {canPreview(doc.mimeType) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePreview(doc);
                            }}
                            disabled={isLoadingPreview && previewDocument?.id === doc.id}
                            title="Preview"
                          >
                            {isLoadingPreview && previewDocument?.id === doc.id ? (
                              <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownload(doc);
                          }}
                          disabled={isDownloading === doc.id}
                          title="Download"
                        >
                          {isDownloading === doc.id ? (
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                          ) : (
                            <Download className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">No documents available</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Audit Log Tab */}
        <TabsContent value="audit" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Audit Log</CardTitle>
            </CardHeader>
            <CardContent>
              {auditLogs.length > 0 ? (
                <div className="space-y-4">
                  {auditLogs.map((log, index) => (
                    <div key={index} className="flex gap-4 border-l-2 pl-4 py-2">
                      <div className="flex-shrink-0 mt-1">
                        {getActionIcon(log.action)}
                      </div>
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {formatActionName(log.action)}
                          </span>
                          {log.fromStatus && (
                            <>
                              <span className="text-muted-foreground">→</span>
                              <Badge variant="outline" className="text-xs">
                                {formatStatus(log.fromStatus)}
                              </Badge>
                              <span className="text-muted-foreground">→</span>
                            </>
                          )}
                          {(() => {
                            const badge = getStatusBadge(log.toStatus);
                            return (
                              <Badge variant={badge.variant} className={cn("text-xs", badge.className)}>
                                {formatStatus(log.toStatus)}
                              </Badge>
                            );
                          })()}
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {log.userName || log.userId || "Unknown"}
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDateTime(log.timestamp)}
                          </div>
                        </div>
                        {log.reason && (
                          <div className="text-sm text-muted-foreground italic">
                            Reason: {log.reason}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">No audit log entries</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Document Preview Dialog */}
      {previewDocument && (
        <Dialog open={!!previewDocument} onOpenChange={handleClosePreview}>
          <DialogContent className="max-w-4xl max-h-[90vh]">
            <DialogHeader>
              <DialogTitle>{previewDocument.filename}</DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-auto">
              {previewUrl ? (
                previewDocument.mimeType.startsWith("image/") ? (
                  <div className="flex items-center justify-center w-full">
                    <img
                      src={previewUrl}
                      alt={previewDocument.filename}
                      className="max-w-full max-h-[70vh] object-contain rounded-lg"
                    />
                  </div>
                ) : previewDocument.mimeType === "application/pdf" ? (
                  <div className="w-full h-full min-h-[600px]">
                    <iframe
                      src={previewUrl}
                      className="w-full h-full min-h-[600px] border-0 rounded-lg"
                      title={previewDocument.filename}
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full min-h-[400px]">
                    <div className="text-center">
                      <File className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                      <p className="text-muted-foreground mb-4">
                        Preview not available for this file type
                      </p>
                      <Button onClick={() => handleDownload(previewDocument)}>
                        <Download className="h-4 w-4 mr-2" />
                        Download to View
                      </Button>
                    </div>
                  </div>
                )
              ) : (
                <div className="flex items-center justify-center h-full min-h-[400px]">
                  <div className="text-center">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-current border-t-transparent mx-auto mb-4" />
                    <p className="text-muted-foreground">Loading preview...</p>
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

