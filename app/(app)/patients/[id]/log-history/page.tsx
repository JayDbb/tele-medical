import { redirect, notFound } from "next/navigation";
import { getServerSession } from "@/app/_lib/supabase/server";
import { getPatientLogHistory } from "@/app/_lib/db/drizzle/queries/visit";
import { LogHistoryContent } from "./log-history-content";

interface PatientLogHistoryPageProps {
  params: Promise<{ id: string }>;
}

export default async function PatientLogHistoryPage({
  params,
}: PatientLogHistoryPageProps) {
  const { id: patientId } = await params;
  const session = await getServerSession();

  if (!session) {
    redirect("/sign-in");
  }

  if (session.role !== "doctor" && session.role !== "nurse") {
    redirect("/");
  }

  const result = await getPatientLogHistory(patientId);

  if (!result) {
    notFound();
  }

  return (
    <LogHistoryContent
      patientId={patientId}
      patientName={result.patient.fullName}
      entries={result.entries}
    />
  );
}
