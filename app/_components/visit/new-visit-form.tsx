"use client";

import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Save, CheckCircle2, ChevronLeft, ChevronRight, Plus, Pencil, Trash2, CheckCircle, AlertCircle, XCircle, Camera, X, Loader2, User, Clock, FileSignature, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { SectionStepper, visitSections, getSectionsForRole } from "./section-stepper";
import { AICapturePanel } from "./ai-capture-panel";
import { OfflineSyncBadge } from "./offline-sync-badge";
import { MedicalInfoPanel } from "./medical-info-panel";
import { visitNoteSchema, type VisitNote, createEmptyVisitNote, parseVisitNote } from "@/app/_lib/visit-note/schema";
import { preloadLamejs } from "@/app/_lib/utils/audioConverter";
import type { z } from "zod";
import { mergeVisitNote } from "@/app/_lib/visit-note/merge-with-conflicts";
import { loadDraft, saveDraft, getReviewedSections, clearDraft } from "@/app/_lib/offline/draft";
import { createVisitDraftAction, updateVisitDraftAction, finalizeVisitAction, updatePatientAssignedAction, saveTranscriptAction } from "@/app/_actions/visits";
import { createDocumentAction } from "@/app/_actions/documents";
import { cn } from "@/app/_lib/utils/cn";
import type { PatientBasics } from "@/app/_lib/db/drizzle/queries/patient";

interface NewVisitFormProps {
  patientId: string;
  patientBasics: PatientBasics;
  userId: string;
  userRole: string;
  existingVisitId?: string;
  existingVisitData?: unknown;
  isRecording?: boolean;
  onStartRecording?: () => void;
  onStopRecording?: () => void;
  hideAICapture?: boolean;
  initialParsedData?: any;
  onParseReadyRef?: React.MutableRefObject<((parsed: any) => void) | null>;
  onSaveReadyRef?: React.MutableRefObject<(() => Promise<void>) | null>;
  isInVideoCall?: boolean; // Flag to indicate if form is in video call context
  visitAppointmentType?: string | null; // Appointment type for virtual visit detection
  visitTwilioRoomName?: string | null; // Twilio room name for joining calls
}


