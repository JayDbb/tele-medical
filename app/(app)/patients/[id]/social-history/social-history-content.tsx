"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import {
  Pencil,
  Flag,
  Cigarette,
  Wine,
  Home,
  CheckCircle2,
  Beaker,
  Briefcase,
  Users,
  Activity,
  Clipboard,
  Heart,
  Menu,
  Plus,
  Trash2,
} from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  updateSocialHistoryAction,
} from "@/app/_actions/social-history";
import type { SocialHistory } from "@/app/_lib/db/drizzle/queries/social-history";
import { v4 as uuidv4 } from "uuid";

interface SocialHistoryContentProps {
  patientId: string;
  patientName: string;
  socialHistory: SocialHistory | null;
}

const socialHistorySchema = z.object({
  tobacco: z
    .object({
      status: z.enum(["Never", "Former", "Current"]).optional(),
      amount: z.string().optional(),
      years: z.string().optional(),
      quitDate: z.string().optional(),
    })
    .optional(),
  alcohol: z
    .object({
      status: z.enum(["Never", "Occasional", "Regular", "Former"]).optional(),
      frequency: z.string().optional(),
      amount: z.string().optional(),
    })
    .optional(),
  otherSubstances: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        status: z.string(),
        notes: z.string().optional(),
      })
    )
    .optional(),
  occupation: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      hazards: z.string().optional(),
    })
    .optional(),
  livingSituation: z
    .object({
      status: z.enum(["Stable", "Unstable", "Homeless", "Other"]).optional(),
      description: z.string().optional(),
      household: z.string().optional(),
    })
    .optional(),
  lifestyle: z
    .object({
      activityLevel: z
        .enum(["Sedentary", "Light", "Moderate", "Active", "Very Active"])
        .optional(),
      dietQuality: z.enum(["Poor", "Fair", "Good", "Excellent"]).optional(),
      exerciseHabits: z.string().optional(),
      sleepHours: z.string().optional(),
      sleepQuality: z.enum(["Poor", "Fair", "Good", "Excellent"]).optional(),
      stressLevel: z
        .enum(["Low", "Moderate", "High", "Very High"])
        .optional(),
    })
    .optional(),
  psychosocial: z
    .object({
      socialSupport: z
        .enum(["Strong", "Moderate", "Limited", "None"])
        .optional(),
      financialStrain: z
        .enum(["Stable", "Moderate", "Significant", "Crisis"])
        .optional(),
      transportation: z.enum(["Accessible", "Limited", "None"]).optional(),
      notes: z.string().optional(),
    })
    .optional(),
  sexualHealth: z
    .object({
      status: z.string().optional(),
      partners: z.string().optional(),
      contraception: z.string().optional(),
      stiHistory: z.string().optional(),
    })
    .optional(),
  clinicianNotes: z.string().optional(),
});

type SocialHistoryFormData = z.infer<typeof socialHistorySchema>;
type LifestyleActivityLevel = NonNullable<SocialHistory["lifestyle"]>["activityLevel"];
type LifestyleDietQuality = NonNullable<SocialHistory["lifestyle"]>["dietQuality"];
type LifestyleSleepQuality = NonNullable<SocialHistory["lifestyle"]>["sleepQuality"];
type LifestyleStressLevel = NonNullable<SocialHistory["lifestyle"]>["stressLevel"];
type PsychosocialSocialSupport = NonNullable<SocialHistory["psychosocial"]>["socialSupport"];
type PsychosocialFinancialStrain = NonNullable<SocialHistory["psychosocial"]>["financialStrain"];
type PsychosocialTransportation = NonNullable<SocialHistory["psychosocial"]>["transportation"];

