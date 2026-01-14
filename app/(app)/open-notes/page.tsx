import { redirect } from "next/navigation";
import { getServerSession } from "@/app/_lib/supabase/server";
import { getClinicianOpenVisitsAction } from "@/app/_actions/visits";
import { OpenNotesContent } from "./open-notes-content";

export default async function OpenNotesPage() {
  // Check authentication and role
  const session = await getServerSession();

  if (!session) {
    redirect("/sign-in");
  }

  // Redirect non-doctors to dashboard
  if (session.role !== "doctor") {
    redirect("/");
  }

  // Fetch open visits for the current clinician
  const { visits } = await getClinicianOpenVisitsAction();

  return <OpenNotesContent visits={visits} />;
}

