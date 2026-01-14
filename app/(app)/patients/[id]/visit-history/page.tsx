import { redirect, notFound } from "next/navigation";
import { getServerSession } from "@/app/_lib/supabase/server";
import { getVisitHistory } from "@/app/_lib/db/drizzle/queries/visit-history";
import { VisitHistoryContent } from "./visit-history-content";

interface VisitHistoryPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    page?: string;
    pageSize?: string;
    status?: string;
    from?: string;
    to?: string;
    q?: string;
  }>;
}

export default async function VisitHistoryPage({
  params,
  searchParams,
}: VisitHistoryPageProps) {
  const { id: patientId } = await params;
  const {
    page,
    pageSize,
    status,
    from,
    to,
    q,
  } = await searchParams;

  // Check authentication and role
  const session = await getServerSession();

  if (!session) {
    redirect("/sign-in");
  }

  // Allow doctors and nurses
  if (session.role !== "doctor" && session.role !== "nurse") {
    redirect("/");
  }

  // Parse query params
  const pageNum = page ? parseInt(page, 10) : 1;
  const pageSizeNum = pageSize ? parseInt(pageSize, 10) : 20;
  const statusFilter = status || null;
  const fromDate = from || null;
  const toDate = to || null;
  const searchQuery = q || null;

  // Fetch visit history
  const result = await getVisitHistory(patientId, {
    page: pageNum,
    pageSize: pageSizeNum,
    status: statusFilter,
    from: fromDate,
    to: toDate,
  });

  if (!result) {
    notFound();
  }

  return (
    <VisitHistoryContent
      patientId={patientId}
      userRole={session.role}
      data={result}
      searchQuery={searchQuery}
    />
  );
}

