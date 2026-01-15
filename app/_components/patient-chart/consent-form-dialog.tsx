"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SignatureCanvas } from "./signature-canvas";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Calendar } from "lucide-react";

interface ConsentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConsentComplete: (signatureDataUrl: string, witnessName?: string, witnessSignatureDataUrl?: string) => Promise<void>;
  patientName: string;
}

const TERMS_AND_CONDITIONS = `INTELLIBUS CARE FOUNDATION (ICF) – PATIENT PRIVACY & CONSENT FOR TREATMENT

1. Consent for Medical Treatment
I voluntarily consent to medical care, including diagnostic procedures (such as blood pressure, glucose checks), medical examinations, and treatment by the clinical team of the Intellibus Care Foundation (ICF) and its partners. I understand that care may be provided by a team of nurses, doctors, and community health workers, some of whom may be consulting remotely via video (Telehealth).

2. Data Privacy & Security (Jamaica Data Protection Act Notice)
We respect your privacy. Your personal health information is collected to provide you with safe medical care.

Data Controller: Intellibus Care Foundation (ICF).

What We Collect: Name, contact details, medical history, medications, and clinical notes ("Sensitive Personal Data").

How We Protect It: Your data is stored in Atlas, our secure, encrypted electronic medical record system. We adhere to the Jamaica Data Protection Act (2020) standards to ensure your information is protected against unauthorized access.

Who Sees It: Your data is accessible only by the clinical staff treating you today, our authorized medical directors, and partner pharmacies/labs if you need a prescription or test.

3. Use of Technology & AI (The "Atlas" System)
I understand that ICF uses advanced technology to improve my care:

Digital Records: My health history will be stored digitally to ensure my future doctors can see what treatment I received today.

Telehealth & AI Assistance: My visit may be video-recorded for the doctor to review. We may use secure Artificial Intelligence (AI) tools to help transcribe the doctor's notes and ensure my records are accurate. These tools do not make medical decisions; a human doctor always reviews and approves my care.

4. Information Sharing & Public Health
I authorize ICF to share strictly necessary details with:

The Ministry of Health & Wellness (MOHW): For required reporting on public health trends (e.g., number of flu cases).

Local Partners: Pharmacies or Labs, only if I need a prescription or test.

Emergency Services: In the event I need urgent transport to a hospital.

5. Your Rights
I understand I have the right to:

Ask to see my medical record.
Ask for corrections if my data is wrong.
Withdraw my consent at any time (though this may limit the care ICF can provide).`;

export function ConsentFormDialog({
  open,
  onOpenChange,
  onConsentComplete,
  patientName,
}: ConsentFormDialogProps) {
  const [hasReadTerms, setHasReadTerms] = React.useState(false);
  const [patientSignature, setPatientSignature] = React.useState<string | null>(null);
  const [date, setDate] = React.useState<string>(new Date().toISOString().split("T")[0]);
  const [needsWitness, setNeedsWitness] = React.useState(false);
  const [witnessName, setWitnessName] = React.useState("");
  const [witnessSignature, setWitnessSignature] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const canSubmit = hasReadTerms && patientSignature && (!needsWitness || (witnessName && witnessSignature));

  const handleSubmit = async () => {
    if (!canSubmit || !patientSignature) return;

    setIsSubmitting(true);
    try {
      await onConsentComplete(
        patientSignature,
        needsWitness ? witnessName : undefined,
        needsWitness ? witnessSignature || undefined : undefined
      );
      // Reset form
      setHasReadTerms(false);
      setPatientSignature(null);
      setNeedsWitness(false);
      setWitnessName("");
      setWitnessSignature(null);
      onOpenChange(false);
    } catch (error) {
      console.error("Error submitting consent:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Patient Privacy & Consent for Treatment</DialogTitle>
          <DialogDescription>
            Please read the terms and conditions below and provide your signature.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-6">
            {/* Terms and Conditions Text */}
            <div className="space-y-4">
              <div className="prose prose-sm max-w-none">
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                  {TERMS_AND_CONDITIONS}
                </pre>
              </div>

              {/* Consent Checkbox */}
              <div className="flex items-start space-x-2 pt-4 border-t">
                <Checkbox
                  id="readTerms"
                  checked={hasReadTerms}
                  onCheckedChange={(checked) => setHasReadTerms(checked === true)}
                />
                <Label
                  htmlFor="readTerms"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                >
                  I HAVE READ (OR HAD READ TO ME) THE ABOVE AND AGREE TO RECEIVE TREATMENT.
                </Label>
              </div>
            </div>

            {/* Patient Signature Section */}
            <div className="space-y-4 border-t pt-4">
              <div>
                <Label className="text-base font-semibold">Patient Signature / Mark</Label>
                <p className="text-sm text-muted-foreground mt-1">
                  {patientName}
                </p>
              </div>
              <SignatureCanvas
                onSignatureChange={(dataUrl) => setPatientSignature(dataUrl)}
                width={600}
                height={200}
              />
            </div>

            {/* Date */}
            <div className="space-y-2 border-t pt-4">
              <Label htmlFor="consentDate">Date</Label>
              <div className="relative">
                <Input
                  id="consentDate"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="pr-10"
                />
                <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            {/* Witness Section */}
            <div className="space-y-4 border-t pt-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="needsWitness"
                  checked={needsWitness}
                  onCheckedChange={(checked) => setNeedsWitness(checked === true)}
                />
                <Label
                  htmlFor="needsWitness"
                  className="text-sm font-medium leading-none cursor-pointer"
                >
                  Patient cannot sign - Witness signature required
                </Label>
              </div>

              {needsWitness && (
                <div className="space-y-4 pl-6 border-l-2">
                  <div className="space-y-2">
                    <Label htmlFor="witnessName">Witness Name</Label>
                    <Input
                      id="witnessName"
                      value={witnessName}
                      onChange={(e) => setWitnessName(e.target.value)}
                      placeholder="Enter witness name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Witness Signature</Label>
                    <SignatureCanvas
                      onSignatureChange={(dataUrl) => setWitnessSignature(dataUrl)}
                      width={600}
                      height={200}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || isSubmitting}
          >
            {isSubmitting ? "Submitting..." : "Submit Consent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
