"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SideNav } from "@/components/side-nav";
import { cn } from "@/app/_lib/utils/cn";
import { Menu } from "lucide-react";

interface PatientChartShellProps {
    children: React.ReactNode;
    patientId: string;
    patientName: string;
    userRole: string;
    userName?: string | null;
}

export function PatientChartShell({
    children,
    patientId,
    patientName,
    userRole,
    userName,
}: PatientChartShellProps) {
    const [isSidebarOpen, setIsSidebarOpen] = React.useState(false);
    const openSidebarRef = React.useRef<(() => void) | null>(null);
    const getNewVisitPath = () => {
        return `/patients/${patientId}/new-visit`;
    };

    return (
        <div className="flex h-screen w-full overflow-hidden bg-background">
            {/* SideNav with patient info */}
            <SideNav
                userRole={userRole}
                userName={userName}
                patientId={patientId}
                patientName={patientName}
                onMobileStateChange={setIsSidebarOpen}
                openMenuRef={openSidebarRef}
            />

            {/* Main Content Area */}
            <div className="flex flex-1 flex-col overflow-hidden transition-all duration-300 ease-in-out">
                {/* Top Bar */}
                <div className="flex h-16 items-center gap-4 border-b border-border bg-background px-6">
                    {/* Mobile hamburger button - inline with search */}
                    <Button
                        variant="ghost"
                        size="icon"
                        className="md:hidden shrink-0"
                        onClick={() => {
                            openSidebarRef.current?.();
                        }}
                    >
                        <Menu className="h-5 w-5" />
                        <span className="sr-only">Open menu</span>
                    </Button>
                    <div className="flex-1 min-w-0">
                        <Input
                            placeholder="Search patients, MRN, or DOB"
                            className="max-w-md w-full"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        {/* {userRole === "nurse" && (
                            <Button variant="outline" size="default">
                                Begin Intake
                            </Button>
                        )} */}
                        <Button size="default" asChild>
                            <Link href={getNewVisitPath()}>
                                Log New Visit
                            </Link>
                        </Button>
                    </div>
                </div>

                {/* Page Content */}
                <div className="flex-1 overflow-y-auto bg-background">
                    {children}
                </div>
            </div>
        </div>
    );
}
