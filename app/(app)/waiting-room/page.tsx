import { redirect } from "next/navigation";
import { getServerSession } from "@/app/_lib/supabase/server";
import { getUnassignedPatientsWithVisits } from "@/app/_lib/db/drizzle/queries/patients";
import { Card, CardContent } from "@/components/ui/card";
import { WaitingRoomList } from "./waiting-room-list";

export default async function WaitingRoomPage() {
    // Check authentication and role
    const session = await getServerSession();

    if (!session) {
        redirect("/sign-in");
    }

    // Redirect non-doctors and non-nurses to dashboard
    if (session.role !== "doctor" && session.role !== "nurse") {
        redirect("/");
    }

    // Fetch unassigned patients with visit information
    const patients = await getUnassignedPatientsWithVisits();

    return (
        <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
            <div>
                <h1 className="text-3xl font-bold text-foreground">Waiting Room</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                    Patients waiting to be assigned to a visit
                </p>
            </div>

            {patients.length === 0 ? (
                <Card>
                    <CardContent className="flex items-center justify-center py-12">
                        <p className="text-muted-foreground">No patients waiting</p>
                    </CardContent>
                </Card>
            ) : (
                <WaitingRoomList patients={patients} />
            )}
        </div>
    );
}

