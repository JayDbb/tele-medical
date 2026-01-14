"use client";

import * as React from "react";
import { cn } from "@/app/_lib/utils/cn";
import { Check, Circle } from "lucide-react";

export interface VisitSection {
  id: string;
  label: string;
}

const allSections: VisitSection[] = [
  { id: "subjective", label: "Subjective" },
  { id: "objective", label: "Objective" },
  { id: "pointOfCare", label: "Point of Care" },
  { id: "vaccines", label: "Vaccines" },
  { id: "familyHistory", label: "Family History" },
  { id: "riskFlags", label: "Risk Flags" },
  { id: "surgicalHistory", label: "Surgical History" },
  { id: "pastMedicalHistory", label: "Past Medical History" },
  { id: "documents", label: "Documents" },
  { id: "medications", label: "Medications" },
  { id: "orders", label: "Orders" },
  { id: "assessmentPlan", label: "Assessment & Plan" },
];

/**
 * Get sections filtered and ordered based on user role
 */
export function getSectionsForRole(userRole?: string): VisitSection[] {
  if (userRole === "nurse") {
    // For nurses: exclude assessmentPlan, and reorder so objective is 2nd to last, subjective is last
    // Filter out assessmentPlan, objective, and subjective
    const otherSections = allSections.filter(
      s => s.id !== "assessmentPlan" && s.id !== "objective" && s.id !== "subjective"
    );
    
    // Build result: other sections, then objective (2nd to last), then subjective (last)
    const result = [...otherSections];
    result.push({ id: "objective", label: "Objective" });
    result.push({ id: "subjective", label: "Subjective" });
    
    return result;
  }
  
  // For doctors: return all sections in original order
  return allSections;
}

interface SectionStepperProps {
  currentSection: string;
  reviewedSections: Set<string>;
  onSectionClick: (sectionId: string) => void;
  userRole?: string;
  className?: string;
}

export function SectionStepper({
  currentSection,
  reviewedSections,
  onSectionClick,
  userRole,
  className,
}: SectionStepperProps) {
  const sections = getSectionsForRole(userRole);
  
  return (
    <div className={cn("space-y-1", className)}>
      <h3 className="text-sm font-semibold text-foreground mb-3">
        Visit Note Sections
      </h3>
      <nav className="space-y-1">
        {sections.map((section) => {
          const isCurrent = currentSection === section.id;
          const isReviewed = reviewedSections.has(section.id);
          
          return (
            <button
              key={section.id}
              onClick={() => onSectionClick(section.id)}
              className={cn(
                "w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center gap-2",
                isCurrent
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                isReviewed && !isCurrent && "text-foreground/80"
              )}
            >
              {isReviewed ? (
                <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
              ) : (
                <Circle className="h-4 w-4" />
              )}
              <span>{section.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

// Export all sections for backward compatibility (used in other places)
export { allSections as visitSections };

