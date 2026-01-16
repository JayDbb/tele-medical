"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Save, Phone, Mail, Calendar, UserPlus, Cross, FileText, X, Clock, User, AlertCircle, Search, ChevronDown, Check } from "lucide-react";
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

// Phone number validation helper
const phoneRegex = /^[\d\s\-\(\)\+\.]+$/;
const cleanPhone = (phone: string) => phone.replace(/\D/g, "");

// US ZIP code validation (5 digits or 5+4 format)
const zipRegex = /^\d{5}(-\d{4})?$/;

// Country codes with common countries (no flags)
const countryCodes = [
  { code: "+1", country: "United States", areaCode: "" },
  { code: "+1", country: "Jamaica", areaCode: "876" },
  { code: "+1", country: "Jamaica", areaCode: "658" },
  { code: "+1", country: "Canada", areaCode: "" },
  { code: "+44", country: "United Kingdom", areaCode: "" },
  { code: "+52", country: "Mexico", areaCode: "" },
  { code: "+33", country: "France", areaCode: "" },
  { code: "+49", country: "Germany", areaCode: "" },
  { code: "+39", country: "Italy", areaCode: "" },
  { code: "+34", country: "Spain", areaCode: "" },
  { code: "+86", country: "China", areaCode: "" },
  { code: "+81", country: "Japan", areaCode: "" },
  { code: "+91", country: "India", areaCode: "" },
  { code: "+61", country: "Australia", areaCode: "" },
  { code: "+55", country: "Brazil", areaCode: "" },
  { code: "+27", country: "South Africa", areaCode: "" },
  { code: "+234", country: "Nigeria", areaCode: "" },
  { code: "+254", country: "Kenya", areaCode: "" },
  { code: "+233", country: "Ghana", areaCode: "" },
  { code: "+1", country: "Trinidad & Tobago", areaCode: "868" },
  { code: "+1", country: "Barbados", areaCode: "246" },
  { code: "+1", country: "Bahamas", areaCode: "242" },
  { code: "+1", country: "Other Caribbean", areaCode: "" },
];

// Default to Jamaica (876)
const DEFAULT_COUNTRY = countryCodes.find(c => c.country === "Jamaica" && c.areaCode === "876") || countryCodes[1];

// US State codes (2-letter abbreviations)
const usStates = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC"
];

