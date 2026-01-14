import { redirect, notFound } from "next/navigation";
import { getServerSession } from "@/app/_lib/supabase/server";
import { getPatientOverview } from "@/app/_lib/db/drizzle/queries/patients";
import { getPatientOrdersAction } from "@/app/_actions/orders";
import { OrdersContent } from "./orders-content";

export default async function OrdersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: patientId } = await params;

  // Check authentication and role
  const session = await getServerSession();

  if (!session) {
    redirect("/sign-in");
  }

  // Allow doctors and nurses
  if (session.role !== "doctor" && session.role !== "nurse") {
    redirect("/sign-in");
  }

  // Verify patient exists
  const overview = await getPatientOverview(patientId);

  if (!overview) {
    notFound();
  }

  // Get orders
  const orders = await getPatientOrdersAction(patientId);

  return (
    <OrdersContent
      patientId={patientId}
      patientName={overview.patient.fullName}
      orders={orders}
    />
  );
}
