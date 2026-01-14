import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/app/_lib/auth/get-current-user";
import { getPatientBasics } from "@/app/_lib/db/drizzle/queries/patient";
import { getVisitDetails } from "@/app/_lib/db/drizzle/queries/visit";
import { NewVisitForm } from "@/app/_components/visit/new-visit-form";

interface NewVisitPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ visitId?: string }>;
}

export default async function NewVisitPage({
  params,
  searchParams,
}: NewVisitPageProps) {
  const { id: patientId } = await params;
  const { visitId } = await searchParams;

  // Check authentication and role
  const user = await getCurrentUser();

  if (!user) {
    redirect("/sign-in");
  }

  // Allow doctors and nurses
  if (user.role !== "doctor" && user.role !== "nurse") {
    redirect("/");
  }

  // Get patient basics
  const patientBasics = await getPatientBasics(patientId);

  if (!patientBasics) {
    notFound();
  }

  // If visitId is provided, load existing visit data for editing
  let existingVisitData = null;
  if (visitId) {
    const visitDetails = await getVisitDetails(visitId);
    if (visitDetails && visitDetails.notes[0]) {
      existingVisitData = visitDetails.notes[0].note;
    }
  }

  return (
    <NewVisitForm
      patientId={patientId}
      patientBasics={patientBasics}
      userId={user.id}
      userRole={user.role}
      existingVisitId={visitId || undefined}
      existingVisitData={existingVisitData || undefined}
    />
  );
}

