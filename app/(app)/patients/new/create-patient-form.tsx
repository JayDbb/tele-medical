"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Save, Phone, Mail, Calendar, UserPlus, Cross, FileText, X, Clock, User, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createPatientAction, updatePatientAssignmentAction, updatePatientConsentSignatureAction } from "@/app/_actions/patients";
import { createVisitDraftAction, updateVisitWaitingRoomAction } from "@/app/_actions/visits";
import { cn } from "@/app/_lib/utils/cn";
import { ConsentFormDialog } from "@/app/_components/patient-chart/consent-form-dialog";

const createPatientSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  preferredName: z.string().optional(),
  dob: z.string().min(1, "Date of birth is required"),
  sexAtBirth: z.string().min(1, "Sex at birth is required"),
  genderIdentity: z.string().optional(),
  phone: z.string().min(1, "Mobile phone is required"),
  email: z
    .string()
    .optional()
    .refine(
      (val) => !val || val === "" || z.string().email().safeParse(val).success,
      {
        message: "Invalid email address",
      }
    ),
  streetAddress: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  primaryLanguage: z.string().optional(),
  smsNotifications: z.boolean(),
  emailNotifications: z.boolean(),
  emergencyContactName: z.string().optional(),
  emergencyContactRelationship: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  primaryCareProvider: z.string().optional(),
});

type CreatePatientFormData = z.infer<typeof createPatientSchema>;

interface ExistingPatient {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  dob: string | Date | null;
  createdAt: Date | string;
}