const createPatientSchema = z.object({
  firstName: z
    .string()
    .min(1, "First name is required")
    .min(2, "First name must be at least 2 characters")
    .max(50, "First name must be less than 50 characters")
    .regex(/^[a-zA-Z\s\-'\.]+$/, "First name can only contain letters, spaces, hyphens, apostrophes, and periods"),
  lastName: z
    .string()
    .min(1, "Last name is required")
    .min(2, "Last name must be at least 2 characters")
    .max(50, "Last name must be less than 50 characters")
    .regex(/^[a-zA-Z\s\-'\.]+$/, "Last name can only contain letters, spaces, hyphens, apostrophes, and periods"),
  dob: z
    .string()
    .min(1, "Date of birth is required")
    .refine(
      (val) => {
        const date = new Date(val);
        return !isNaN(date.getTime());
      },
      { message: "Invalid date format" }
    )
    .refine(
      (val) => {
        const date = new Date(val);
        const today = new Date();
        today.setHours(23, 59, 59, 999); // End of today
        return date <= today;
      },
      { message: "Date of birth cannot be in the future" }
    )
    .refine(
      (val) => {
        const date = new Date(val);
        const today = new Date();
        const age = today.getFullYear() - date.getFullYear();
        const monthDiff = today.getMonth() - date.getMonth();
        const actualAge = monthDiff < 0 || (monthDiff === 0 && today.getDate() < date.getDate()) ? age - 1 : age;
        return actualAge <= 150;
      },
      { message: "Please enter a valid date of birth" }
    ),
  sexAtBirth: z.string().min(1, "Sex at birth is required"),
  genderIdentity: z.string().optional(),
  phoneCountryCode: z.string().min(1, "Country code is required"),
  phone: z
    .string()
    .min(1, "Mobile phone is required")
    .refine(
      (val) => {
        const cleaned = cleanPhone(val);
        // International numbers can be 7-15 digits (excluding country code)
        return cleaned.length >= 7 && cleaned.length <= 15;
      },
      { message: "Phone number must be between 7 and 15 digits" }
    ),
  email: z
    .string()
    .optional()
    .refine(
      (val) => !val || val === "" || z.string().email().safeParse(val).success,
      {
        message: "Invalid email address",
      }
    ),
  streetAddress: z
    .string()
    .optional()
    .refine(
      (val) => !val || val.length <= 200,
      { message: "Street address must be less than 200 characters" }
    ),
  city: z
    .string()
    .optional()
    .refine(
      (val) => !val || val.length <= 100,
      { message: "City must be less than 100 characters" }
    )
    .refine(
      (val) => !val || /^[a-zA-Z\s\-'\.]+$/.test(val),
      { message: "City can only contain letters, spaces, hyphens, apostrophes, and periods" }
    ),
  state: z
    .string()
    .optional()
    .refine(
      (val) => !val || val.length <= 50,
      { message: "Parish/State must be less than 50 characters" }
    ),
  primaryLanguage: z.string().optional(),
  smsNotifications: z.boolean(),
  emailNotifications: z.boolean(),
  emergencyContactName: z
    .string()
    .optional()
    .refine(
      (val) => !val || val.length <= 100,
      { message: "Emergency contact name must be less than 100 characters" }
    )
    .refine(
      (val) => !val || /^[a-zA-Z\s\-'\.]+$/.test(val),
      { message: "Emergency contact name can only contain letters, spaces, hyphens, apostrophes, and periods" }
    ),
  emergencyContactRelationship: z
    .string()
    .optional()
    .refine(
      (val) => !val || val.length <= 50,
      { message: "Relationship must be less than 50 characters" }
    ),
  emergencyContactPhoneCountryCode: z.string().optional(),
  emergencyContactPhone: z
    .string()
    .optional()
    .refine(
      (val) => {
        if (!val || val.trim() === "") return true;
        const cleaned = cleanPhone(val);
        // International numbers can be 7-15 digits (excluding country code)
        return cleaned.length >= 7 && cleaned.length <= 15;
      },
      { message: "Emergency contact phone must be between 7 and 15 digits" }
    ),
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

// Searchable Country Code Selector Component
function CountryCodeSelector({
  value,
  onValueChange,
  error,
  id,
}: {
  value: string;
  onValueChange: (value: string) => void;
  error?: boolean;
  id?: string;
}) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Filter countries based on search
  const filteredCountries = React.useMemo(() => {
    if (!searchQuery.trim()) return countryCodes;
    const query = searchQuery.toLowerCase();
    return countryCodes.filter(
      (c) =>
        c.country.toLowerCase().includes(query) ||
        c.code.includes(query) ||
        c.areaCode.includes(query) ||
        `${c.code}${c.areaCode ? `-${c.areaCode}` : ""}`.includes(query)
    );
  }, [searchQuery]);

  // Get display value for selected country
  const selectedCountry = countryCodes.find((c) => {
    const codeValue = `${c.code}${c.areaCode ? `-${c.areaCode}` : ""}`;
    return codeValue === value;
  });

  const displayValue = selectedCountry
    ? `${selectedCountry.code}${selectedCountry.areaCode ? `-${selectedCountry.areaCode}` : ""} ${selectedCountry.country}`
    : "Select country";

  // Close dropdown when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchQuery("");
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative w-[220px]">
      <button
        type="button"
        id={id}
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
          error && "border-destructive"
        )}
      >
        <span className="truncate text-left">{displayValue}</span>
        <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md">
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search country or code..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-8"
                autoFocus
              />
            </div>
          </div>
          <div className="max-h-[300px] overflow-y-auto p-1">
            {filteredCountries.length === 0 ? (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">No countries found</div>
            ) : (
              filteredCountries.map((country) => {
                const codeValue = `${country.code}${country.areaCode ? `-${country.areaCode}` : ""}`;
                const isSelected = codeValue === value;
                return (
                  <button
                    key={codeValue}
                    type="button"
                    onClick={() => {
                      onValueChange(codeValue);
                      setIsOpen(false);
                      setSearchQuery("");
                    }}
                    className={cn(
                      "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
                      isSelected && "bg-accent"
                    )}
                  >
                    <span className="flex-1 text-left">
                      {country.code}{country.areaCode ? `-${country.areaCode}` : ""} {country.country}
                    </span>
                    {isSelected && (
                      <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
                        <Check className="h-4 w-4" />
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
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
      dob: "",
      sexAtBirth: undefined,
      genderIdentity: undefined,
      phoneCountryCode: `${DEFAULT_COUNTRY.code}${DEFAULT_COUNTRY.areaCode ? `-${DEFAULT_COUNTRY.areaCode}` : ""}`,
      phone: "",
      email: "",
      streetAddress: "",
      city: "",
      state: "",
      primaryLanguage: "English",
      smsNotifications: false,
      emailNotifications: true,
      emergencyContactName: "",
      emergencyContactRelationship: "",
      emergencyContactPhoneCountryCode: `${DEFAULT_COUNTRY.code}${DEFAULT_COUNTRY.areaCode ? `-${DEFAULT_COUNTRY.areaCode}` : ""}`,
      emergencyContactPhone: "",
      primaryCareProvider: undefined,
    },
  });

  const onSubmit = async (data: CreatePatientFormData) => {
    // Validate form and show toast errors
    const isValid = await form.trigger();
    if (!isValid) {
      const errors = form.formState.errors;
      const firstError = Object.values(errors)[0];
      if (firstError?.message) {
        toast.error(firstError.message);
      } else {
        toast.error("Please fix the errors in the form");
      }
      // Scroll to first error
      const firstErrorField = Object.keys(errors)[0];
      const element = document.getElementById(firstErrorField);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        element.focus();
      }
      return;
    }

    try {
      setIsSaving(true);

      // Format phone number with country code
      const phoneCountry = countryCodes.find(c => {
        const codeValue = `${c.code}${c.areaCode ? `-${c.areaCode}` : ""}`;
        return data.phoneCountryCode === codeValue;
      }) || countryCodes[0];

      const phoneDigits = data.phone.replace(/\D/g, "");
      const fullPhone = phoneCountry.areaCode
        ? `${phoneCountry.code}${phoneCountry.areaCode}${phoneDigits}`
        : `${phoneCountry.code}${phoneDigits}`;

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
          phone: fullPhone,
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
                <span className="text-xs font-normal text-destructive bg-destructive/10 px-2 py-1 rounded">
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
                    Gender <span className="text-destructive">*</span>
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
                <div className="flex gap-2">
                  <CountryCodeSelector
                    id="phoneCountryCode"
                    value={form.watch("phoneCountryCode") || `${DEFAULT_COUNTRY.code}${DEFAULT_COUNTRY.areaCode ? `-${DEFAULT_COUNTRY.areaCode}` : ""}`}
                    onValueChange={(value) => {
                      form.setValue("phoneCountryCode", value, { shouldValidate: true });
                    }}
                    error={!!form.formState.errors.phoneCountryCode}
                  />
                  <div className="relative flex-1">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="phone"
                      type="tel"
                      placeholder="123-4567"
                      className={cn(
                        "pl-10",
                        form.formState.errors.phone && "border-destructive"
                      )}
                      {...form.register("phone", {
                        onChange: (e) => {
                          // Allow international format - just clean and validate length
                          let value = e.target.value;
                          // Don't auto-format for international numbers, just allow digits and common separators
                          form.setValue("phone", value, { shouldValidate: true });
                        },
                      })}
                    />
                  </div>
                </div>
                {form.formState.errors.phoneCountryCode && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.phoneCountryCode.message}
                  </p>
                )}
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
                  className={cn(
                    form.formState.errors.streetAddress && "border-destructive"
                  )}
                />
                {form.formState.errors.streetAddress && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.streetAddress.message}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="city">City</Label>
                  <Input
                    id="city"
                    {...form.register("city")}
                    className={cn(
                      form.formState.errors.city && "border-destructive"
                    )}
                  />
                  {form.formState.errors.city && (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.city.message}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="state">Parish/State</Label>
                  <Input
                    id="state"
                    placeholder="Kingston or CA"
                    {...form.register("state", {
                      onChange: (e) => {
                        const value = e.target.value;
                        form.setValue("state", value, { shouldValidate: true });
                      },
                    })}
                    className={cn(
                      form.formState.errors.state && "border-destructive"
                    )}
                  />
                  {form.formState.errors.state && (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.state.message}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Enter parish name or 2-letter state code
                  </p>
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
                  className={cn(
                    form.formState.errors.emergencyContactName && "border-destructive"
                  )}
                />
                {form.formState.errors.emergencyContactName && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.emergencyContactName.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="emergencyContactRelationship">Relationship</Label>
                <Input
                  id="emergencyContactRelationship"
                  placeholder="e.g., Spouse, Parent, Friend"
                  {...form.register("emergencyContactRelationship")}
                  className={cn(
                    form.formState.errors.emergencyContactRelationship && "border-destructive"
                  )}
                />
                {form.formState.errors.emergencyContactRelationship && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.emergencyContactRelationship.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="emergencyContactPhone">Phone</Label>
                <div className="flex gap-2">
                  <CountryCodeSelector
                    id="emergencyContactPhoneCountryCode"
                    value={form.watch("emergencyContactPhoneCountryCode") || `${DEFAULT_COUNTRY.code}${DEFAULT_COUNTRY.areaCode ? `-${DEFAULT_COUNTRY.areaCode}` : ""}`}
                    onValueChange={(value) => {
                      form.setValue("emergencyContactPhoneCountryCode", value, { shouldValidate: true });
                    }}
                  />
                  <div className="relative flex-1">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none z-10" />
                    <Input
                      id="emergencyContactPhone"
                      type="tel"
                      placeholder="123-4567"
                      {...form.register("emergencyContactPhone", {
                        onChange: (e) => {
                          // Allow international format
                          let value = e.target.value;
                          form.setValue("emergencyContactPhone", value, { shouldValidate: true });
                        },
                      })}
                      className={cn(
                        "pl-10",
                        form.formState.errors.emergencyContactPhone && "border-destructive"
                      )}
                    />
                  </div>
                </div>
                {form.formState.errors.emergencyContactPhone && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.emergencyContactPhone.message}
                  </p>
                )}
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

            // Format phone numbers with country codes
            const phoneCountry = countryCodes.find(c =>
              pendingPatientData.phoneCountryCode.startsWith(c.code) &&
              (c.areaCode === "" || pendingPatientData.phoneCountryCode.includes(c.areaCode))
            ) || countryCodes[0];

            const fullPhone = `${phoneCountry.code}${phoneCountry.areaCode ? phoneCountry.areaCode : ""}${pendingPatientData.phone.replace(/\D/g, "")}`;

            let fullEmergencyPhone: string | undefined = undefined;
            if (pendingPatientData.emergencyContactPhone && pendingPatientData.emergencyContactPhoneCountryCode) {
              const emergencyCountry = countryCodes.find(c => {
                const codeValue = `${c.code}${c.areaCode ? `-${c.areaCode}` : ""}`;
                return pendingPatientData.emergencyContactPhoneCountryCode === codeValue;
              }) || countryCodes[0];
              const emergencyDigits = pendingPatientData.emergencyContactPhone.replace(/\D/g, "");
              fullEmergencyPhone = emergencyCountry.areaCode
                ? `${emergencyCountry.code}${emergencyCountry.areaCode}${emergencyDigits}`
                : `${emergencyCountry.code}${emergencyDigits}`;
            }

            // Now create the patient with the signature URL and the pre-generated ID
            const result = await createPatientAction({
              firstName: pendingPatientData.firstName,
              lastName: pendingPatientData.lastName,
              dob: pendingPatientData.dob || undefined,
              sexAtBirth: pendingPatientData.sexAtBirth || undefined,
              genderIdentity: pendingPatientData.genderIdentity || undefined,
              phone: fullPhone,
              email: pendingPatientData.email || undefined,
              streetAddress: pendingPatientData.streetAddress || undefined,
              city: pendingPatientData.city || undefined,
              state: pendingPatientData.state || undefined,
              primaryLanguage: pendingPatientData.primaryLanguage || undefined,
              preferredCommMethod: preferredCommMethod || undefined,
              emergencyContactName: pendingPatientData.emergencyContactName || undefined,
              emergencyContactRelationship: pendingPatientData.emergencyContactRelationship || undefined,
              emergencyContactPhone: fullEmergencyPhone || undefined,
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

                  // Navigate to form where user will fill in triage and type, then see success toast
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

