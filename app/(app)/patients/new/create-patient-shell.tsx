"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { SideNav } from "@/components/side-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Menu } from "lucide-react";

interface CreatePatientShellProps {
    children: React.ReactNode;
    userRole?: string;
    userName?: string | null;
}

export function CreatePatientShell({ children, userRole, userName }: CreatePatientShellProps) {
    const router = useRouter();
    const [isSidebarOpen, setIsSidebarOpen] = React.useState(false);
    const openSidebarRef = React.useRef<(() => void) | null>(null);

    const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            const searchValue = (e.target as HTMLInputElement).value.trim();
            if (searchValue) {
                router.push(`/patients?search=${encodeURIComponent(searchValue)}`);
            } else {
                router.push("/patients");
            }
        }
    };

    // Prevent body scrolling when this component is mounted
    React.useEffect(() => {
        const originalStyle = window.getComputedStyle(document.body).overflow;
        document.body.style.overflow = "hidden";
        document.documentElement.style.overflow = "hidden";
        
        return () => {
            document.body.style.overflow = originalStyle;
            document.documentElement.style.overflow = originalStyle;
        };
    }, []);

    return (
        <div className="fixed inset-0 flex overflow-hidden bg-background">
            {/* SideNav */}
            <SideNav
                userRole={userRole}
                userName={userName}
                onMobileStateChange={setIsSidebarOpen}
                openMenuRef={openSidebarRef}
            />

            {/* Main Content Area */}
            <div className="flex flex-1 flex-col min-w-0 overflow-hidden transition-all duration-300 ease-in-out">
                {/* Top Bar */}
                <div className="flex h-16 shrink-0 items-center gap-4 border-b border-border bg-background px-6">
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
                            placeholder="Search patients, MRN, or DOB (press Enter to search)"
                            className="max-w-md w-full"
                            id="create-patient-search"
                            onKeyDown={handleSearch}
                        />
                    </div>
                </div>

                {/* Page Content */}
                <div className="flex-1 min-h-0 overflow-y-auto bg-background overscroll-contain">
                    {children}
                </div>
            </div>
        </div>
    );
}
