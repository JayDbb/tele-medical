import { redirect, notFound } from "next/navigation";
import { getServerSession } from "@/app/_lib/supabase/server";
import { getPatientPersonalDetails } from "@/app/_lib/db/drizzle/queries/patient-personal-details";
import { PersonalDetailsContent } from "./personal-details-content";

export default async function PersonalDetailsPage({
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
        redirect("/");
    }

    // Fetch patient personal details
    const patientData = await getPatientPersonalDetails(id);

    if (!patientData) {
        notFound();
    }

    return <PersonalDetailsContent patientData={patientData} patientId={id} />;
}

