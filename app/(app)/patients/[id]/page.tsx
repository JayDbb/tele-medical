import { redirect, notFound } from "next/navigation";
import { getServerSession } from "@/app/_lib/supabase/server";
import { getPatientOverview } from "@/app/_lib/db/drizzle/queries/patients";
import { PatientOverviewCards } from "./patient-overview-cards";

export default async function PatientOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  
  // Check authentication and role
  const session = await getServerSession();

  if (!session) {
    redirect("/sign-in");
  }

  // Allow doctors and nurses
  if (session.role !== "doctor" && session.role !== "nurse") {
    redirect("/sign-in");
  }

  // Fetch patient overview data
  const overview = await getPatientOverview(id);
  
  if (!overview) {
    notFound();
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Overview</h1>
      </div>

      <PatientOverviewCards 
        patient={overview.patient}
        stats={overview.stats}
        latestVisit={overview.latestVisit}
        userRole={session.role}
      />
    </div>
  );
}