export function NewVisitForm({
  patientId,
  patientBasics,
  userId,
  userRole,
  existingVisitId,
  existingVisitData,
  isRecording = false,
  onStartRecording,
  onStopRecording,
  hideAICapture = false,
  initialParsedData,
  onParseReadyRef,
  onSaveReadyRef,
  isInVideoCall = false,
  visitAppointmentType,
  visitTwilioRoomName,
}: NewVisitFormProps) {
  const router = useRouter();
  // Get sections based on role
  const roleSections = React.useMemo(() => getSectionsForRole(userRole), [userRole]);
  const [currentSection, setCurrentSection] = React.useState(roleSections[0].id);
  const [reviewedSections, setReviewedSections] = React.useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = React.useState<Set<string>>(new Set());
  const [medicalPanelOpen, setMedicalPanelOpen] = React.useState(false);
  const [medicalPanelSection, setMedicalPanelSection] = React.useState<string | null>(null);
  const [isOnline, setIsOnline] = React.useState(navigator.onLine);
  const [pendingCount, setPendingCount] = React.useState(0);
  const [isSyncing, setIsSyncing] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [visitIdRemote, setVisitIdRemote] = React.useState<string | null>(existingVisitId || null);
  const [draftLoaded, setDraftLoaded] = React.useState(false);

  // Listen for medical panel open events from PatientChartShell
  React.useEffect(() => {
    const handleOpenMedicalPanel = (event: Event) => {
      const customEvent = event as CustomEvent<{ sectionId: string }>;
      const sectionId = customEvent.detail?.sectionId;
      if (sectionId) {
        setMedicalPanelSection(sectionId);
        setMedicalPanelOpen(true);
      }
    };

    window.addEventListener('openMedicalPanel', handleOpenMedicalPanel);
    return () => {
      window.removeEventListener('openMedicalPanel', handleOpenMedicalPanel);
    };
  }, []);

  // Also check URL searchParams on mount and when they change
  React.useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const medicalSection = searchParams.get('medicalSection');
    if (medicalSection) {
      setMedicalPanelSection(medicalSection);
      setMedicalPanelOpen(true);
      // Clear the param from URL without reload
      const url = new URL(window.location.href);
      url.searchParams.delete('medicalSection');
      window.history.replaceState({}, '', url);
    }

    // Check if visit was just saved (from call page)
    const saved = searchParams.get('saved');
    if (saved === 'true') {
      setShowPostSaveModal(true);
      // Clear the param from URL without reload
      const url = new URL(window.location.href);
      url.searchParams.delete('saved');
      window.history.replaceState({}, '', url);
    }
  }, []);

  const [showPostSaveModal, setShowPostSaveModal] = React.useState(false);
  const [isProcessingAction, setIsProcessingAction] = React.useState(false);
  const appliedParsedDataRef = React.useRef<any>(null);

  const form = useForm({
    resolver: zodResolver(visitNoteSchema),
    defaultValues: createEmptyVisitNote(),
  });

  // Auto-mark section as reviewed when navigated to
  const handleSectionChange = React.useCallback(async (sectionId: string) => {
    // Save current section data before switching
    if (draftLoaded) {
      try {
        const formData = form.getValues() as VisitNote;
        await saveDraft(patientId, userId, {
          formState: formData,
          reviewedSections: reviewedSections,
          expandedSections: expandedSections,
          role: userRole,
          visitIdRemote: visitIdRemote || undefined,
        });
      } catch (error) {
        console.error("Error auto-saving on section change:", error);
      }
    }

    // Regular section navigation (Visit Note Sections)
    setCurrentSection(sectionId);
    setReviewedSections((prev) => {
      const updated = new Set(prev);
      updated.add(sectionId);
      return updated;
    });
    // Close medical panel if open when navigating visit note sections
    setMedicalPanelOpen(false);
    setMedicalPanelSection(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftLoaded, patientId, userId, userRole, reviewedSections, expandedSections, visitIdRemote]);

  // Watch weight and height for BMI calculation
  const weight = useWatch({ control: form.control, name: "objective.weight" });
  const height = useWatch({ control: form.control, name: "objective.height" });

  // Calculate BMI when weight or height changes
  React.useEffect(() => {
    const calculateBMI = () => {
      const weightNum = parseFloat(weight || "");
      const heightNum = parseFloat(height || "");

      if (weightNum > 0 && heightNum > 0) {
        // Convert weight from lbs to kg: lbs * 0.453592
        const weightKg = weightNum * 0.453592;
        // Convert height from cm to m: cm / 100
        const heightM = heightNum / 100;
        // Calculate BMI: kg / (m^2)
        const bmi = weightKg / (heightM * heightM);
        // Round to 1 decimal place
        const bmiRounded = bmi.toFixed(1);
        form.setValue("objective.bmi", bmiRounded);
      } else {
        // Clear BMI if weight or height is invalid
        form.setValue("objective.bmi", "");
      }
    };

    calculateBMI();
  }, [weight, height, form]);

  // Pre-load lamejs when component mounts (if online)
  React.useEffect(() => {
    if (navigator.onLine) {
      preloadLamejs().catch((error) => {
        console.warn("Failed to preload lamejs:", error);
      });
    }
  }, []);

  // Listen for draft updates from sync engine
  React.useEffect(() => {
    const handleDraftUpdate = async (event: Event) => {
      const customEvent = event as CustomEvent<{ patientId?: string; hasParsedData?: boolean }>;
      const { patientId: updatedPatientId, hasParsedData } = customEvent.detail || {};

      // Only reload if this draft is for the current patient
      if (updatedPatientId === patientId && draftLoaded) {
        try {
          const { getDraftFormState } = await import("@/app/_lib/offline/draft");
          const updatedFormState = await getDraftFormState(patientId, userId);

          if (updatedFormState) {
            const currentData = form.getValues() as VisitNote;
            // Merge with most recent (AI) values taking precedence
            const merged = mergeVisitNote(currentData, updatedFormState);
            form.reset(merged);

            if (hasParsedData) {
              toast.success("Visit note updated with AI-parsed data");
            } else {
              toast.info("Draft updated");
            }
          }
        } catch (error) {
          console.error("Error reloading draft after sync:", error);
        }
      }
    };

    window.addEventListener("draftUpdated", handleDraftUpdate);

    return () => {
      window.removeEventListener("draftUpdated", handleDraftUpdate);
    };
  }, [patientId, userId, draftLoaded, form]);

  // Load draft on mount
  React.useEffect(() => {
    const loadDraftData = async () => {
      try {
        // Always check for draft first (even when editing existing visit)
        // This ensures unsaved changes persist across page refreshes
        const draft = await loadDraft(patientId, userId, userRole);
        const formState = await getDraftFormState(patientId, userId);
        const reviewed = await getReviewedSections(patientId, userId);

        // If we have a draft with meaningful form state, use it (user's unsaved changes)
        // Check if draft has actual data (not just empty defaults)
        const hasDraftData = formState && draft.formStateJson && draft.formStateJson !== "{}" && draft.formStateJson.trim() !== "";
        if (hasDraftData) {
          form.reset(formState);
          setReviewedSections(reviewed);
          if (draft.visitIdRemote) {
            setVisitIdRemote(draft.visitIdRemote);
          }
          setDraftLoaded(true);
          return;
        }

        // If editing existing visit and no draft, load from visit data
        if (existingVisitId && existingVisitData) {
          try {
            // Use parseVisitNote which handles migration
            const parsedData = parseVisitNote(existingVisitData);
            form.reset(parsedData);
            // Continue-note / edit path: do not block Save on section-review gate (audit P0).
            // User can still step through sections; all are treated as reviewed for this visit.
            const sectionsForRole = getSectionsForRole(userRole);
            setReviewedSections(new Set(sectionsForRole.map((s) => s.id)));
            setExpandedSections(new Set(sectionsForRole.map(s => s.id)));
            setVisitIdRemote(existingVisitId);
            setDraftLoaded(true);
            return;
          } catch (error) {
            console.error("Error parsing existing visit data:", error);
          }
        }

        // No draft and not editing - start fresh
        // Mark initial section as reviewed (use role-specific sections)
        const sectionsForRole = getSectionsForRole(userRole);
        if (!reviewed.has(sectionsForRole[0].id)) {
          reviewed.add(sectionsForRole[0].id);
        }

        setReviewedSections(reviewed);
        if (draft.visitIdRemote) {
          setVisitIdRemote(draft.visitIdRemote);
        }
        setDraftLoaded(true);
      } catch (error) {
        console.error("Error loading draft:", error);
        setDraftLoaded(true);
      }
    };

    loadDraftData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, userId, userRole]);

  // Apply initial parsed data when it becomes available
  React.useEffect(() => {
    if (initialParsedData && draftLoaded) {
      // Use JSON stringify for comparison to detect actual data changes
      const dataKey = JSON.stringify(initialParsedData);
      if (appliedParsedDataRef.current !== dataKey) {
        try {
          console.log("Applying parsed data to form:", initialParsedData);
          const currentData = form.getValues() as VisitNote;
          console.log("Current form data before merge:", currentData);

          // Merge with most recent (AI) values taking precedence
          const merged = mergeVisitNote(
            currentData,
            initialParsedData as Partial<VisitNote>
          );

          console.log("Merged data after merge:", merged);

          form.reset(merged);
          appliedParsedDataRef.current = dataKey;
          toast.success("AI data applied to form");

          // Verify the form was updated
          const updatedData = form.getValues() as VisitNote;
          console.log("Form data after reset:", updatedData);
        } catch (error) {
          console.error("Error applying initial parsed data:", error);
          toast.error("Failed to apply AI data to form");
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialParsedData, draftLoaded]);

  // Auto-save draft on form changes (debounced)
  React.useEffect(() => {
    if (!draftLoaded) return;

    const subscription = form.watch(() => {
      const timeoutId = setTimeout(async () => {
        try {
          const formData = form.getValues() as VisitNote;
          const currentReviewed = reviewedSections;
          const currentExpanded = expandedSections;
          const currentVisitId = visitIdRemote;

          await saveDraft(patientId, userId, {
            formState: formData,
            reviewedSections: currentReviewed,
            expandedSections: currentExpanded,
            role: userRole,
            visitIdRemote: currentVisitId || undefined,
          });
        } catch (error) {
          console.error("Error saving draft:", error);
        }
      }, 500);

      return () => clearTimeout(timeoutId);
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, userId, draftLoaded]);

  // Online/offline detection and sync engine
  React.useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Start sync engine when online
      const { getSyncEngine } = require("@/app/_lib/offline/sync-engine");
      const syncEngine = getSyncEngine();
      syncEngine.start();
    };
    const handleOffline = () => setIsOnline(false);

    // Initialize sync engine
    if (navigator.onLine) {
      const { getSyncEngine } = require("@/app/_lib/offline/sync-engine");
      const syncEngine = getSyncEngine();
      syncEngine.start();
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      // Stop sync engine on unmount
      const { getSyncEngine } = require("@/app/_lib/offline/sync-engine");
      const syncEngine = getSyncEngine();
      syncEngine.stop();
    };
  }, []);

  const handleTranscriptReady = async (transcript: string) => {
    // Store transcript in draft
    await saveDraft(patientId, userId, { transcript, role: userRole });

    // Save transcript to database immediately if visit exists
    if (visitIdRemote) {
      try {
        await saveTranscriptAction({
          visitId: visitIdRemote,
          text: transcript,
          rawText: transcript,
        });
      } catch (error) {
        console.error("Error saving transcript:", error);
        // Don't block the UI if transcript save fails
      }
    }
  };

  const handleParseReady = async (parsed: unknown) => {
    try {
      const currentData = form.getValues() as VisitNote;

      // Merge with most recent (AI) values taking precedence
      const merged = mergeVisitNote(currentData, parsed as Partial<VisitNote>);

      form.reset(merged);
      toast.success("AI data applied to form");
    } catch (error) {
      console.error("Error merging parsed data:", error);
      toast.error("Failed to apply AI data");
    }
  };

  // Auto-save reviewed sections when they change
  React.useEffect(() => {
    if (!draftLoaded) return;

    // Use a ref to track if we've already saved to avoid loops
    const timeoutId = setTimeout(async () => {
      try {
        await saveDraft(patientId, userId, { reviewedSections, role: userRole });
      } catch (error) {
        console.error("Error saving reviewed sections:", error);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewedSections.size, patientId, userId, userRole, draftLoaded]);

  // Check if all visible sections (based on role) are reviewed
  const allSectionsReviewed = roleSections.every((s) => reviewedSections.has(s.id));





  const handleFinalize = async () => {
    if (!allSectionsReviewed) {
      toast.error("Please review all sections before finalizing");
      return;
    }

    setIsSaving(true);
    try {
      const formData = form.getValues() as VisitNote;

      if (!visitIdRemote) {
        // Load draft to get transcript if available
        const draft = await loadDraft(patientId, userId, userRole);

        // Create visit first
        const result = await createVisitDraftAction({
          patientId,
          notesJson: formData,
          transcript: draft.transcript || undefined,
        });
        setVisitIdRemote(result.visitId);

        // Save any transcripts from draft to database
        if (draft.transcript) {
          try {
            await saveTranscriptAction({
              visitId: result.visitId,
              text: draft.transcript,
              rawText: draft.transcript,
            });
          } catch (error) {
            console.error("Error saving transcript from draft:", error);
          }
        }
      } else {
        // Update visit
        await updateVisitDraftAction(visitIdRemote, {
          notesJson: formData,
        });
      }

      // Save documents to database
      const documents = formData.docs?.uploadedDocuments || [];
      if (documents.length > 0 && visitIdRemote) {
        const documentPromises = documents.map(async (doc: any) => {
          // Only save if it doesn't already have a DB record (check if it has storageUrl)
          // Documents uploaded during the form already have storageUrl from the upload endpoint
          if (doc.storageUrl) {
            return createDocumentAction({
              patientId,
              visitId: visitIdRemote,
              filename: doc.name,
              mimeType: doc.type,
              size: doc.size.toString(),
              storageUrl: doc.storageUrl,
            });
          }
          return null;
        });

        const results = await Promise.allSettled(documentPromises);
        const failures = results.filter((r) => r.status === "rejected");
        if (failures.length > 0) {
          console.warn("Some documents failed to save:", failures);
          // Don't block finalization if document save fails
        }
      }

      // Don't finalize yet - keep as "In Progress" unless user clicks "Sign Note"
      // The visit status will remain "In Progress" until explicitly signed
      // Medications will be synced to patient record when the note is signed

      // Clear draft
      await clearDraft(patientId, userId);

      // Show post-save modal instead of redirecting
      setShowPostSaveModal(true);
      toast.success("Visit saved successfully");
    } catch (error) {
      console.error("Error finalizing visit:", error);
      toast.error("Failed to save visit");
    } finally {
      setIsSaving(false);
    }
  };

  // Expose save function via ref
  React.useEffect(() => {
    if (onSaveReadyRef) {
      onSaveReadyRef.current = handleFinalize;
    }
    return () => {
      if (onSaveReadyRef) {
        onSaveReadyRef.current = null;
      }
    };
  }, [onSaveReadyRef, handleFinalize]);

  const handlePostSaveAction = async (action: "view" | "waiting" | "sign") => {
    if (!visitIdRemote) return;

    setIsProcessingAction(true);
    try {
      if (action === "view") {
        // Set is_assigned to null
        await updatePatientAssignedAction(patientId, null);
        router.push(`/patients/${patientId}`);
      } else if (action === "waiting") {
        // Navigate to send to waiting room page
        router.push(`/patients/${patientId}/send-to-waiting-room?visitId=${visitIdRemote}`);
      } else if (action === "sign") {
        // Sign the note and set is_assigned to null
        await finalizeVisitAction(visitIdRemote, "signed");
        await updatePatientAssignedAction(patientId, null);
        toast.success("Note signed successfully");
        router.push(`/patients/${patientId}/visit-history`);
      } else {
        // For "view" and "waiting", keep visit as "In Progress"
        // Visit status remains "In Progress" until explicitly signed
      }
      setShowPostSaveModal(false);
    } catch (error) {
      console.error("Error processing post-save action:", error);
      toast.error("Failed to process action");
    } finally {
      setIsProcessingAction(false);
    }
  };

  const currentSectionIndex = roleSections.findIndex((s) => s.id === currentSection);
  const canGoNext = currentSectionIndex < roleSections.length - 1;
  const canGoPrev = currentSectionIndex > 0;

  const goToNext = () => {
    if (canGoNext) {
      const nextSectionId = roleSections[currentSectionIndex + 1].id;
      handleSectionChange(nextSectionId);
    }
  };

  const goToPrev = () => {
    if (canGoPrev) {
      const prevSectionId = roleSections[currentSectionIndex - 1].id;
      handleSectionChange(prevSectionId);
    }
  };

  // Render form section based on currentSection
  const renderSection = () => {
    const section = roleSections.find((s) => s.id === currentSection);
    if (!section) return null;

    switch (section.id) {
      case "subjective":
        return (
          <div className="space-y-8">
            <div className="space-y-3">
              <Label className="text-base">Chief Complaint</Label>
              <Textarea
                {...form.register("subjective.chiefComplaint")}
                className="min-h-[100px]"
              />
            </div>
            <div className="space-y-3">
              <Label className="text-base">History of Present Illness (HPI)</Label>
              <Textarea
                {...form.register("subjective.hpi")}
                rows={8}
                className="min-h-[200px]"
              />
            </div>
          </div>
        );
      case "objective":
        return (
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Label className="text-base">Blood Pressure</Label>
              </div>
              <Input
                {...form.register("objective.bp")}
              />
            </div>
            <div className="space-y-3">
              <Label className="text-base">Heart Rate</Label>
              <Input
                {...form.register("objective.hr")}
              />
            </div>
            <div className="space-y-3">
              <Label className="text-base">Temperature</Label>
              <Input
                {...form.register("objective.temp")}
                placeholder="e.g., 98.6"
              />
              {form.watch("objective.temp") && (
                <p className="text-xs text-muted-foreground">
                  {(() => {
                    const temp = form.watch("objective.temp") || "";
                    const num = parseFloat(temp);
                    if (!isNaN(num) && temp) {
                      const celsius = ((num - 32) * 5) / 9;
                      return `${temp}°F = ${celsius.toFixed(1)}°C`;
                    }
                    return "";
                  })()}
                </p>
              )}
            </div>
            <div className="space-y-3">
              <Label className="text-base">Weight (lbs)</Label>
              <Input
                {...form.register("objective.weight")}
                placeholder="e.g., 170"
              />
              {form.watch("objective.weight") && (
                <p className="text-xs text-muted-foreground">
                  {(() => {
                    const weight = form.watch("objective.weight") || "";
                    const num = parseFloat(weight);
                    if (!isNaN(num) && weight) {
                      const kg = num * 0.453592;
                      return `${weight} lbs = ${kg.toFixed(1)} kg`;
                    }
                    return "";
                  })()}
                </p>
              )}
            </div>
            <div className="space-y-3">
              <Label className="text-base">Height (cm)</Label>
              <Input
                {...form.register("objective.height")}
                placeholder="e.g., 177.8"
              />
              {form.watch("objective.height") && (
                <p className="text-xs text-muted-foreground">
                  {(() => {
                    const heightValue = form.watch("objective.height");
                    if (!heightValue) return "";
                    const num = parseFloat(heightValue);
                    if (!isNaN(num)) {
                      const inches = num / 2.54;
                      const feet = Math.floor(inches / 12);
                      const remainingInches = Math.round(inches % 12);
                      if (feet > 0) {
                        return `${heightValue} cm = ${feet}'${remainingInches}"`;
                      }
                      return `${heightValue} cm = ${inches.toFixed(1)} in`;
                    }
                    return "";
                  })()}
                </p>
              )}
            </div>
            <div className="space-y-3">
              <Label className="text-base">BMI</Label>
              <Input
                {...form.register("objective.bmi")}
                placeholder="Auto-calculated"
                readOnly
                className="bg-muted cursor-not-allowed"
              />
            </div>
            <div className="md:col-span-2 space-y-4">
              <Label className="text-base font-semibold">Physical Examination</Label>
              <div className="grid gap-4 md:grid-cols-2">
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
                ].map((category) => (
                  <div key={category.key} className="space-y-2">
                    <Label className="text-sm font-medium">{category.label}</Label>
                    <Textarea
                      {...form.register(`objective.examFindings.${category.key}` as any)}
                      rows={3}
                      className="min-h-[80px] resize-none"
                      placeholder={`${category.label} examination findings...`}
                    />
                  </div>
                ))}
              </div>
            </div>
            {/* Vision fields */}
            {["visionOd", "visionOs", "visionOu", "visionCorrection", "visionBlurry", "visionFloaters", "visionPain", "visionLastExamDate"].map((field) => (
              <div key={field} className="space-y-2">
                <Label>{field === "visionOd" ? "Vision OD" : field === "visionOs" ? "Vision OS" : field === "visionOu" ? "Vision OU" : field === "visionCorrection" ? "Vision Correction" : field === "visionBlurry" ? "Vision Blurry" : field === "visionFloaters" ? "Vision Floaters" : field === "visionPain" ? "Vision Pain" : "Last Exam Date"}</Label>
                <Input
                  type={field === "visionLastExamDate" ? "date" : "text"}
                  {...form.register(`objective.${field}` as any)}
                />
              </div>
            ))}
          </div>
        );
      case "pointOfCare":
        return (
          <div className="space-y-8">
            {/* Diabetes Subsection */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-foreground border-b pb-2">Diabetes</h3>
              <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 min-w-0">
                {/* Row 1 */}
                {["fastingGlucose", "randomGlucose"].map((field) => (
                  <div key={field} className="space-y-3 min-w-0">
                    <Label className="text-base">{field === "fastingGlucose" ? "Fasting Blood Glucose" : "Random Blood Glucose"}</Label>
                    <Input
                      {...form.register(`pointOfCare.diabetes.${field}` as any)}
                      placeholder="mg/dL"
                    />
                  </div>
                ))}
                <div className="flex gap-3 min-w-0">
                  <div className="flex-1 space-y-3 min-w-0">
                    <Label className="text-base">HbA1c</Label>
                    <Input
                      {...form.register("pointOfCare.diabetes.hbA1cValue")}
                      placeholder="e.g. 7.1%"
                    />
                  </div>
                  <div className="flex-1 space-y-3 min-w-0">
                    <Label className="text-base">Date</Label>
                    <Input
                      type="date"
                      {...form.register("pointOfCare.diabetes.hbA1cDate")}
                      placeholder="mm/dd/yyyy"
                    />
                  </div>
                </div>

                {/* Row 2 */}
                {["homeMonitoring", "averageReadings", "hypoglycemiaEpisodes"].map((field) => (
                  <div key={field} className="space-y-3 min-w-0">
                    <Label className="text-base">
                      {field === "homeMonitoring" ? "Home Glucose Monitoring" : field === "averageReadings" ? "Average Readings" : "Hypoglycemia Episodes"}
                    </Label>
                    {field === "homeMonitoring" ? (
                      <Select
                        value={form.watch("pointOfCare.diabetes.homeMonitoring") || ""}
                        onValueChange={(value) => form.setValue("pointOfCare.diabetes.homeMonitoring", value)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Yes">Yes</SelectItem>
                          <SelectItem value="No">No</SelectItem>
                          <SelectItem value="Occasionally">Occasionally</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        {...form.register(`pointOfCare.diabetes.${field}` as any)}
                        placeholder={field === "averageReadings" ? "mg/dL" : "Frequency / notes"}
                      />
                    )}
                  </div>
                ))}

                {/* Row 3 */}
                {["hyperglycemiaSymptoms", "footExam", "eyeExamDue"].map((field) => (
                  <div key={field} className="space-y-3 min-w-0">
                    <Label className="text-base">
                      {field === "hyperglycemiaSymptoms" ? "Hyperglycemia Symptoms" : field === "footExam" ? "Foot Exam Performed" : "Eye Exam Due"}
                    </Label>
                    {field === "footExam" || field === "eyeExamDue" ? (
                      <Select
                        value={form.watch(`pointOfCare.diabetes.${field}`) || ""}
                        onValueChange={(value) => form.setValue(`pointOfCare.diabetes.${field}`, value)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          {field === "footExam" ? (
                            <>
                              <SelectItem value="Yes">Yes</SelectItem>
                              <SelectItem value="No">No</SelectItem>
                              <SelectItem value="Deferred">Deferred</SelectItem>
                            </>
                          ) : (
                            <>
                              <SelectItem value="Yes">Yes</SelectItem>
                              <SelectItem value="No">No</SelectItem>
                              <SelectItem value="Scheduled">Scheduled</SelectItem>
                            </>
                          )}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        {...form.register(`pointOfCare.diabetes.${field}` as any)}
                        placeholder="Symptoms noted"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* HIV Subsection */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-foreground border-b pb-2">HIV</h3>
              <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 min-w-0">
                <div className="space-y-3">
                  <Label className="text-base">HIV Result</Label>
                  <Select
                    value={form.watch("pointOfCare.hiv") || "Unknown"}
                    onValueChange={(value) => form.setValue("pointOfCare.hiv", value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Unknown">Unknown</SelectItem>
                      <SelectItem value="negative">Negative</SelectItem>
                      <SelectItem value="positive">Positive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Syphilis Subsection */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-foreground border-b pb-2">Syphilis</h3>
              <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 min-w-0">
                <div className="space-y-3">
                  <Label className="text-base">Result</Label>
                  <Select
                    value={form.watch("pointOfCare.syphilis.result") || "Unknown"}
                    onValueChange={(value) => form.setValue("pointOfCare.syphilis.result", value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Unknown">Unknown</SelectItem>
                      <SelectItem value="positive">Positive</SelectItem>
                      <SelectItem value="negative">Negative</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-3">
                  <Label className="text-base">Reactivity</Label>
                  <Select
                    value={form.watch("pointOfCare.syphilis.reactivity") || "Unknown"}
                    onValueChange={(value) => form.setValue("pointOfCare.syphilis.reactivity", value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Unknown">Unknown</SelectItem>
                      <SelectItem value="reactive">Reactive</SelectItem>
                      <SelectItem value="non-reactive">Non-Reactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>
        );
      case "medications":
        return (
          <MedicationsSection form={form} />
        );
      case "vaccines":
        return (
          <VaccinesSection form={form} />
        );
      case "familyHistory":
        return (
          <FamilyHistorySection form={form} />
        );
      case "riskFlags":
        return (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-4">
              {["tobaccoUse", "alcoholUse", "housingStatus"].map((field) => (
                <div key={field} className="space-y-2">
                  <Label>
                    {field === "tobaccoUse" ? "Tobacco Use" : field === "alcoholUse" ? "Alcohol Use" : "Housing Status"}
                  </Label>
                  <Select
                    value={(form.watch(`riskFlags.${field}` as any) as string) || ""}
                    onValueChange={(value) => form.setValue(`riskFlags.${field}` as any, value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select..." />
                    </SelectTrigger>
                    <SelectContent>
                      {field === "tobaccoUse" ? (
                        <>
                          <SelectItem value="Never">Never</SelectItem>
                          <SelectItem value="Former">Former</SelectItem>
                          <SelectItem value="Current">Current</SelectItem>
                          <SelectItem value="Unknown">Unknown</SelectItem>
                        </>
                      ) : field === "alcoholUse" ? (
                        <>
                          <SelectItem value="Never">Never</SelectItem>
                          <SelectItem value="Rarely">Rarely</SelectItem>
                          <SelectItem value="Social">Social</SelectItem>
                          <SelectItem value="Regular">Regular</SelectItem>
                          <SelectItem value="Heavy">Heavy</SelectItem>
                          <SelectItem value="Unknown">Unknown</SelectItem>
                        </>
                      ) : (
                        <>
                          <SelectItem value="Stable">Stable</SelectItem>
                          <SelectItem value="Unstable">Unstable</SelectItem>
                          <SelectItem value="Homeless">Homeless</SelectItem>
                          <SelectItem value="Temporary">Temporary</SelectItem>
                          <SelectItem value="Unknown">Unknown</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <div className="space-y-4">
              {["tobaccoAmount", "alcoholFrequency", "occupation"].map((field) => (
                <div key={field} className="space-y-2">
                  <Label>
                    {field === "tobaccoAmount" ? "Amount" : field === "alcoholFrequency" ? "Frequency" : "Occupation"}
                  </Label>
                  <Input
                    {...form.register(`riskFlags.${field}` as any)}
                    placeholder={field === "tobaccoAmount" ? "e.g., 10 cigs / day" : field === "alcoholFrequency" ? "e.g., 2-3 drinks / week" : "e.g., Logistics Manager"}
                  />
                </div>
              ))}
            </div>
          </div>
        );
      case "surgicalHistory":
        return (
          <SurgicalHistorySection form={form} />
        );
      case "pastMedicalHistory":
        return (
          <PastMedicalHistorySection form={form} />
        );
      case "orders":
        return (
          <OrdersSection form={form} />
        );
      case "documents":
        return (
          <DocumentsSection form={form} patientId={patientId} visitId={visitIdRemote} />
        );
      case "assessmentPlan":
        // Hide assessment & plan for nurses
        if (userRole === "nurse") {
          return null;
        }
        return (
          <AssessmentPlanSection form={form} />
        );
      // Add other sections similarly...
      default:
        return <div>Section: {section.label}</div>;
    }
  };

  if (!draftLoaded) {
    return <div>Loading...</div>;
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold text-foreground">
              {existingVisitId ? "Continue Visit" : "New Visit"}
            </h1>
            {isRecording && (
              <Badge variant="destructive" className="gap-2 animate-pulse">
                <div className="w-2 h-2 bg-white rounded-full" />
                <span>Recording</span>
              </Badge>
            )}
            {/* {onStartRecording && onStopRecording && (
              <>
                {isRecording ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={onStopRecording}
                    className="gap-2"
                  >
                    <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                    <span>Stop Recording</span>
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onStartRecording}
                  >
                    Start Recording
                  </Button>
                )}
              </>
            )} */}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {patientBasics.fullName} • DOB: {patientBasics.dob || "N/A"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Join Call button for virtual visits */}
          {visitAppointmentType?.toLowerCase() === "virtual" && visitTwilioRoomName && existingVisitId && (
            <Button
              onClick={() => router.push(`/visit/${existingVisitId}/call`)}
              variant="default"
              className="bg-purple-600 hover:bg-purple-700"
            >
              <Video className="h-4 w-4 mr-2" />
              Join Call
            </Button>
          )}
          <OfflineSyncBadge
            isOnline={isOnline}
            pendingCount={pendingCount}
            isSyncing={isSyncing}
          />
        </div>
      </div>

      {/* Layout: Stacked on tablet in video call, side-by-side otherwise */}
      <div className={cn(
        "grid gap-8",
        isInVideoCall
          ? "grid-cols-1" // Stacked vertically on tablet in video call
          : "grid-cols-1 lg:grid-cols-4"  // Normal layout: side-by-side on desktop
      )}>
        {/* Left sidebar - Medical Info Panel, AI Capture, and Stepper */}
        <div className={cn(
          "space-y-4",
          isInVideoCall ? "" : "lg:col-span-1"
        )}>
          {/* Medical Info Panel - appears at top of left sidebar when open */}
          {medicalPanelOpen && medicalPanelSection && (
            <MedicalInfoPanel
              patientBasics={patientBasics}
              sectionId={medicalPanelSection}
              onClose={() => {
                setMedicalPanelOpen(false);
                setMedicalPanelSection(null);
              }}
            />
          )}

          {!hideAICapture && (
            <AICapturePanel
              patientId={patientId}
              onTranscriptReady={handleTranscriptReady}
              onParseReady={handleParseReady}
            />
          )}
          <Card>
            <CardContent className="p-4">
              <SectionStepper
                currentSection={currentSection}
                reviewedSections={reviewedSections}
                onSectionClick={handleSectionChange}
                userRole={userRole}
              />
            </CardContent>
          </Card>
        </div>

        {/* Main form area */}
        <div className={cn(
          "space-y-4",
          isInVideoCall ? "" : "lg:col-span-3"
        )}>
          <Card>
            <CardHeader className="pb-4">
              <CardTitle>
                {visitSections.find((s) => s.id === currentSection)?.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-8">{renderSection()}</CardContent>
          </Card>

          {/* Navigation */}
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              onClick={goToPrev}
              disabled={!canGoPrev}
            >
              <ChevronLeft className="h-4 w-4 mr-2" />
              Previous
            </Button>
            <Button
              variant="outline"
              onClick={goToNext}
              disabled={!canGoNext}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="sticky bottom-0 border-t bg-background p-4 flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {reviewedSections.size} of {roleSections.length} sections reviewed
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={handleFinalize}
            disabled={isSaving || !allSectionsReviewed || !isOnline}
          >
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Save Visit
          </Button>
        </div>
      </div>

      {/* Post-Save Modal */}
      <Dialog open={showPostSaveModal} onOpenChange={setShowPostSaveModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Visit Saved Successfully</DialogTitle>
            <DialogDescription>
              What would you like to do next?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <Button
              variant="outline"
              className="w-full justify-start h-auto py-4"
              onClick={() => handlePostSaveAction("view")}
              disabled={isProcessingAction}
            >
              <User className="h-5 w-5 mr-3" />
              <div className="text-left">
                <div className="font-medium">View Patient</div>
                <div className="text-sm text-muted-foreground">
                  Go to patient profile
                </div>
              </div>
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start h-auto py-4"
              onClick={() => handlePostSaveAction("waiting")}
              disabled={isProcessingAction}
            >
              <Clock className="h-5 w-5 mr-3" />
              <div className="text-left">
                <div className="font-medium">Send to Waiting Room</div>
                <div className="text-sm text-muted-foreground">
                  Send patient to waiting room queue
                </div>
              </div>
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start h-auto py-4"
              onClick={() => handlePostSaveAction("sign")}
              disabled={isProcessingAction}
            >
              <FileSignature className="h-5 w-5 mr-3" />
              <div className="text-left">
                <div className="font-medium">Sign the Note</div>
                <div className="text-sm text-muted-foreground">
                  Mark note as signed and unassign patient
                </div>
              </div>
            </Button>
          </div>
          {isProcessingAction && (
            <div className="flex items-center justify-center py-2">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              <span className="text-sm text-muted-foreground">Processing...</span>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Medications Section Component - matches patient medications page structure
function MedicationsSection({ form }: { form: any }) {
  const medicationsValue = form.watch("medications");
  // Handle migration from old format to new format
  const medications = React.useMemo(() => {
    if (Array.isArray(medicationsValue)) {
      // Filter out any old format medications (with 'name' instead of 'brandName'/'genericName')
      return medicationsValue.map((med: any) => {
        // If it's old format (has 'name' field), try to migrate
        if (med.name && !med.brandName) {
          return {
            id: med.id || undefined,
            brandName: med.name || "",
            strength: "",
            form: "",
            dosage: med.dosage || "",
            frequency: "",
            status: "Active" as const,
            notes: med.sideEffectsNotes || "",
            createdAt: med.createdAt || undefined,
          };
        }
        // Already new format, ensure all fields are present
        return {
          id: med.id || undefined,
          brandName: med.brandName || "",
          strength: med.strength || "",
          form: med.form || "",
          dosage: med.dosage || "",
          frequency: med.frequency || "",
          status: med.status || ("Active" as const),
          notes: med.notes || "",
          createdAt: med.createdAt || undefined,
        };
      });
    }
    return [];
  }, [medicationsValue]);

  const [editingIndex, setEditingIndex] = React.useState<number | null>(null);
  const [editData, setEditData] = React.useState({
    brandName: "",
    strength: "",
    form: "",
    dosage: "",
    frequency: "",
    status: "Active" as "Active" | "Inactive" | "Discontinued",
    notes: "",
  });

  // Use refs to track latest values for cleanup
  const editingIndexRef = React.useRef<number | null>(null);
  const editDataRef = React.useRef(editData);

  React.useEffect(() => {
    editingIndexRef.current = editingIndex;
    editDataRef.current = editData;
  }, [editingIndex, editData]);

  // Auto-save pending edits when component unmounts (section change)
  React.useEffect(() => {
    return () => {
      // Save any pending edits when leaving the medications section
      if (editingIndexRef.current !== null && editDataRef.current.brandName?.trim()) {
        const current = getMedicationsArray();
        const existingMed = current[editingIndexRef.current];
        if (existingMed) {
          current[editingIndexRef.current] = {
            ...existingMed,
            ...editDataRef.current,
          };
          form.setValue("medications", current);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Helper to ensure medications is always an array with proper structure
  const getMedicationsArray = () => {
    const value = form.getValues("medications");
    if (Array.isArray(value)) {
      return value.map((med: any) => ({
        id: med.id || undefined,
        brandName: med.brandName || "",
        strength: med.strength || "",
        form: med.form || "",
        dosage: med.dosage || "",
        frequency: med.frequency || "",
        status: med.status || ("Active" as const),
        notes: med.notes || "",
        createdAt: med.createdAt || undefined,
      }));
    }
    return [];
  };

  const getMedicationDisplayName = (med: any) => {
    return med.brandName || "Unnamed Medication";
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "Active":
        return { variant: "default" as const, label: status, className: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500" };
      case "Inactive":
        return { variant: "secondary" as const, label: status };
      case "Discontinued":
        return { variant: "destructive" as const, label: status };
      default:
        return { variant: "secondary" as const, label: status };
    }
  };

  const handleAdd = () => {
    const newMedication = {
      brandName: "",
      strength: "",
      form: "",
      dosage: "",
      frequency: "",
      status: "Active" as const,
      notes: "",
    };
    const current = getMedicationsArray();
    form.setValue("medications", [...current, newMedication]);
    setEditingIndex(current.length);
    setEditData(newMedication);
  };

  const handleEdit = (index: number) => {
    const med = medications[index];
    if (med) {
      setEditingIndex(index);
      setEditData({
        brandName: med.brandName || "",
        strength: med.strength || "",
        form: med.form || "",
        dosage: med.dosage || "",
        frequency: med.frequency || "",
        status: med.status || ("Active" as const),
        notes: med.notes || "",
      });
    }
  };

  const handleSave = (index: number) => {
    const current = getMedicationsArray();
    const existingMed = current[index];
    current[index] = {
      ...existingMed,
      ...editData,
    };
    form.setValue("medications", current);
    setEditingIndex(null);
    setEditData({
      brandName: "",
      strength: "",
      form: "",
      dosage: "",
      frequency: "",
      status: "Active",
      notes: "",
    });
  };

  const handleCancel = () => {
    setEditingIndex(null);
    setEditData({
      brandName: "",
      strength: "",
      form: "",
      dosage: "",
      frequency: "",
      status: "Active",
      notes: "",
    });
  };

  const handleRemove = (index: number) => {
    const current = getMedicationsArray();
    form.setValue("medications", current.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      {medications.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No medications added yet
        </div>
      ) : (
        <div className="space-y-3">
          {medications.map((med, index) => (
            <div
              key={med.id || index}
              className="border rounded-lg p-4 space-y-3 bg-card"
            >
              {editingIndex === index ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Medication Name</Label>
                    <Input
                      value={editData.brandName}
                      onChange={(e) => setEditData({ ...editData, brandName: e.target.value })}
                      placeholder="e.g., Amoxicillin 400 mg/5 mL"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Strength</Label>
                      <Input
                        value={editData.strength}
                        onChange={(e) => setEditData({ ...editData, strength: e.target.value })}
                        placeholder="e.g., 500mg"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Form</Label>
                      <Input
                        value={editData.form}
                        onChange={(e) => setEditData({ ...editData, form: e.target.value })}
                        placeholder="e.g., Tablet, Capsule"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Dosage</Label>
                      <Input
                        value={editData.dosage}
                        onChange={(e) => setEditData({ ...editData, dosage: e.target.value })}
                        placeholder="e.g., 1 tablet"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Frequency</Label>
                      <Input
                        value={editData.frequency}
                        onChange={(e) => setEditData({ ...editData, frequency: e.target.value })}
                        placeholder="e.g., Twice daily"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Status</Label>
                    <Select
                      value={editData.status}
                      onValueChange={(value) => setEditData({ ...editData, status: value as "Active" | "Inactive" | "Discontinued" })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Active">Active</SelectItem>
                        <SelectItem value="Inactive">Inactive</SelectItem>
                        <SelectItem value="Discontinued">Discontinued</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Notes</Label>
                    <Textarea
                      value={editData.notes}
                      onChange={(e) => setEditData({ ...editData, notes: e.target.value })}
                      placeholder="Additional notes or linked diagnosis..."
                      rows={3}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleSave(index)}
                      disabled={!editData.brandName?.trim()}
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCancel}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-1">
                      <div className="font-medium">{getMedicationDisplayName(med)}</div>
                      <div className="flex flex-wrap gap-2 mt-2">
                        <Badge
                          variant={getStatusBadge(med.status || "Active").variant}
                          className={getStatusBadge(med.status || "Active").className || ""}
                        >
                          {getStatusBadge(med.status || "Active").label}
                        </Badge>
                      </div>
                      {(med.strength || med.form) && (
                        <div className="text-sm text-muted-foreground mt-2">
                          <span className="text-xs text-muted-foreground">Strength & Form: </span>
                          {[med.strength, med.form].filter(Boolean).join(" • ") || "—"}
                        </div>
                      )}
                      {(med.dosage || med.frequency) && (
                        <div className="text-sm text-muted-foreground">
                          <span className="text-xs text-muted-foreground">Dosage & Frequency: </span>
                          {[med.dosage, med.frequency].filter(Boolean).join(" • ") || "—"}
                        </div>
                      )}
                      {med.notes && (
                        <div className="text-sm text-muted-foreground mt-2">
                          <span className="text-xs text-muted-foreground">Notes: </span>
                          {med.notes}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleEdit(index)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemove(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        onClick={handleAdd}
        className="w-full"
      >
        <Plus className="h-4 w-4 mr-2" />
        Add Medication
      </Button>
    </div>
  );
}

// Vaccines Section Component
function VaccinesSection({ form }: { form: any }) {
  const vaccinesValue = form.watch("vaccines");
  // Ensure vaccines is always an array
  const vaccines = React.useMemo(() => {
    if (Array.isArray(vaccinesValue)) {
      return vaccinesValue;
    }
    return [];
  }, [vaccinesValue]);

  const [editingIndex, setEditingIndex] = React.useState<number | null>(null);
  const [editData, setEditData] = React.useState({
    name: "",
    date: "",
    dose: "",
    site: "",
    route: "",
    lotNumber: "",
    manufacturer: "",
  });

  // Helper to ensure vaccines is always an array
  const getVaccinesArray = () => {
    const value = form.getValues("vaccines");
    if (Array.isArray(value)) {
      return value;
    }
    return [];
  };

  const handleAdd = () => {
    const newVaccine = {
      name: "",
      date: "",
      dose: "",
      site: "",
      route: "",
      lotNumber: "",
      manufacturer: "",
    };
    const current = getVaccinesArray();
    form.setValue("vaccines", [...current, newVaccine]);
    setEditingIndex(current.length);
    setEditData(newVaccine);
  };

  const handleEdit = (index: number) => {
    const vaccine = vaccines[index];
    if (vaccine) {
      setEditingIndex(index);
      setEditData({
        name: vaccine.name || "",
        date: vaccine.date || "",
        dose: vaccine.dose || "",
        site: vaccine.site || "",
        route: vaccine.route || "",
        lotNumber: vaccine.lotNumber || "",
        manufacturer: vaccine.manufacturer || "",
      });
    }
  };

  const handleSave = (index: number) => {
    const current = getVaccinesArray();
    current[index] = {
      ...current[index],
      ...editData,
    };
    form.setValue("vaccines", current);
    setEditingIndex(null);
    setEditData({
      name: "",
      date: "",
      dose: "",
      site: "",
      route: "",
      lotNumber: "",
      manufacturer: "",
    });
  };

  const handleCancel = () => {
    setEditingIndex(null);
    setEditData({
      name: "",
      date: "",
      dose: "",
      site: "",
      route: "",
      lotNumber: "",
      manufacturer: "",
    });
  };

  const handleRemove = (index: number) => {
    const current = getVaccinesArray();
    form.setValue("vaccines", current.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      {vaccines.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No vaccines added yet
        </div>
      ) : (
        <div className="space-y-3">
          {vaccines.map((vaccine, index) => (
            <div
              key={index}
              className="border rounded-lg p-4 space-y-3 bg-card"
            >
              {editingIndex === index ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Vaccine</Label>
                    <Input
                      value={editData.name}
                      onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                      placeholder="Search vaccine (e.g. Tdap)"
                    />
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Date</Label>
                      <Input
                        type="date"
                        value={editData.date}
                        onChange={(e) => setEditData({ ...editData, date: e.target.value })}
                        placeholder="mm/dd/yyyy"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Dose #</Label>
                      <Select
                        value={editData.dose}
                        onValueChange={(value) => setEditData({ ...editData, dose: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select dose" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">1</SelectItem>
                          <SelectItem value="2">2</SelectItem>
                          <SelectItem value="3">3</SelectItem>
                          <SelectItem value="Booster">Booster</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Site</Label>
                    <Select
                      value={editData.site}
                      onValueChange={(value) => setEditData({ ...editData, site: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select site" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Left Deltoid">Left Deltoid</SelectItem>
                        <SelectItem value="Right Deltoid">Right Deltoid</SelectItem>
                        <SelectItem value="Left Thigh">Left Thigh</SelectItem>
                        <SelectItem value="Right Thigh">Right Thigh</SelectItem>
                        <SelectItem value="Other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                      <Label>Route</Label>
                      <Select
                        value={editData.route}
                        onValueChange={(value) => setEditData({ ...editData, route: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select route" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Intramuscular (IM)">Intramuscular (IM)</SelectItem>
                          <SelectItem value="Subcutaneous (SC)">Subcutaneous (SC)</SelectItem>
                          <SelectItem value="Intranasal">Intranasal</SelectItem>
                          <SelectItem value="Oral">Oral</SelectItem>
                          <SelectItem value="Other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Lot Number</Label>
                      <Input
                        value={editData.lotNumber}
                        onChange={(e) => setEditData({ ...editData, lotNumber: e.target.value })}
                        placeholder="Lot #"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Manufacturer</Label>
                      <Select
                        value={editData.manufacturer}
                        onValueChange={(value) => setEditData({ ...editData, manufacturer: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select Manufacturer" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Pfizer">Pfizer</SelectItem>
                          <SelectItem value="Moderna">Moderna</SelectItem>
                          <SelectItem value="Johnson & Johnson">Johnson & Johnson</SelectItem>
                          <SelectItem value="Novavax">Novavax</SelectItem>
                          <SelectItem value="GSK">GSK</SelectItem>
                          <SelectItem value="Sanofi">Sanofi</SelectItem>
                          <SelectItem value="Other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleSave(index)}
                      disabled={!editData.name.trim()}
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCancel}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-1">
                      <div className="font-medium">{vaccine.name || "Unnamed Vaccine"}</div>
                      <div className="text-sm text-muted-foreground space-y-1">
                        {vaccine.date && <div>Date: {vaccine.date}</div>}
                        {vaccine.dose && <div>Dose: {vaccine.dose}</div>}
                        {vaccine.site && <div>Site: {vaccine.site}</div>}
                        {vaccine.route && <div>Route: {vaccine.route}</div>}
                        {vaccine.lotNumber && <div>Lot #: {vaccine.lotNumber}</div>}
                        {vaccine.manufacturer && <div>Manufacturer: {vaccine.manufacturer}</div>}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleEdit(index)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemove(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        onClick={handleAdd}
        className="w-full"
      >
        <Plus className="h-4 w-4 mr-2" />
        Add Vaccine
      </Button>
    </div>
  );
}

// Family History Section Component
function FamilyHistorySection({ form }: { form: any }) {
  const familyHistoryValue = form.watch("familyHistory");
  // Ensure familyHistory is always an array
  const familyHistory = React.useMemo(() => {
    if (Array.isArray(familyHistoryValue)) {
      return familyHistoryValue;
    }
    return [];
  }, [familyHistoryValue]);

  const [editingIndex, setEditingIndex] = React.useState<number | null>(null);
  const [editData, setEditData] = React.useState({
    relationship: "",
    status: "",
    conditions: "",
  });

  // Use refs to track latest values for cleanup
  const editingIndexRef = React.useRef<number | null>(null);
  const editDataRef = React.useRef(editData);

  React.useEffect(() => {
    editingIndexRef.current = editingIndex;
    editDataRef.current = editData;
  }, [editingIndex, editData]);

  // Auto-save pending edits when component unmounts (section change)
  React.useEffect(() => {
    return () => {
      // Save any pending edits when leaving the family history section
      if (editingIndexRef.current !== null && editDataRef.current.relationship?.trim()) {
        const current = getFamilyHistoryArray();
        const existingEntry = current[editingIndexRef.current];
        if (existingEntry) {
          current[editingIndexRef.current] = {
            ...existingEntry,
            ...editDataRef.current,
          };
          form.setValue("familyHistory", current);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Helper to ensure familyHistory is always an array
  const getFamilyHistoryArray = () => {
    const value = form.getValues("familyHistory");
    if (Array.isArray(value)) {
      return value;
    }
    return [];
  };

  const handleAdd = () => {
    const newEntry = {
      relationship: "",
      status: "",
      conditions: "",
    };
    const current = getFamilyHistoryArray();
    form.setValue("familyHistory", [...current, newEntry]);
    setEditingIndex(current.length);
    setEditData(newEntry);
  };

  const handleEdit = (index: number) => {
    const entry = familyHistory[index];
    if (entry) {
      setEditingIndex(index);
      setEditData({
        relationship: entry.relationship || "",
        status: entry.status || "",
        conditions: entry.conditions || "",
      });
    }
  };

  const handleSave = (index: number) => {
    const current = getFamilyHistoryArray();
    current[index] = {
      ...current[index],
      ...editData,
    };
    form.setValue("familyHistory", current);
    setEditingIndex(null);
    setEditData({
      relationship: "",
      status: "",
      conditions: "",
    });
  };

  const handleCancel = () => {
    setEditingIndex(null);
    setEditData({
      relationship: "",
      status: "",
      conditions: "",
    });
  };

  const handleRemove = (index: number) => {
    const current = getFamilyHistoryArray();
    form.setValue("familyHistory", current.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      {familyHistory.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No family history entries added yet
        </div>
      ) : (
        <div className="space-y-3">
          {familyHistory.map((entry, index) => (
            <div
              key={index}
              className="border rounded-lg p-4 space-y-3 bg-card"
            >
              {editingIndex === index ? (
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Relationship</Label>
                      <Select
                        value={editData.relationship}
                        onValueChange={(value) => setEditData({ ...editData, relationship: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Mother">Mother</SelectItem>
                          <SelectItem value="Father">Father</SelectItem>
                          <SelectItem value="Sister">Sister</SelectItem>
                          <SelectItem value="Brother">Brother</SelectItem>
                          <SelectItem value="Maternal Grandmother">Maternal Grandmother</SelectItem>
                          <SelectItem value="Maternal Grandfather">Maternal Grandfather</SelectItem>
                          <SelectItem value="Paternal Grandmother">Paternal Grandmother</SelectItem>
                          <SelectItem value="Paternal Grandfather">Paternal Grandfather</SelectItem>
                          <SelectItem value="Aunt">Aunt</SelectItem>
                          <SelectItem value="Uncle">Uncle</SelectItem>
                          <SelectItem value="Cousin">Cousin</SelectItem>
                          <SelectItem value="Other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Status</Label>
                      <Select
                        value={editData.status}
                        onValueChange={(value) => setEditData({ ...editData, status: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Living">Living</SelectItem>
                          <SelectItem value="Deceased">Deceased</SelectItem>
                          <SelectItem value="Unknown">Unknown</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Known Conditions</Label>
                    <Input
                      value={editData.conditions}
                      onChange={(e) => setEditData({ ...editData, conditions: e.target.value })}
                      placeholder="Search other conditions..."
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleSave(index)}
                      disabled={!editData.relationship.trim()}
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCancel}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-1">
                      <div className="font-medium">
                        {entry.relationship || "Unnamed Relationship"}
                        {entry.status && (
                          <span className="text-muted-foreground ml-2">({entry.status})</span>
                        )}
                      </div>
                      {entry.conditions && (
                        <div className="text-sm text-muted-foreground">
                          Conditions: {entry.conditions}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleEdit(index)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemove(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        onClick={handleAdd}
        className="w-full"
      >
        <Plus className="h-4 w-4 mr-2" />
        Add Family History Entry
      </Button>
    </div>
  );
}

// Surgical History Section Component
function SurgicalHistorySection({ form }: { form: any }) {
  const surgicalHistoryValue = form.watch("surgicalHistory");
  // Ensure surgicalHistory is always an array
  const surgicalHistory = React.useMemo(() => {
    if (Array.isArray(surgicalHistoryValue)) {
      return surgicalHistoryValue;
    }
    return [];
  }, [surgicalHistoryValue]);

  const [editingIndex, setEditingIndex] = React.useState<number | null>(null);
  const [editData, setEditData] = React.useState({
    procedure: "",
    date: "",
    site: "",
    surgeon: "",
    outcome: "",
    source: "",
  });

  // Use refs to track latest values for cleanup
  const editingIndexRef = React.useRef<number | null>(null);
  const editDataRef = React.useRef(editData);

  React.useEffect(() => {
    editingIndexRef.current = editingIndex;
    editDataRef.current = editData;
  }, [editingIndex, editData]);

  // Auto-save pending edits when component unmounts (section change)
  React.useEffect(() => {
    return () => {
      // Save any pending edits when leaving the surgical history section
      if (editingIndexRef.current !== null && editDataRef.current.procedure?.trim()) {
        const current = getSurgicalHistoryArray();
        const existingEntry = current[editingIndexRef.current];
        if (existingEntry) {
          current[editingIndexRef.current] = {
            ...existingEntry,
            ...editDataRef.current,
          };
          form.setValue("surgicalHistory", current);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Helper to ensure surgicalHistory is always an array
  const getSurgicalHistoryArray = () => {
    const value = form.getValues("surgicalHistory");
    if (Array.isArray(value)) {
      return value;
    }
    return [];
  };

  const handleAdd = () => {
    const newEntry = {
      procedure: "",
      date: "",
      site: "",
      surgeon: "",
      outcome: "",
      source: "",
    };
    const current = getSurgicalHistoryArray();
    form.setValue("surgicalHistory", [...current, newEntry]);
    setEditingIndex(current.length);
    setEditData(newEntry);
  };

  const handleEdit = (index: number) => {
    const entry = surgicalHistory[index];
    if (entry) {
      setEditingIndex(index);
      setEditData({
        procedure: entry.procedure || "",
        date: entry.date || "",
        site: entry.site || "",
        surgeon: entry.surgeon || "",
        outcome: entry.outcome || "",
        source: entry.source || "",
      });
    }
  };

  const handleSave = (index: number) => {
    const current = getSurgicalHistoryArray();
    current[index] = {
      ...current[index],
      ...editData,
    };
    form.setValue("surgicalHistory", current);
    setEditingIndex(null);
    setEditData({
      procedure: "",
      date: "",
      site: "",
      surgeon: "",
      outcome: "",
      source: "",
    });
  };

  const handleCancel = () => {
    setEditingIndex(null);
    setEditData({
      procedure: "",
      date: "",
      site: "",
      surgeon: "",
      outcome: "",
      source: "",
    });
  };

  const handleRemove = (index: number) => {
    const current = getSurgicalHistoryArray();
    form.setValue("surgicalHistory", current.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      {surgicalHistory.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No surgical history entries added yet
        </div>
      ) : (
        <div className="space-y-3">
          {surgicalHistory.map((entry, index) => (
            <div
              key={index}
              className="border rounded-lg p-4 space-y-3 bg-card"
            >
              {editingIndex === index ? (
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Procedure</Label>
                      <Input
                        value={editData.procedure}
                        onChange={(e) => setEditData({ ...editData, procedure: e.target.value })}
                        placeholder="e.g. Appendectomy"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Date / Year</Label>
                      <Input
                        value={editData.date}
                        onChange={(e) => setEditData({ ...editData, date: e.target.value })}
                        placeholder="YYYY"
                      />
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Site</Label>
                      <Input
                        value={editData.site}
                        onChange={(e) => setEditData({ ...editData, site: e.target.value })}
                        placeholder="e.g., Left Knee"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Surgeon</Label>
                      <Input
                        value={editData.surgeon}
                        onChange={(e) => setEditData({ ...editData, surgeon: e.target.value })}
                        placeholder="e.g., Dr. R. Miller"
                      />
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Outcome</Label>
                      <Select
                        value={editData.outcome}
                        onValueChange={(value) => setEditData({ ...editData, outcome: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="No Issues">No Issues</SelectItem>
                          <SelectItem value="Complications">Complications</SelectItem>
                          <SelectItem value="Recovery Ongoing">Recovery Ongoing</SelectItem>
                          <SelectItem value="Full Recovery">Full Recovery</SelectItem>
                          <SelectItem value="Unknown">Unknown</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Source</Label>
                      <Select
                        value={editData.source}
                        onValueChange={(value) => setEditData({ ...editData, source: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Patient Reported">Patient Reported</SelectItem>
                          <SelectItem value="Medical Records">Medical Records</SelectItem>
                          <SelectItem value="Provider Verified">Provider Verified</SelectItem>
                          <SelectItem value="Unknown">Unknown</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleSave(index)}
                      disabled={!editData.procedure.trim()}
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCancel}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-1">
                      <div className="font-medium">{entry.procedure || "Unnamed Procedure"}</div>
                      <div className="text-sm text-muted-foreground space-y-1">
                        {entry.date && <div>Date: {entry.date}</div>}
                        {entry.site && <div>Site: {entry.site}</div>}
                        {entry.surgeon && <div>Surgeon: {entry.surgeon}</div>}
                        {entry.outcome && <div>Outcome: {entry.outcome}</div>}
                        {entry.source && <div>Source: {entry.source}</div>}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleEdit(index)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemove(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        onClick={handleAdd}
        className="w-full"
      >
        <Plus className="h-4 w-4 mr-2" />
        Add Surgical History Entry
      </Button>
    </div>
  );
}

// Past Medical History Section Component
function PastMedicalHistorySection({ form }: { form: any }) {
  const pastMedicalHistoryValue = form.watch("pastMedicalHistory");
  // Ensure pastMedicalHistory is always an array
  const pastMedicalHistory = React.useMemo(() => {
    if (Array.isArray(pastMedicalHistoryValue)) {
      return pastMedicalHistoryValue;
    }
    return [];
  }, [pastMedicalHistoryValue]);

  const [editingIndex, setEditingIndex] = React.useState<number | null>(null);
  const [editData, setEditData] = React.useState({
    condition: "",
    status: "",
    diagnosedDate: "",
    impact: "",
    icd10: "",
    source: "",
  });

  // Use refs to track latest values for cleanup
  const editingIndexRef = React.useRef<number | null>(null);
  const editDataRef = React.useRef(editData);

  React.useEffect(() => {
    editingIndexRef.current = editingIndex;
    editDataRef.current = editData;
  }, [editingIndex, editData]);

  // Auto-save pending edits when component unmounts (section change)
  React.useEffect(() => {
    return () => {
      // Save any pending edits when leaving the past medical history section
      if (editingIndexRef.current !== null && editDataRef.current.condition?.trim()) {
        const current = getPastMedicalHistoryArray();
        const existingEntry = current[editingIndexRef.current];
        if (existingEntry) {
          current[editingIndexRef.current] = {
            ...existingEntry,
            ...editDataRef.current,
          };
          form.setValue("pastMedicalHistory", current);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Helper to ensure pastMedicalHistory is always an array
  const getPastMedicalHistoryArray = () => {
    const value = form.getValues("pastMedicalHistory");
    if (Array.isArray(value)) {
      return value;
    }
    return [];
  };

  const handleAdd = () => {
    const newEntry = {
      condition: "",
      status: "",
      diagnosedDate: "",
      impact: "",
      icd10: "",
      source: "",
    };
    const current = getPastMedicalHistoryArray();
    form.setValue("pastMedicalHistory", [...current, newEntry]);
    setEditingIndex(current.length);
    setEditData(newEntry);
  };

  const handleEdit = (index: number) => {
    const entry = pastMedicalHistory[index];
    if (entry) {
      setEditingIndex(index);
      setEditData({
        condition: entry.condition || "",
        status: entry.status || "",
        diagnosedDate: entry.diagnosedDate || "",
        impact: entry.impact || "",
        icd10: entry.icd10 || "",
        source: entry.source || "",
      });
    }
  };

  const handleSave = (index: number) => {
    const current = getPastMedicalHistoryArray();
    current[index] = {
      ...current[index],
      ...editData,
    };
    form.setValue("pastMedicalHistory", current);
    setEditingIndex(null);
    setEditData({
      condition: "",
      status: "",
      diagnosedDate: "",
      impact: "",
      icd10: "",
      source: "",
    });
  };

  const handleCancel = () => {
    setEditingIndex(null);
    setEditData({
      condition: "",
      status: "",
      diagnosedDate: "",
      impact: "",
      icd10: "",
      source: "",
    });
  };

  const handleRemove = (index: number) => {
    const current = getPastMedicalHistoryArray();
    form.setValue("pastMedicalHistory", current.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      {pastMedicalHistory.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No past medical history entries added yet
        </div>
      ) : (
        <div className="space-y-3">
          {pastMedicalHistory.map((entry, index) => (
            <div
              key={index}
              className="border rounded-lg p-4 space-y-3 bg-card"
            >
              {editingIndex === index ? (
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Condition</Label>
                      <Input
                        value={editData.condition}
                        onChange={(e) => setEditData({ ...editData, condition: e.target.value })}
                        placeholder="e.g., Type 2 Diabetes Mellitus"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Status</Label>
                      <Select
                        value={editData.status}
                        onValueChange={(value) => setEditData({ ...editData, status: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Active">Active</SelectItem>
                          <SelectItem value="Resolved">Resolved</SelectItem>
                          <SelectItem value="Chronic">Chronic</SelectItem>
                          <SelectItem value="Controlled">Controlled</SelectItem>
                          <SelectItem value="Unknown">Unknown</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Date Diagnosed</Label>
                      <Input
                        type="date"
                        value={editData.diagnosedDate}
                        onChange={(e) => setEditData({ ...editData, diagnosedDate: e.target.value })}
                        placeholder="mm/dd/yyyy"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Impact</Label>
                      <Select
                        value={editData.impact}
                        onValueChange={(value) => setEditData({ ...editData, impact: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Low">Low</SelectItem>
                          <SelectItem value="Moderate">Moderate</SelectItem>
                          <SelectItem value="High">High</SelectItem>
                          <SelectItem value="Critical">Critical</SelectItem>
                          <SelectItem value="Unknown">Unknown</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>ICD-10 Code</Label>
                      <Input
                        value={editData.icd10}
                        onChange={(e) => setEditData({ ...editData, icd10: e.target.value })}
                        placeholder="e.g., E11.9"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Source</Label>
                      <Select
                        value={editData.source}
                        onValueChange={(value) => setEditData({ ...editData, source: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Patient Reported">Patient Reported</SelectItem>
                          <SelectItem value="Medical Records">Medical Records</SelectItem>
                          <SelectItem value="Clinician">Clinician</SelectItem>
                          <SelectItem value="Provider Verified">Provider Verified</SelectItem>
                          <SelectItem value="Unknown">Unknown</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleSave(index)}
                      disabled={!editData.condition.trim()}
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCancel}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-1">
                      <div className="font-medium">{entry.condition || "Unnamed Condition"}</div>
                      <div className="text-sm text-muted-foreground space-y-1">
                        {entry.status && <div>Status: {entry.status}</div>}
                        {entry.diagnosedDate && <div>Diagnosed: {entry.diagnosedDate}</div>}
                        {entry.icd10 && <div>ICD-10: {entry.icd10}</div>}
                        {entry.impact && <div>Impact: {entry.impact}</div>}
                        {entry.source && <div>Source: {entry.source}</div>}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleEdit(index)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemove(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        onClick={handleAdd}
        className="w-full"
      >
        <Plus className="h-4 w-4 mr-2" />
        Add Past Medical History Entry
      </Button>
    </div>
  );
}

// Orders Section Component
function OrdersSection({ form }: { form: any }) {
  const ordersValue = form.watch("orders");
  // Ensure orders is always an array
  const orders = React.useMemo(() => {
    if (Array.isArray(ordersValue)) {
      return ordersValue;
    }
    return [];
  }, [ordersValue]);

  const [editingIndex, setEditingIndex] = React.useState<number | null>(null);
  const [editData, setEditData] = React.useState({
    type: "",
    priority: "",
    details: "",
    status: "",
    dateOrdered: "",
  });

  // Use refs to track latest values for cleanup
  const editingIndexRef = React.useRef<number | null>(null);
  const editDataRef = React.useRef(editData);

  React.useEffect(() => {
    editingIndexRef.current = editingIndex;
    editDataRef.current = editData;
  }, [editingIndex, editData]);

  // Auto-save pending edits when component unmounts (section change)
  React.useEffect(() => {
    return () => {
      // Save any pending edits when leaving the orders section
      if (editingIndexRef.current !== null && (editDataRef.current.type?.trim() || editDataRef.current.details?.trim())) {
        const current = getOrdersArray();
        const existingEntry = current[editingIndexRef.current];
        if (existingEntry) {
          current[editingIndexRef.current] = {
            ...existingEntry,
            ...editDataRef.current,
          };
          form.setValue("orders", current);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Helper to ensure orders is always an array
  const getOrdersArray = () => {
    const value = form.getValues("orders");
    if (Array.isArray(value)) {
      return value;
    }
    return [];
  };

  const handleAdd = () => {
    const newEntry = {
      type: "",
      priority: "",
      details: "",
      status: "",
      dateOrdered: "",
    };
    const current = getOrdersArray();
    form.setValue("orders", [...current, newEntry]);
    setEditingIndex(current.length);
    setEditData(newEntry);
  };

  const handleEdit = (index: number) => {
    const entry = orders[index];
    if (entry) {
      setEditingIndex(index);
      setEditData({
        type: entry.type || "",
        priority: entry.priority || "",
        details: entry.details || "",
        status: entry.status || "",
        dateOrdered: entry.dateOrdered || "",
      });
    }
  };

  const handleSave = (index: number) => {
    const current = getOrdersArray();
    current[index] = {
      ...current[index],
      ...editData,
    };
    form.setValue("orders", current);
    setEditingIndex(null);
    setEditData({
      type: "",
      priority: "",
      details: "",
      status: "",
      dateOrdered: "",
    });
  };

  const handleCancel = () => {
    setEditingIndex(null);
    setEditData({
      type: "",
      priority: "",
      details: "",
      status: "",
      dateOrdered: "",
    });
  };

  const handleRemove = (index: number) => {
    const current = getOrdersArray();
    form.setValue("orders", current.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      {orders.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No orders added yet
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order, index) => (
            <div
              key={index}
              className="border rounded-lg p-4 space-y-3 bg-card"
            >
              {editingIndex === index ? (
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Order Type</Label>
                      <Select
                        value={editData.type}
                        onValueChange={(value) => setEditData({ ...editData, type: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Medication">Medication</SelectItem>
                          <SelectItem value="Lab">Lab</SelectItem>
                          <SelectItem value="Imaging">Imaging</SelectItem>
                          <SelectItem value="Procedure">Procedure</SelectItem>
                          <SelectItem value="Referral">Referral</SelectItem>
                          <SelectItem value="Other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Priority</Label>
                      <Select
                        value={editData.priority}
                        onValueChange={(value) => setEditData({ ...editData, priority: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Stat">Stat</SelectItem>
                          <SelectItem value="Urgent">Urgent</SelectItem>
                          <SelectItem value="Routine">Routine</SelectItem>
                          <SelectItem value="Elective">Elective</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Order Details</Label>
                    <Input
                      value={editData.details}
                      onChange={(e) => setEditData({ ...editData, details: e.target.value })}
                      placeholder="e.g., CBC with Differential"
                    />
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Status</Label>
                      <Select
                        value={editData.status}
                        onValueChange={(value) => setEditData({ ...editData, status: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Pending">Pending</SelectItem>
                          <SelectItem value="Ordered">Ordered</SelectItem>
                          <SelectItem value="In Progress">In Progress</SelectItem>
                          <SelectItem value="Completed">Completed</SelectItem>
                          <SelectItem value="Cancelled">Cancelled</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Date Ordered</Label>
                      <Input
                        type="date"
                        value={editData.dateOrdered}
                        onChange={(e) => setEditData({ ...editData, dateOrdered: e.target.value })}
                        placeholder="mm/dd/yyyy"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleSave(index)}
                      disabled={!editData.type.trim() || !editData.details.trim()}
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCancel}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-1">
                      <div className="font-medium">{order.details || "Unnamed Order"}</div>
                      <div className="text-sm text-muted-foreground space-y-1">
                        {order.type && <div>Type: {order.type}</div>}
                        {order.priority && <div>Priority: {order.priority}</div>}
                        {order.status && <div>Status: {order.status}</div>}
                        {order.dateOrdered && <div>Date Ordered: {order.dateOrdered}</div>}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleEdit(index)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemove(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        onClick={handleAdd}
        className="w-full"
      >
        <Plus className="h-4 w-4 mr-2" />
        Add Order
      </Button>
    </div>
  );
}

// Assessment & Plan Section Component
function AssessmentPlanSection({ form }: { form: any }) {
  const assessmentPlanValue = form.watch("assessmentPlan");
  // Ensure assessmentPlan is always an array
  const assessmentPlans = React.useMemo(() => {
    // Handle migration from old format (object with assessment/plan) to new format (array)
    if (!assessmentPlanValue) return [];
    if (Array.isArray(assessmentPlanValue)) {
      return assessmentPlanValue;
    }
    // If it's the old format (object with assessment/plan), convert to array
    if (typeof assessmentPlanValue === "object" && "assessment" in assessmentPlanValue) {
      const old = assessmentPlanValue as { assessment?: string; plan?: string };
      if (old.assessment || old.plan) {
        return [{
          assessment: old.assessment || "",
          plan: old.plan || "",
          medications: [],
          orders: [],
          followUp: "",
          education: "",
          coordination: "",
        }];
      }
    }
    return [];
  }, [assessmentPlanValue]);

  const [editingIndex, setEditingIndex] = React.useState<number | null>(null);
  const [editData, setEditData] = React.useState({
    assessment: "",
    plan: "",
    medications: [] as Array<{ brandName: string; strength: string; form: string; dosage: string; frequency: string }>,
    orders: [] as Array<{ type: string; priority: string; details: string; status: string; dateOrdered: string }>,
    followUp: "",
    education: "",
    coordination: "",
  });

  // Helper to ensure assessmentPlan is always an array
  const getAssessmentPlanArray = () => {
    const value = form.getValues("assessmentPlan");
    if (Array.isArray(value)) {
      return value;
    }
    // Handle old format migration
    if (value && typeof value === "object" && "assessment" in value) {
      const old = value as { assessment?: string; plan?: string };
      if (old.assessment || old.plan) {
        return [{
          assessment: old.assessment || "",
          plan: old.plan || "",
          medications: [],
          orders: [],
          followUp: "",
          education: "",
          coordination: "",
        }];
      }
    }
    return [];
  };

  const handleAdd = () => {
    const newEntry = {
      assessment: "",
      plan: "",
      medications: [],
      orders: [],
      followUp: "",
      education: "",
      coordination: "",
    };
    const current = getAssessmentPlanArray();
    form.setValue("assessmentPlan", [...current, newEntry]);
    setEditingIndex(current.length);
    setEditData(newEntry);
  };

  const handleEdit = (index: number) => {
    const entry = assessmentPlans[index];
    if (entry) {
      setEditingIndex(index);
      setEditData({
        assessment: entry.assessment || "",
        plan: entry.plan || "",
        medications: entry.medications || [],
        orders: entry.orders || [],
        followUp: entry.followUp || "",
        education: entry.education || "",
        coordination: entry.coordination || "",
      });
    }
  };

  const handleSave = (index: number) => {
    const current = getAssessmentPlanArray();
    current[index] = {
      ...current[index],
      ...editData,
    };
    form.setValue("assessmentPlan", current);
    setEditingIndex(null);
    setEditData({
      assessment: "",
      plan: "",
      medications: [],
      orders: [],
      followUp: "",
      education: "",
      coordination: "",
    });
  };

  const handleCancel = () => {
    setEditingIndex(null);
    setEditData({
      assessment: "",
      plan: "",
      medications: [],
      orders: [],
      followUp: "",
      education: "",
      coordination: "",
    });
  };

  const handleRemove = (index: number) => {
    const current = getAssessmentPlanArray();
    current.splice(index, 1);
    form.setValue("assessmentPlan", current);
    if (editingIndex === index) {
      setEditingIndex(null);
      setEditData({
        assessment: "",
        plan: "",
        medications: [],
        orders: [],
        followUp: "",
        education: "",
        coordination: "",
      });
    }
  };

  const handleAddMedication = () => {
    setEditData({
      ...editData,
      medications: [...editData.medications, { brandName: "", strength: "", form: "", dosage: "", frequency: "" }],
    });
  };

  const handleUpdateMedication = (medIndex: number, field: string, value: string) => {
    const updated = [...editData.medications];
    updated[medIndex] = { ...updated[medIndex], [field]: value };
    setEditData({ ...editData, medications: updated });
  };

  const handleRemoveMedication = (medIndex: number) => {
    setEditData({
      ...editData,
      medications: editData.medications.filter((_, i) => i !== medIndex),
    });
  };

  const handleAddOrder = () => {
    setEditData({
      ...editData,
      orders: [...editData.orders, { type: "", priority: "", details: "", status: "", dateOrdered: "" }],
    });
  };

  const handleUpdateOrder = (orderIndex: number, field: string, value: string) => {
    const updated = [...editData.orders];
    updated[orderIndex] = { ...updated[orderIndex], [field]: value };
    setEditData({ ...editData, orders: updated });
  };

  const handleRemoveOrder = (orderIndex: number) => {
    setEditData({
      ...editData,
      orders: editData.orders.filter((_, i) => i !== orderIndex),
    });
  };

  return (
    <div className="space-y-4">
      {assessmentPlans.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No assessment & plan entries yet
        </div>
      ) : (
        <div className="space-y-3">
          {assessmentPlans.map((item: any, index: number) => (
            <div
              key={index}
              className="border rounded-lg p-4 space-y-3 bg-card"
            >
              {editingIndex === index ? (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <Label className="text-base font-semibold">Assessment</Label>
                    <Textarea
                      value={editData.assessment}
                      onChange={(e) => setEditData({ ...editData, assessment: e.target.value })}
                      placeholder="e.g., Acute Otitis Media – New (H66.90)"
                      rows={2}
                      className="min-h-[60px]"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-base font-semibold">Plan</Label>
                    <Textarea
                      value={editData.plan}
                      onChange={(e) => setEditData({ ...editData, plan: e.target.value })}
                      placeholder="e.g., Start antibiotics."
                      rows={2}
                      className="min-h-[60px]"
                    />
                  </div>

                  {/* Medications */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-base font-semibold">Medications</Label>
                      <Button type="button" size="sm" variant="outline" onClick={handleAddMedication}>
                        <Plus className="h-3 w-3 mr-1" />
                        Add
                      </Button>
                    </div>
                    {editData.medications.length === 0 ? (
                      <div className="text-sm text-muted-foreground py-2">No medications added</div>
                    ) : (
                      <div className="space-y-2">
                        {editData.medications.map((med, medIndex) => (
                          <div key={medIndex} className="border rounded p-3 space-y-2 bg-muted/30">
                            <div className="grid grid-cols-2 gap-2">
                              <Input
                                value={med.brandName}
                                onChange={(e) => handleUpdateMedication(medIndex, "brandName", e.target.value)}
                                placeholder="Medication name (e.g., Amoxicillin 400 mg/5 mL)"
                                className="col-span-2"
                              />
                              <Input
                                value={med.dosage}
                                onChange={(e) => handleUpdateMedication(medIndex, "dosage", e.target.value)}
                                placeholder="Dosage (e.g., 7.5 mL)"
                              />
                              <Input
                                value={med.frequency}
                                onChange={(e) => handleUpdateMedication(medIndex, "frequency", e.target.value)}
                                placeholder="Frequency (e.g., PO BID x 10 days)"
                              />
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => handleRemoveMedication(medIndex)}
                              className="w-full"
                            >
                              <Trash2 className="h-3 w-3 mr-1" />
                              Remove
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Orders */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-base font-semibold">Orders</Label>
                      <Button type="button" size="sm" variant="outline" onClick={handleAddOrder}>
                        <Plus className="h-3 w-3 mr-1" />
                        Add
                      </Button>
                    </div>
                    {editData.orders.length === 0 ? (
                      <div className="text-sm text-muted-foreground py-2">No orders added</div>
                    ) : (
                      <div className="space-y-2">
                        {editData.orders.map((order, orderIndex) => (
                          <div key={orderIndex} className="border rounded p-3 space-y-2 bg-muted/30">
                            <Input
                              value={order.details}
                              onChange={(e) => handleUpdateOrder(orderIndex, "details", e.target.value)}
                              placeholder="Order details"
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => handleRemoveOrder(orderIndex)}
                              className="w-full"
                            >
                              <Trash2 className="h-3 w-3 mr-1" />
                              Remove
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label className="text-base font-semibold">Follow-up</Label>
                    <Textarea
                      value={editData.followUp}
                      onChange={(e) => setEditData({ ...editData, followUp: e.target.value })}
                      placeholder="e.g., PRN if no improvement in 48 hours"
                      rows={2}
                      className="min-h-[60px]"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-base font-semibold">Education</Label>
                    <Textarea
                      value={editData.education}
                      onChange={(e) => setEditData({ ...editData, education: e.target.value })}
                      placeholder="e.g., Discussed expected course and return precautions."
                      rows={2}
                      className="min-h-[60px]"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-base font-semibold">Coordination</Label>
                    <Textarea
                      value={editData.coordination}
                      onChange={(e) => setEditData({ ...editData, coordination: e.target.value })}
                      placeholder="e.g., None"
                      rows={2}
                      className="min-h-[60px]"
                    />
                  </div>

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleSave(index)}
                      disabled={!editData.assessment.trim() && !editData.plan.trim()}
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCancel}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-4">
                      {item.assessment && (
                        <div>
                          <div className="font-medium text-sm text-muted-foreground mb-1">Assessment:</div>
                          <div className="text-sm whitespace-pre-wrap">{item.assessment}</div>
                        </div>
                      )}
                      {item.plan && (
                        <div>
                          <div className="font-medium text-sm text-muted-foreground mb-1">Plan:</div>
                          <div className="text-sm whitespace-pre-wrap">{item.plan}</div>
                        </div>
                      )}
                      {item.medications && Array.isArray(item.medications) && item.medications.length > 0 && (
                        <div>
                          <div className="font-medium text-sm text-muted-foreground mb-1">Medications:</div>
                          <div className="text-sm space-y-1">
                            {item.medications.map((med: any, medIndex: number) => (
                              <div key={medIndex} className="pl-2">
                                {med.brandName} {med.dosage && med.dosage} {med.frequency && med.frequency}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {item.orders && Array.isArray(item.orders) && item.orders.length > 0 && (
                        <div>
                          <div className="font-medium text-sm text-muted-foreground mb-1">Orders:</div>
                          <div className="text-sm space-y-1">
                            {item.orders.map((order: any, orderIndex: number) => (
                              <div key={orderIndex} className="pl-2">
                                {order.details || "None"}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {item.followUp && (
                        <div>
                          <div className="font-medium text-sm text-muted-foreground mb-1">Follow-up:</div>
                          <div className="text-sm whitespace-pre-wrap">{item.followUp}</div>
                        </div>
                      )}
                      {item.education && (
                        <div>
                          <div className="font-medium text-sm text-muted-foreground mb-1">Education:</div>
                          <div className="text-sm whitespace-pre-wrap">{item.education}</div>
                        </div>
                      )}
                      {item.coordination && (
                        <div>
                          <div className="font-medium text-sm text-muted-foreground mb-1">Coordination:</div>
                          <div className="text-sm whitespace-pre-wrap">{item.coordination}</div>
                        </div>
                      )}
                      {!item.assessment && !item.plan && (
                        <div className="text-sm text-muted-foreground">Empty entry</div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleEdit(index)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemove(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        onClick={handleAdd}
        className="w-full"
      >
        <Plus className="h-4 w-4 mr-2" />
        Add Assessment & Plan
      </Button>
    </div>
  );
}

// Documents Section Component
function DocumentsSection({ form, patientId, visitId }: { form: any; patientId: string; visitId: string | null }) {
  const docsValue = form.watch("docs");
  const uploadedDocuments = docsValue?.uploadedDocuments || [];

  const [isUploading, setIsUploading] = React.useState(false);
  const [isCapturing, setIsCapturing] = React.useState(false);
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [stream, setStream] = React.useState<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);

    try {
      const newDocuments = [...uploadedDocuments];

      for (const file of Array.from(files)) {
        // Validate file type
        const allowedTypes = [
          "image/jpeg",
          "image/jpg",
          "image/png",
          "image/gif",
          "image/webp",
          "application/pdf",
          "application/msword",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ];

        if (!allowedTypes.includes(file.type)) {
          toast.error(`File type not allowed: ${file.name}`);
          continue;
        }

        // Validate file size (10MB max)
        const maxSize = 10 * 1024 * 1024;
        if (file.size > maxSize) {
          toast.error(`File too large: ${file.name} (max 10MB)`);
          continue;
        }

        // Create preview data URL for images
        let dataUrl: string | undefined;
        if (file.type.startsWith("image/")) {
          dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
        }

        // Upload file to server
        const formData = new FormData();
        formData.append("file", file);
        formData.append("patientId", patientId);
        if (visitId) {
          formData.append("visitId", visitId);
        }

        const uploadResponse = await fetch("/api/upload/document", {
          method: "POST",
          body: formData,
        });

        if (!uploadResponse.ok) {
          const error = await uploadResponse.json();
          throw new Error(error.error || "Upload failed");
        }

        const uploadData = await uploadResponse.json();

        // Add to local state with storageUrl for later DB save
        newDocuments.push({
          id: crypto.randomUUID(),
          name: file.name,
          type: file.type,
          size: file.size,
          uploadedAt: new Date().toISOString(),
          dataUrl,
          storageUrl: uploadData.storageUrl, // Store for later DB save
        });

        // Save document metadata to DB if visitId exists
        if (visitId) {
          const result = await createDocumentAction({
            patientId,
            visitId,
            filename: file.name,
            mimeType: file.type,
            size: file.size.toString(),
            storageUrl: uploadData.storageUrl,
          });

          if (!result.success) {
            console.error("Failed to save document metadata:", result.error);
            // Continue anyway - file is uploaded, metadata can be saved later
          }
        }
      }

      // Update form state
      form.setValue("docs", {
        uploadedDocuments: newDocuments,
      });

      toast.success(`Uploaded ${newDocuments.length - uploadedDocuments.length} document(s)`);
    } catch (error) {
      console.error("Error uploading documents:", error);
      toast.error(error instanceof Error ? error.message : "Failed to upload documents");
    } finally {
      setIsUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleRemove = (index: number) => {
    const newDocuments = uploadedDocuments.filter((_doc: unknown, i: number) => i !== index);
    form.setValue("docs", {
      uploadedDocuments: newDocuments,
    });
  };

  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment", // Prefer back camera on mobile
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      setStream(mediaStream);
      setIsCapturing(true);
      setCapturedImage(null);

      // Use setTimeout to ensure video element is rendered
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          videoRef.current.play().catch((err) => {
            console.error("Error playing video:", err);
          });
        }
      }, 100);
    } catch (error) {
      console.error("Error accessing camera:", error);
      toast.error("Failed to access camera. Please check permissions.");
      setIsCapturing(false);
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
    setIsCapturing(false);
    setCapturedImage(null);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const capturePhoto = async () => {
    if (!videoRef.current || !canvasRef.current) {
      toast.error("Camera not ready. Please wait a moment.");
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");

    if (!context) {
      toast.error("Failed to initialize canvas.");
      return;
    }

    // Check if video is ready
    if (video.readyState !== video.HAVE_ENOUGH_DATA) {
      toast.error("Video not ready. Please wait a moment.");
      return;
    }

    // Set processing state
    setIsProcessing(true);

    try {
      // Set canvas dimensions to match video
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;

      // Draw video frame to canvas
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Convert canvas to blob
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), "image/jpeg", 0.9);
      });

      if (!blob) {
        toast.error("Failed to capture photo.");
        setIsProcessing(false);
        return;
      }

      // Convert blob to File
      const file = new File([blob], `photo-${Date.now()}.jpg`, {
        type: "image/jpeg",
      });

      // Stop camera
      stopCamera();

      // Upload the captured photo
      await handleFileUpload(file);
    } catch (error) {
      console.error("Error capturing photo:", error);
      toast.error("Failed to capture photo.");
      setIsProcessing(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    setIsProcessing(false);
    setIsUploading(true);

    try {
      const newDocuments = [...uploadedDocuments];

      // Validate file type
      const allowedTypes = [
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/gif",
        "image/webp",
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ];

      if (!allowedTypes.includes(file.type)) {
        toast.error(`File type not allowed: ${file.name}`);
        setIsUploading(false);
        setIsProcessing(false);
        return;
      }

      // Validate file size (10MB max)
      const maxSize = 10 * 1024 * 1024;
      if (file.size > maxSize) {
        toast.error(`File too large: ${file.name} (max 10MB)`);
        setIsUploading(false);
        setIsProcessing(false);
        return;
      }

      // Create preview data URL for images
      let dataUrl: string | undefined;
      if (file.type.startsWith("image/")) {
        dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      }

      // Upload file to server
      const formData = new FormData();
      formData.append("file", file);
      formData.append("patientId", patientId);
      if (visitId) {
        formData.append("visitId", visitId);
      }

      const uploadResponse = await fetch("/api/upload/document", {
        method: "POST",
        body: formData,
      });

      if (!uploadResponse.ok) {
        const error = await uploadResponse.json();
        throw new Error(error.error || "Upload failed");
      }

      const uploadData = await uploadResponse.json();

      // Add to local state with storageUrl for later DB save
      newDocuments.push({
        id: crypto.randomUUID(),
        name: file.name,
        type: file.type,
        size: file.size,
        uploadedAt: new Date().toISOString(),
        dataUrl,
        storageUrl: uploadData.storageUrl, // Store for later DB save
      });

      // Save document metadata to DB if visitId exists
      if (visitId) {
        const result = await createDocumentAction({
          patientId,
          visitId,
          filename: file.name,
          mimeType: file.type,
          size: file.size.toString(),
          storageUrl: uploadData.storageUrl,
        });

        if (!result.success) {
          console.error("Failed to save document metadata:", result.error);
          // Continue anyway - file is uploaded, metadata can be saved later
        }
      }

      // Update form state
      form.setValue("docs", {
        uploadedDocuments: newDocuments,
      });

      toast.success("Photo uploaded successfully");
    } catch (error) {
      console.error("Error uploading photo:", error);
      toast.error(error instanceof Error ? error.message : "Failed to upload photo");
    } finally {
      setIsUploading(false);
      setIsProcessing(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString();
    } catch {
      return dateString;
    }
  };

  // Set video stream when it changes
  React.useEffect(() => {
    if (stream && videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch((err) => {
        console.error("Error playing video:", err);
      });
    }
    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [stream]);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Upload Documents</Label>
        <div className="flex gap-2">
          <Input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.doc,.docx"
            multiple
            onChange={handleFileSelect}
            disabled={isUploading || isCapturing}
            className="cursor-pointer flex-1"
          />
          <Button
            type="button"
            variant="outline"
            onClick={isCapturing ? stopCamera : startCamera}
            disabled={isUploading}
          >
            {isCapturing ? (
              <>
                <X className="h-4 w-4 mr-2" />
                Cancel
              </>
            ) : (
              <>
                <Camera className="h-4 w-4 mr-2" />
                Take Photo
              </>
            )}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Allowed: Images, PDF, DOC, DOCX (max 10MB per file)
        </p>
      </div>

      {/* Camera Preview */}
      {isCapturing && (
        <div className="space-y-2 border rounded-lg p-4 bg-card">
          <div className="relative bg-black rounded-lg overflow-hidden">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full max-w-md mx-auto rounded-lg"
              style={{
                transform: "scaleX(-1)",
                maxHeight: "400px",
                objectFit: "contain",
              }}
              onLoadedMetadata={() => {
                if (videoRef.current) {
                  videoRef.current.play().catch((err) => {
                    console.error("Error playing video:", err);
                  });
                }
              }}
            />
            <canvas ref={canvasRef} className="hidden" />
            {(isProcessing || isUploading) && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-lg">
                <div className="text-center space-y-2">
                  <Loader2 className="h-8 w-8 animate-spin text-white mx-auto" />
                  <p className="text-white text-sm font-medium">
                    {isProcessing ? "Processing photo..." : "Uploading photo..."}
                  </p>
                </div>
              </div>
            )}
          </div>
          <div className="flex gap-2 justify-center">
            <Button
              type="button"
              onClick={capturePhoto}
              disabled={isUploading || isProcessing || !stream}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Camera className="h-4 w-4 mr-2" />
                  Capture
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={stopCamera}
              disabled={isUploading || isProcessing}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Upload Status */}
      {isUploading && !isCapturing && (
        <div className="border rounded-lg p-4 bg-card flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <div>
            <p className="text-sm font-medium">Uploading photo...</p>
            <p className="text-xs text-muted-foreground">Please wait while we save your photo</p>
          </div>
        </div>
      )}

      {uploadedDocuments.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No documents uploaded yet
        </div>
      ) : (
        <div className="space-y-2">
          {uploadedDocuments.map((doc: { id?: string; name: string; type: string; size: number; uploadedAt: string; dataUrl?: string; storageUrl?: string }, index: number) => (
            <div
              key={doc.id || index}
              className="border rounded-lg p-4 bg-card flex items-start justify-between gap-4"
            >
              <div className="flex-1 space-y-1">
                <div className="font-medium">{doc.name}</div>
                <div className="text-sm text-muted-foreground space-y-1">
                  <div>Type: {doc.type}</div>
                  <div>Size: {formatFileSize(doc.size)}</div>
                  <div>Uploaded: {formatDate(doc.uploadedAt)}</div>
                </div>
                {doc.dataUrl && (
                  <div className="mt-2">
                    <img
                      src={doc.dataUrl}
                      alt={doc.name}
                      className="max-w-xs max-h-32 rounded border"
                    />
                  </div>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleRemove(index)}
                disabled={isUploading}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}


    </div>
  );
}

// Helper function
async function getDraftFormState(patientId: string, userId: string) {
  const { getDraftFormState } = await import("@/app/_lib/offline/draft");
  return getDraftFormState(patientId, userId);
}