export function CreatePatientForm() {
  const router = useRouter();
  const [isSaving, setIsSaving] = React.useState(false);
  const [showPostCreateModal, setShowPostCreateModal] = React.useState(false);
  const [showConsentDialog, setShowConsentDialog] = React.useState(false);
  const [createdPatientId, setCreatedPatientId] = React.useState<string | null>(null);
  const [pendingPatientData, setPendingPatientData] = React.useState<CreatePatientFormData | null>(null);
  const [isHandlingAction, setIsHandlingAction] = React.useState(false);
  const [showDuplicateModal, setShowDuplicateModal] = React.useState(false);
  const [existingPatients, setExistingPatients] = React.useState<ExistingPatient[]>([]);

  const form = useForm<CreatePatientFormData>({
    resolver: zodResolver(createPatientSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      preferredName: "",
      dob: "",
      sexAtBirth: undefined,
      genderIdentity: undefined,
      phone: "",
      email: "",
      streetAddress: "",
      city: "",
      state: "",
      zip: "",
      primaryLanguage: "English",
      smsNotifications: false,
      emailNotifications: true,
      emergencyContactName: "",
      emergencyContactRelationship: "",
      emergencyContactPhone: "",
      primaryCareProvider: undefined,
    },
  });

  const onSubmit = async (data: CreatePatientFormData) => {
    try {
      setIsSaving(true);

      // Check for duplicates first (before showing consent)
      const commMethods: string[] = [];
      if (data.smsNotifications) commMethods.push("SMS");
      if (data.emailNotifications) commMethods.push("Email");
      const preferredCommMethod = commMethods.length > 0 ? commMethods.join(", ") : null;

      // Check for existing patients with the same phone or email
      const checkResponse = await fetch("/api/patients/check-duplicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: data.phone,
          email: data.email || undefined,
        }),
      });

      if (checkResponse.ok) {
        const checkResult = await checkResponse.json();
        if (checkResult.existingPatients && checkResult.existingPatients.length > 0) {
          setExistingPatients(checkResult.existingPatients);
          setShowDuplicateModal(true);
          toast.error("A patient with this phone number or email already exists");
          return;
        }
      }

      // Store form data and show consent dialog
      setPendingPatientData(data);
      setShowConsentDialog(true);
    } catch (error) {
      console.error("Error checking for duplicates:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to validate patient information"
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column */}
        <div className="space-y-6">
          {/* Patient Identity Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Patient Identity
                <span className="text-xs font-normal text-muted-foreground bg-destructive/10 text-destructive px-2 py-1 rounded">
                  REQUIRED
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">
                    First Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="firstName"
                    placeholder="e.g. Jane"
                    {...form.register("firstName")}
                    className={cn(
                      form.formState.errors.firstName && "border-destructive"
                    )}
                  />
                  {form.formState.errors.firstName && (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.firstName.message}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">
                    Last Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="lastName"
                    placeholder="e.g. Doe"
                    {...form.register("lastName")}
                    className={cn(
                      form.formState.errors.lastName && "border-destructive"
                    )}
                  />
                  {form.formState.errors.lastName && (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.lastName.message}
                    </p>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="preferredName">Preferred Name</Label>
                <Input
                  id="preferredName"
                  placeholder="e.g. Janie"
                  {...form.register("preferredName")}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="dob">
                    Date of Birth <span className="text-destructive">*</span>
                  </Label>
                  <div className="relative">
                    <Input
                      id="dob"
                      type="date"
                      placeholder="mm/dd/yyyy"
                      {...form.register("dob")}
                      className={cn(
                        "pr-10",
                        form.formState.errors.dob && "border-destructive"
                      )}
                    />
                    <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  </div>
                  {form.formState.errors.dob && (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.dob.message}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sexAtBirth">
                    Sex at Birth <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={form.watch("sexAtBirth") || ""}
                    onValueChange={(value) => form.setValue("sexAtBirth", value)}
                  >
                    <SelectTrigger
                      className={cn(
                        form.formState.errors.sexAtBirth && "border-destructive"
                      )}
                    >
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="female">Female</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                      <SelectItem value="prefer_not_to_say">Prefer not to say</SelectItem>
                    </SelectContent>
                  </Select>
                  {form.formState.errors.sexAtBirth && (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.sexAtBirth.message}
                    </p>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="genderIdentity">Pronouns</Label>
                <Select
                  value={form.watch("genderIdentity") || ""}
                  onValueChange={(value) => form.setValue("genderIdentity", value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="he/him">He/Him</SelectItem>
                    <SelectItem value="she/her">She/Her</SelectItem>
                    <SelectItem value="they/them">They/Them</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                    <SelectItem value="prefer_not_to_say">Prefer not to say</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Contact Information Section */}
          <Card>
            <CardHeader>
              <CardTitle>Contact Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="phone">
                  Mobile Phone <span className="text-destructive">*</span>
                </Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="(555) 000-0000"
                    className={cn(
                      "pl-10",
                      form.formState.errors.phone && "border-destructive"
                    )}
                    {...form.register("phone")}
                  />
                </div>
                {form.formState.errors.phone && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.phone.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="jane@example.com"
                    className={cn(
                      "pl-10",
                      form.formState.errors.email && "border-destructive"
                    )}
                    {...form.register("email")}
                  />
                </div>
                {form.formState.errors.email && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.email.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="streetAddress">Street Address</Label>
                <Input
                  id="streetAddress"
                  placeholder="123 Main St"
                  {...form.register("streetAddress")}
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="city">City</Label>
                  <Input id="city" {...form.register("city")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="state">State</Label>
                  <Input id="state" {...form.register("state")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="zip">ZIP</Label>
                  <Input id="zip" {...form.register("zip")} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="primaryLanguage">Language</Label>
                <Select
                  value={form.watch("primaryLanguage") || "English"}
                  onValueChange={(value) => form.setValue("primaryLanguage", value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="English">English</SelectItem>
                    <SelectItem value="Spanish">Spanish</SelectItem>
                    <SelectItem value="French">French</SelectItem>
                    <SelectItem value="German">German</SelectItem>
                    <SelectItem value="Chinese">Chinese</SelectItem>
                    <SelectItem value="Japanese">Japanese</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Notifications</Label>
                <div className="flex items-center gap-6">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="smsNotifications"
                      checked={form.watch("smsNotifications")}
                      onCheckedChange={(checked) =>
                        form.setValue("smsNotifications", checked === true)
                      }
                    />
                    <Label
                      htmlFor="smsNotifications"
                      className="text-sm font-normal cursor-pointer"
                    >
                      SMS
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="emailNotifications"
                      checked={form.watch("emailNotifications")}
                      onCheckedChange={(checked) =>
                        form.setValue("emailNotifications", checked === true)
                      }
                    />
                    <Label
                      htmlFor="emailNotifications"
                      className="text-sm font-normal cursor-pointer"
                    >
                      Email
                    </Label>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Emergency Contact Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cross className="h-4 w-4" />
                Emergency Contact
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="emergencyContactName">Full Name</Label>
                <Input
                  id="emergencyContactName"
                  {...form.register("emergencyContactName")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="emergencyContactRelationship">Relationship</Label>
                <Input
                  id="emergencyContactRelationship"
                  {...form.register("emergencyContactRelationship")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="emergencyContactPhone">Phone</Label>
                <Input
                  id="emergencyContactPhone"
                  type="tel"
                  {...form.register("emergencyContactPhone")}
                />
              </div>
            </CardContent>
          </Card>


        </div>
      </div>

      {/* Submit Button */}
      <div className="flex justify-end gap-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isSaving}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isSaving}>
          <Save className="h-4 w-4 mr-2" />
          {isSaving ? "Creating..." : "Create Patient"}
        </Button>
      </div>

      {/* Consent Form Dialog */}
      <ConsentFormDialog
        open={showConsentDialog}
        onOpenChange={(open) => {
          setShowConsentDialog(open);
          // If dialog is closed without submitting, clear pending data
          if (!open && !createdPatientId) {
            setPendingPatientData(null);
          }
        }}
        patientName={pendingPatientData ? `${pendingPatientData.firstName} ${pendingPatientData.lastName}`.trim() : ""}
        onConsentComplete={async (signatureDataUrl, witnessName, witnessSignatureDataUrl) => {
          if (!pendingPatientData) return;

          try {
            setIsSaving(true);

            // Generate a UUID for the patient (we'll use this for both upload and creation)
            const patientId = crypto.randomUUID();

            // First, upload signature to Supabase Storage using the generated patient ID
            const formData = new FormData();
            formData.append("signature", signatureDataUrl);
            formData.append("patientId", patientId);
            if (witnessSignatureDataUrl) {
              formData.append("witnessSignature", witnessSignatureDataUrl);
            }

            const uploadResponse = await fetch("/api/upload/signature", {
              method: "POST",
              body: formData,
            });

            if (!uploadResponse.ok) {
              const error = await uploadResponse.json();
              throw new Error(error.error || "Failed to upload signature");
            }

            const uploadData = await uploadResponse.json();

            // Determine preferred communication method
            const commMethods: string[] = [];
            if (pendingPatientData.smsNotifications) commMethods.push("SMS");
            if (pendingPatientData.emailNotifications) commMethods.push("Email");
            const preferredCommMethod = commMethods.length > 0 ? commMethods.join(", ") : null;

            // Now create the patient with the signature URL and the pre-generated ID
            const result = await createPatientAction({
              firstName: pendingPatientData.firstName,
              lastName: pendingPatientData.lastName,
              preferredName: pendingPatientData.preferredName || undefined,
              dob: pendingPatientData.dob || undefined,
              sexAtBirth: pendingPatientData.sexAtBirth || undefined,
              genderIdentity: pendingPatientData.genderIdentity || undefined,
              phone: pendingPatientData.phone,
              email: pendingPatientData.email || undefined,
              streetAddress: pendingPatientData.streetAddress || undefined,
              city: pendingPatientData.city || undefined,
              state: pendingPatientData.state || undefined,
              zip: pendingPatientData.zip || undefined,
              primaryLanguage: pendingPatientData.primaryLanguage || undefined,
              preferredCommMethod: preferredCommMethod || undefined,
              emergencyContactName: pendingPatientData.emergencyContactName || undefined,
              emergencyContactRelationship: pendingPatientData.emergencyContactRelationship || undefined,
              emergencyContactPhone: pendingPatientData.emergencyContactPhone || undefined,
              primaryCareProvider: pendingPatientData.primaryCareProvider || undefined,
              consentSignatureUrl: uploadData.signatureUrl,
            });

            if (result.success) {
              toast.success("Patient created successfully");
              setCreatedPatientId(result.patientId || null);
              setPendingPatientData(null);

              // Close consent dialog and show post-create modal
              setShowConsentDialog(false);
              setShowPostCreateModal(true);
            } else if (result.error === "DUPLICATE" && result.existingPatients) {
              setExistingPatients(result.existingPatients);
              setShowDuplicateModal(true);
              toast.error("A patient with this phone number or email already exists");
            }
          } catch (error) {
            console.error("Error creating patient with consent:", error);
            toast.error(
              error instanceof Error
                ? error.message
                : "Failed to create patient"
            );
            throw error;
          } finally {
            setIsSaving(false);
          }
        }}
      />

      {/* Post-Create Modal */}
      <Dialog open={showPostCreateModal} onOpenChange={setShowPostCreateModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Patient Created Successfully</DialogTitle>
            <DialogDescription>
              What would you like to do next?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <Button
              variant="outline"
              className="w-full justify-start gap-3 h-auto py-4"
              onClick={async () => {
                if (!createdPatientId) return;
                setIsHandlingAction(true);
                try {
                  await updatePatientAssignmentAction(createdPatientId, "start-visit");
                  toast.success("Patient assigned to you");
                  router.push(`/patients/${createdPatientId}/new-visit`);
                } catch (error) {
                  console.error("Error starting visit:", error);
                  toast.error("Failed to start visit");
                } finally {
                  setIsHandlingAction(false);
                }
              }}
              disabled={isHandlingAction}
            >
              <User className="h-5 w-5" />
              <div className="flex flex-col items-start">
                <span className="font-semibold">Start Visit</span>
                <span className="text-xs text-muted-foreground">
                  Assign patient to you and begin a new visit
                </span>
              </div>
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start gap-3 h-auto py-4"
              onClick={async () => {
                if (!createdPatientId) return;
                setIsHandlingAction(true);
                try {
                  // First create a visit
                  const visitResult = await createVisitDraftAction({
                    patientId: createdPatientId,
                  });

                  // Set patient assignment to false and clinician_id to null
                  await updatePatientAssignmentAction(createdPatientId, "send-to-waiting-room");

                  // Update visit to "Waiting" status with default values (user can change on next page)
                  await updateVisitWaitingRoomAction({
                    visitId: visitResult.visitId,
                    triageLevel: "mild",
                    appointmentType: "in-person",
                  });

                  toast.success("Patient sent to waiting room");
                  router.push(`/patients/${createdPatientId}/send-to-waiting-room?visitId=${visitResult.visitId}`);
                } catch (error) {
                  console.error("Error sending to waiting room:", error);
                  toast.error("Failed to send to waiting room");
                } finally {
                  setIsHandlingAction(false);
                }
              }}
              disabled={isHandlingAction}
            >
              <Clock className="h-5 w-5" />
              <div className="flex flex-col items-start">
                <span className="font-semibold">Send to Waiting Room</span>
                <span className="text-xs text-muted-foreground">
                  Add triage level and appointment type
                </span>
              </div>
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start gap-3 h-auto py-4"
              onClick={async () => {
                if (!createdPatientId) return;
                setIsHandlingAction(true);
                try {
                  await updatePatientAssignmentAction(createdPatientId, "close");
                  toast.success("Patient created");
                  router.push(`/patients/${createdPatientId}`);
                } catch (error) {
                  console.error("Error closing:", error);
                  toast.error("Failed to update patient");
                } finally {
                  setIsHandlingAction(false);
                }
              }}
              disabled={isHandlingAction}
            >
              <X className="h-5 w-5" />
              <div className="flex flex-col items-start">
                <span className="font-semibold">Close</span>
                <span className="text-xs text-muted-foreground">
                  View patient details
                </span>
              </div>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Duplicate Patients Modal */}
      <Dialog open={showDuplicateModal} onOpenChange={setShowDuplicateModal}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              Patient Already Exists
            </DialogTitle>
            <DialogDescription>
              A patient with this phone number or email already exists in the system. Please review the existing patient(s) below.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {existingPatients.map((patient) => (
              <Card key={patient.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 space-y-2">
                      <h3 className="font-semibold text-lg">{patient.fullName}</h3>
                      <div className="space-y-1 text-sm text-muted-foreground">
                        {patient.phone && (
                          <div className="flex items-center gap-2">
                            <Phone className="h-4 w-4" />
                            <span>{patient.phone}</span>
                          </div>
                        )}
                        {patient.email && (
                          <div className="flex items-center gap-2">
                            <Mail className="h-4 w-4" />
                            <span>{patient.email}</span>
                          </div>
                        )}
                        {patient.dob && (
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4" />
                            <span>
                              {patient.dob instanceof Date
                                ? patient.dob.toLocaleDateString()
                                : new Date(patient.dob).toLocaleDateString()}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                    <Link href={`/patients/${patient.id}`}>
                      <Button variant="outline" size="sm">
                        View Patient
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={() => setShowDuplicateModal(false)} variant="outline">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}

