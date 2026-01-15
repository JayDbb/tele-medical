import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/app/_lib/supabase/server";
import { findExistingPatients } from "@/app/_lib/db/drizzle/queries/patients";
import { redirect } from "next/navigation";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();

    if (!session) {
      redirect("/sign-in");
    }

    // Allow doctors and nurses only
    if (session.role !== "doctor" && session.role !== "nurse") {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { phone, email } = body;

    const existingPatients = await findExistingPatients(phone, email);

    return NextResponse.json({
      existingPatients: existingPatients.map(p => ({
        id: p.id,
        fullName: p.fullName,
        phone: p.phone,
        email: p.email,
        dob: p.dob,
        createdAt: p.createdAt,
      })),
    });
  } catch (error) {
    console.error("Error checking for duplicates:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
