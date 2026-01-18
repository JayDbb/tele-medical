import { redirect } from "next/navigation";
import { getServerSession } from "@/app/_lib/supabase/server";
import { CreateUserForm } from "./create-user-form";
import { SideNav } from "@/components/side-nav";

export default async function CreateUserPage() {
  const session = await getServerSession();

  if (!session) {
    redirect("/sign-in");
  }

  // Only doctors and nurses can create users
  if (session.role !== "doctor" && session.role !== "nurse") {
    redirect("/");
  }

  const userRole = session.role;
  const userName = session.name;

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* SideNav */}
      <SideNav
        userRole={userRole}
        userName={userName}
      />

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-hidden transition-all duration-300 ease-in-out">
        {/* Top Bar */}
        <div className="flex h-16 items-center gap-4 border-b border-border bg-background px-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Create User</h1>
            <p className="text-sm text-muted-foreground">
              Create a new doctor or nurse account
            </p>
          </div>
        </div>

        {/* Page Content */}
        <div className="flex-1 overflow-y-auto bg-background">
          <div className="container mx-auto py-8 px-4 max-w-2xl">
            <CreateUserForm />
          </div>
        </div>
      </div>
    </div>
  );
}
