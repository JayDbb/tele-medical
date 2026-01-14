import { redirect, notFound } from "next/navigation";
import { getServerSession } from "@/app/_lib/supabase/server";
import { getVisitDetails } from "@/app/_lib/db/drizzle/queries/visit";
import { VisitDetailsContent } from "./visit-details-content";

interface VisitDetailPageProps {
  params: Promise<{ id: string; visitId: string }>;
}

export default async function VisitDetailPage({
  params,
}: VisitDetailPageProps) {
  const { id: patientId, visitId } = await params;

  // Check authentication and role
  const session = await getServerSession();

  if (!session) {
    redirect("/sign-in");
  }

  // Allow doctors and nurses
  if (session.role !== "doctor" && session.role !== "nurse") {
    redirect("/");
  }

  // Get visit details
  const visitDetails = await getVisitDetails(visitId);

  if (!visitDetails) {
    notFound();
  }

  return (
    <VisitDetailsContent
      visitId={visitId}
      patientId={patientId}
      visit={visitDetails.visit}
      patient={visitDetails.patient}
      notes={visitDetails.notes}
      transcripts={visitDetails.transcripts}
      documents={visitDetails.documents}
      finalizedByName={visitDetails.finalizedByName}
      auditLogs={visitDetails.auditLogs}
      currentUserId={session.id}
    />
  );
}