export function SocialHistoryContent({
  patientId,
  patientName,
  socialHistory: initialSocialHistory,
}: SocialHistoryContentProps) {
  const [socialHistory, setSocialHistory] = React.useState<SocialHistory | null>(
    initialSocialHistory
  );
  const [showUpdateModal, setShowUpdateModal] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState("tobacco");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [newSubstance, setNewSubstance] = React.useState({
    name: "",
    status: "",
    notes: "",
  });

  const form = useForm<SocialHistoryFormData>({
    resolver: zodResolver(socialHistorySchema),
    defaultValues: {
      tobacco: initialSocialHistory?.tobacco || { status: "Never" },
      alcohol: initialSocialHistory?.alcohol || { status: "Never" },
      otherSubstances: initialSocialHistory?.otherSubstances || [],
      occupation: initialSocialHistory?.occupation || {},
      livingSituation: initialSocialHistory?.livingSituation || {
        status: "Stable",
      },
      lifestyle: initialSocialHistory?.lifestyle || {},
      psychosocial: initialSocialHistory?.psychosocial || {},
      sexualHealth: initialSocialHistory?.sexualHealth || {},
      clinicianNotes: initialSocialHistory?.clinicianNotes || "",
    },
  });

  React.useEffect(() => {
    if (showUpdateModal && initialSocialHistory) {
      form.reset({
        tobacco: initialSocialHistory.tobacco || { status: "Never" },
        alcohol: initialSocialHistory.alcohol || { status: "Never" },
        otherSubstances: initialSocialHistory.otherSubstances || [],
        occupation: initialSocialHistory.occupation || {},
        livingSituation: initialSocialHistory.livingSituation || {
          status: "Stable",
        },
        lifestyle: initialSocialHistory.lifestyle || {},
        psychosocial: initialSocialHistory.psychosocial || {},
        sexualHealth: initialSocialHistory.sexualHealth || {},
        clinicianNotes: initialSocialHistory.clinicianNotes || "",
      });
    }
  }, [showUpdateModal, initialSocialHistory, form]);

  const handleSubmit = async (data: SocialHistoryFormData) => {
    setIsSubmitting(true);
    try {
      // Transform form data to match SocialHistory type requirements
      // Only include objects that have required fields
      const updates: Partial<SocialHistory> = {};
      
      if (data.tobacco?.status) {
        updates.tobacco = {
          status: data.tobacco.status,
          amount: data.tobacco.amount,
          years: data.tobacco.years,
          quitDate: data.tobacco.quitDate,
        };
      }
      
      if (data.alcohol?.status) {
        updates.alcohol = {
          status: data.alcohol.status,
          frequency: data.alcohol.frequency,
          amount: data.alcohol.amount,
        };
      }
      
      if (data.otherSubstances) {
        updates.otherSubstances = data.otherSubstances;
      }
      
      if (data.occupation) {
        updates.occupation = data.occupation;
      }
      
      if (data.livingSituation?.status) {
        updates.livingSituation = {
          status: data.livingSituation.status,
          description: data.livingSituation.description,
          household: data.livingSituation.household,
        };
      }
      
      if (data.lifestyle) {
        updates.lifestyle = data.lifestyle;
      }
      
      if (data.psychosocial) {
        updates.psychosocial = data.psychosocial;
      }
      
      if (data.sexualHealth) {
        updates.sexualHealth = data.sexualHealth;
      }
      
      if (data.clinicianNotes !== undefined) {
        updates.clinicianNotes = data.clinicianNotes;
      }
      
      await updateSocialHistoryAction(patientId, updates);
      setSocialHistory({
        ...(socialHistory || {}),
        ...updates,
        lastUpdated: new Date().toISOString(),
      });
      setShowUpdateModal(false);
      toast.success("Social history updated successfully");
    } catch (error) {
      console.error("Error updating social history:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to update social history"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddSubstance = () => {
    if (!newSubstance.name || !newSubstance.status) {
      toast.error("Name and status are required");
      return;
    }

    const current = form.getValues("otherSubstances") || [];
    form.setValue("otherSubstances", [
      ...current,
      {
        id: uuidv4(),
        name: newSubstance.name,
        status: newSubstance.status,
        notes: newSubstance.notes,
      },
    ]);

    setNewSubstance({ name: "", status: "", notes: "" });
  };

  const handleRemoveSubstance = (id: string) => {
    const current = form.getValues("otherSubstances") || [];
    form.setValue(
      "otherSubstances",
      current.filter((s) => s.id !== id)
    );
  };

  const getRiskFlagsCount = () => {
    let count = 0;
    if (socialHistory?.tobacco?.status === "Current") count++;
    if (socialHistory?.alcohol?.status === "Regular") count++;
    if (socialHistory?.livingSituation?.status === "Unstable" || socialHistory?.livingSituation?.status === "Homeless") count++;
    if (socialHistory?.psychosocial?.financialStrain === "Significant" || socialHistory?.psychosocial?.financialStrain === "Crisis") count++;
    return count;
  };

  const formatLastUpdated = (dateString?: string) => {
    if (!dateString) return "Never";
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return "Never";
    }
  };

  const getDisplayValue = (value: string | undefined, fallback: string = "Not recorded") => {
    return value || fallback;
  };

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Social History</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Social history for {patientName}
          </p>
        </div>
        <Button onClick={() => setShowUpdateModal(true)}>
          <Pencil className="h-4 w-4 mr-2" />
          Update History
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <Flag className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">RISK FLAGS</p>
            </div>
            <Badge
              variant="default"
              className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500 mb-1"
            >
              {getRiskFlagsCount()} Active
            </Badge>
            <p className="text-sm text-muted-foreground">
              {getRiskFlagsCount() === 0 ? "No risk flags" : "Risk flags present"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <Cigarette className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">TOBACCO</p>
            </div>
            <p className="text-2xl font-semibold mb-1">
              {getDisplayValue(socialHistory?.tobacco?.status, "Never")}
            </p>
            <p className="text-sm text-muted-foreground">Not recorded</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <Wine className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">ALCOHOL</p>
            </div>
            <p className="text-2xl font-semibold mb-1">
              {getDisplayValue(socialHistory?.alcohol?.status, "Never")}
            </p>
            <p className="text-sm text-muted-foreground">Not recorded</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <Home className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">HOUSING</p>
            </div>
            <p className="text-2xl font-semibold mb-1">
              {getDisplayValue(socialHistory?.livingSituation?.status)}
            </p>
            <p className="text-sm text-muted-foreground">Not recorded</p>
          </CardContent>
        </Card>

        <Card className="bg-blue-500/10 border-blue-500">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <p className="text-xs text-blue-600 dark:text-blue-400">LAST UPDATED</p>
            </div>
            <p className="text-2xl font-semibold mb-1 text-blue-600 dark:text-blue-400">
              {formatLastUpdated(socialHistory?.lastUpdated)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content - Two Columns */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Left Column */}
        <div className="space-y-6">
          {/* Substance Use */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Beaker className="h-5 w-5" />
                <CardTitle>Substance Use</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm font-medium mb-2">TOBACCO / NICOTINE</p>
                <Badge
                  variant={
                    socialHistory?.tobacco?.status === "Never"
                      ? "default"
                      : "secondary"
                  }
                  className={
                    socialHistory?.tobacco?.status === "Never"
                      ? "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500"
                      : ""
                  }
                >
                  {getDisplayValue(socialHistory?.tobacco?.status, "Never")}
                </Badge>
                <p className="text-sm text-muted-foreground mt-1">
                  {socialHistory?.tobacco?.status
                    ? "Tobacco use recorded"
                    : "No tobacco use recorded."}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium mb-2">ALCOHOL</p>
                <p className="text-sm text-muted-foreground">
                  {socialHistory?.alcohol?.status
                    ? `Alcohol use: ${socialHistory.alcohol.status}`
                    : "No alcohol use recorded."}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium mb-2">OTHER SUBSTANCES</p>
                <p className="text-sm text-muted-foreground">
                  {socialHistory?.otherSubstances &&
                  socialHistory.otherSubstances.length > 0
                    ? `${socialHistory.otherSubstances.length} substance(s) recorded`
                    : "No other substances recorded."}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Living & Occupation */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Briefcase className="h-5 w-5" />
                <CardTitle>Living & Occupation</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Briefcase className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm font-medium">OCCUPATION</p>
                </div>
                <p className="text-sm text-muted-foreground">
                  {getDisplayValue(socialHistory?.occupation?.title)}
                </p>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Home className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm font-medium">LIVING SITUATION</p>
                </div>
                <p className="text-sm text-muted-foreground">
                  {getDisplayValue(socialHistory?.livingSituation?.status)}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Psychosocial & Support */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                <CardTitle>Psychosocial & Support</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm font-medium mb-2">SOCIAL SUPPORT</p>
                <p className="text-sm text-muted-foreground">
                  {getDisplayValue(socialHistory?.psychosocial?.socialSupport)}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium mb-2">FINANCIAL STRAIN</p>
                <p className="text-sm text-muted-foreground">
                  {getDisplayValue(socialHistory?.psychosocial?.financialStrain)}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium mb-2">TRANSPORTATION</p>
                <p className="text-sm text-muted-foreground">
                  {getDisplayValue(socialHistory?.psychosocial?.transportation)}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Lifestyle Factors */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                <CardTitle>Lifestyle Factors</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm font-medium">Activity Level</p>
                </div>
                <p className="text-sm text-muted-foreground">
                  {getDisplayValue(socialHistory?.lifestyle?.activityLevel)}
                </p>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm font-medium">Diet Quality</p>
                </div>
                <p className="text-sm text-muted-foreground">
                  {getDisplayValue(socialHistory?.lifestyle?.dietQuality)}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium mb-2">Sleep</p>
                <p className="text-sm text-muted-foreground">
                  {getDisplayValue(socialHistory?.lifestyle?.sleepQuality)}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium mb-2">Stress</p>
                <p className="text-sm text-muted-foreground">
                  {getDisplayValue(socialHistory?.lifestyle?.stressLevel)}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Screening Tools */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Clipboard className="h-5 w-5" />
                <CardTitle>Screening Tools</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                No screening tools recorded
              </p>
            </CardContent>
          </Card>

          {/* Sexual Health */}
          <Card className="border-pink-500/50">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Heart className="h-5 w-5 text-pink-500" />
                <CardTitle>Sexual Health</CardTitle>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Confidential • Provider View Only
              </p>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {socialHistory?.sexualHealth?.status
                  ? "Sexual health information recorded"
                  : "No sexual health information recorded."}
              </p>
            </CardContent>
          </Card>

          {/* Clinician Notes */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Menu className="h-5 w-5" />
                <CardTitle>Clinician Notes</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {getDisplayValue(socialHistory?.clinicianNotes)}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Update Social History Modal */}
      <Dialog open={showUpdateModal} onOpenChange={setShowUpdateModal}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Update Social History</DialogTitle>
            <DialogDescription>
              Enter patient social history information.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(handleSubmit)}>
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-7">
                <TabsTrigger value="tobacco">Tobacco</TabsTrigger>
                <TabsTrigger value="alcohol">Alcohol</TabsTrigger>
                <TabsTrigger value="occupation">Occupation</TabsTrigger>
                <TabsTrigger value="lifestyle">Lifestyle</TabsTrigger>
                <TabsTrigger value="psychosocial">Psychosocial</TabsTrigger>
                <TabsTrigger value="sexual">Sexual</TabsTrigger>
                <TabsTrigger value="notes">Notes</TabsTrigger>
              </TabsList>

              {/* Tobacco Tab */}
              <TabsContent value="tobacco" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label>
                    Status <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={form.watch("tobacco.status") || "Never"}
                    onValueChange={(value) =>
                      form.setValue("tobacco.status", value as "Never" | "Former" | "Current")
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Never">Never</SelectItem>
                      <SelectItem value="Former">Former</SelectItem>
                      <SelectItem value="Current">Current</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.watch("tobacco.status") === "Current" && (
                  <>
                    <div className="space-y-2">
                      <Label>Amount</Label>
                      <Input
                        placeholder="e.g., 1 pack/day"
                        {...form.register("tobacco.amount")}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Years</Label>
                      <Input
                        placeholder="e.g., 10"
                        {...form.register("tobacco.years")}
                      />
                    </div>
                  </>
                )}
                {form.watch("tobacco.status") === "Former" && (
                  <div className="space-y-2">
                    <Label>Quit Date</Label>
                    <Input
                      type="date"
                      {...form.register("tobacco.quitDate")}
                    />
                  </div>
                )}
              </TabsContent>

              {/* Alcohol Tab */}
              <TabsContent value="alcohol" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label>
                    Status <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={form.watch("alcohol.status") || "Never"}
                    onValueChange={(value) =>
                      form.setValue("alcohol.status", value as "Never" | "Occasional" | "Regular" | "Former")
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Never">Never</SelectItem>
                      <SelectItem value="Occasional">Occasional</SelectItem>
                      <SelectItem value="Regular">Regular</SelectItem>
                      <SelectItem value="Former">Former</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.watch("alcohol.status") !== "Never" && (
                  <>
                    <div className="space-y-2">
                      <Label>Frequency</Label>
                      <Input
                        placeholder="e.g., 2-3 times/week"
                        {...form.register("alcohol.frequency")}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Amount</Label>
                      <Input
                        placeholder="e.g., 1-2 drinks"
                        {...form.register("alcohol.amount")}
                      />
                    </div>
                  </>
                )}
                <div className="mt-6 space-y-4">
                  <div className="space-y-2">
                    <Label>Other Substances</Label>
                    <div className="space-y-3">
                      {(form.watch("otherSubstances") || []).map((substance) => (
                        <div
                          key={substance.id}
                          className="flex items-center gap-2 p-3 border rounded-md"
                        >
                          <div className="flex-1">
                            <p className="font-medium">{substance.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {substance.status}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemoveSubstance(substance.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2 p-4 border rounded-md">
                    <Label className="text-sm font-semibold">Add New Substance</Label>
                    <div className="space-y-2">
                      <Input
                        placeholder="e.g., Marijuana"
                        value={newSubstance.name}
                        onChange={(e) =>
                          setNewSubstance({ ...newSubstance, name: e.target.value })
                        }
                      />
                      <Input
                        placeholder="e.g., Occasional, Regular, Former"
                        value={newSubstance.status}
                        onChange={(e) =>
                          setNewSubstance({ ...newSubstance, status: e.target.value })
                        }
                      />
                      <Textarea
                        placeholder="Additional notes..."
                        value={newSubstance.notes}
                        onChange={(e) =>
                          setNewSubstance({ ...newSubstance, notes: e.target.value })
                        }
                        rows={2}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleAddSubstance}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add Substance
                      </Button>
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* Occupation Tab */}
              <TabsContent value="occupation" className="space-y-4 mt-4">
                <div>
                  <h3 className="font-semibold mb-4">Occupation & Living Situation</h3>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Occupation Title</Label>
                      <Input
                        placeholder="e.g., Logistics Manager"
                        {...form.register("occupation.title")}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Description</Label>
                      <Textarea
                        placeholder="Shift work, hazards, etc..."
                        {...form.register("occupation.description")}
                        rows={3}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Hazards / Risks</Label>
                      <Input
                        placeholder="e.g., Heavy lifting, noise exposure"
                        {...form.register("occupation.hazards")}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Living Situation Status</Label>
                      <Select
                        value={form.watch("livingSituation.status") || "Stable"}
                        onValueChange={(value) =>
                          form.setValue("livingSituation.status", value as "Stable" | "Unstable" | "Homeless" | "Other")
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Stable">Stable</SelectItem>
                          <SelectItem value="Unstable">Unstable</SelectItem>
                          <SelectItem value="Homeless">Homeless</SelectItem>
                          <SelectItem value="Other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Description</Label>
                      <Input
                        placeholder="e.g., Apartment"
                        {...form.register("livingSituation.description")}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Household</Label>
                      <Input
                        placeholder="e.g., Spouse + 1 Child"
                        {...form.register("livingSituation.household")}
                      />
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* Lifestyle Tab */}
              <TabsContent value="lifestyle" className="space-y-4 mt-4">
                <div>
                  <h3 className="font-semibold mb-4">Lifestyle Factors</h3>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Activity Level</Label>
                      <Select
                        value={form.watch("lifestyle.activityLevel") || ""}
                        onValueChange={(value) =>
                          form.setValue("lifestyle.activityLevel", value as LifestyleActivityLevel)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Sedentary">Sedentary</SelectItem>
                          <SelectItem value="Light">Light</SelectItem>
                          <SelectItem value="Moderate">Moderate</SelectItem>
                          <SelectItem value="Active">Active</SelectItem>
                          <SelectItem value="Very Active">Very Active</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Diet Quality</Label>
                      <Select
                        value={form.watch("lifestyle.dietQuality") || ""}
                        onValueChange={(value) =>
                          form.setValue("lifestyle.dietQuality", value as LifestyleDietQuality)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Poor">Poor</SelectItem>
                          <SelectItem value="Fair">Fair</SelectItem>
                          <SelectItem value="Good">Good</SelectItem>
                          <SelectItem value="Excellent">Excellent</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Exercise Habits</Label>
                      <Input
                        placeholder="e.g., Gym 1x/week, walks dog occasionally"
                        {...form.register("lifestyle.exerciseHabits")}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Sleep Hours</Label>
                      <Input
                        placeholder="e.g., 7"
                        {...form.register("lifestyle.sleepHours")}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Sleep Quality</Label>
                      <Select
                        value={form.watch("lifestyle.sleepQuality") || ""}
                        onValueChange={(value) =>
                          form.setValue("lifestyle.sleepQuality", value as LifestyleSleepQuality)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Poor">Poor</SelectItem>
                          <SelectItem value="Fair">Fair</SelectItem>
                          <SelectItem value="Good">Good</SelectItem>
                          <SelectItem value="Excellent">Excellent</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Stress Level</Label>
                      <Select
                        value={form.watch("lifestyle.stressLevel") || ""}
                        onValueChange={(value) =>
                          form.setValue("lifestyle.stressLevel", value as LifestyleStressLevel)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Low">Low</SelectItem>
                          <SelectItem value="Moderate">Moderate</SelectItem>
                          <SelectItem value="High">High</SelectItem>
                          <SelectItem value="Very High">Very High</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* Psychosocial Tab */}
              <TabsContent value="psychosocial" className="space-y-4 mt-4">
                <div>
                  <h3 className="font-semibold mb-4">Psychosocial & Support</h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Social Support</Label>
                      <Select
                        value={form.watch("psychosocial.socialSupport") || ""}
                        onValueChange={(value) =>
                          form.setValue("psychosocial.socialSupport", value as PsychosocialSocialSupport)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Strong">Strong</SelectItem>
                          <SelectItem value="Moderate">Moderate</SelectItem>
                          <SelectItem value="Limited">Limited</SelectItem>
                          <SelectItem value="None">None</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Financial Strain</Label>
                      <Select
                        value={form.watch("psychosocial.financialStrain") || ""}
                        onValueChange={(value) =>
                          form.setValue("psychosocial.financialStrain", value as PsychosocialFinancialStrain)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Stable">Stable</SelectItem>
                          <SelectItem value="Moderate">Moderate</SelectItem>
                          <SelectItem value="Significant">Significant</SelectItem>
                          <SelectItem value="Crisis">Crisis</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Transportation</Label>
                      <Select
                        value={form.watch("psychosocial.transportation") || ""}
                        onValueChange={(value) =>
                          form.setValue("psychosocial.transportation", value as PsychosocialTransportation)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Accessible">Accessible</SelectItem>
                          <SelectItem value="Limited">Limited</SelectItem>
                          <SelectItem value="None">None</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2 mt-4">
                    <Label>Notes</Label>
                    <Textarea
                      placeholder="Additional psychosocial notes..."
                      {...form.register("psychosocial.notes")}
                      rows={4}
                    />
                  </div>
                </div>
              </TabsContent>

              {/* Sexual Health Tab */}
              <TabsContent value="sexual" className="space-y-4 mt-4">
                <div>
                  <h3 className="font-semibold mb-2">Sexual Health (Confidential)</h3>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Status</Label>
                      <Select
                        value={form.watch("sexualHealth.status") || ""}
                        onValueChange={(value) =>
                          form.setValue("sexualHealth.status", value)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Active">Active</SelectItem>
                          <SelectItem value="Inactive">Inactive</SelectItem>
                          <SelectItem value="Not Applicable">Not Applicable</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Partners</Label>
                      <Input
                        placeholder="e.g., Male (1 steady)"
                        {...form.register("sexualHealth.partners")}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Contraception</Label>
                      <Input
                        placeholder="e.g., IUD (Mirena)"
                        {...form.register("sexualHealth.contraception")}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>STI History</Label>
                      <Input
                        placeholder="e.g., Negative"
                        {...form.register("sexualHealth.stiHistory")}
                      />
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* Notes Tab */}
              <TabsContent value="notes" className="space-y-4 mt-4">
                <div>
                  <h3 className="font-semibold mb-4">Clinician Notes</h3>
                  <Textarea
                    placeholder="Enter clinician notes..."
                    {...form.register("clinicianNotes")}
                    rows={8}
                  />
                </div>
              </TabsContent>
            </Tabs>

            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowUpdateModal(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

