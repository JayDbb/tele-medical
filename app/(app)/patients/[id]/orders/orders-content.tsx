"use client";

import * as React from "react";
import { Plus, Search, FileText, Clock, AlertCircle, CheckCircle, Filter, Calendar, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Order } from "@/app/_actions/orders";
import { cn } from "@/app/_lib/utils/cn";

interface OrdersContentProps {
  patientId: string;
  patientName: string;
  orders: Order[];
}

type OrderType = "all" | "medications" | "labs" | "imaging";

export function OrdersContent({
  patientId,
  patientName,
  orders: initialOrders,
}: OrdersContentProps) {
  const [orders] = React.useState<Order[]>(initialOrders);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [selectedType, setSelectedType] = React.useState<OrderType>("all");

  // Calculate summary statistics
  const { ordersToday, pendingApproval, statOrders, completed } = React.useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const ordersToday = orders.filter(order => {
      const orderDate = order.dateOrdered ? new Date(order.dateOrdered) : new Date(order.visitDate);
      orderDate.setHours(0, 0, 0, 0);
      return orderDate.getTime() === today.getTime();
    });

    const pendingApproval = orders.filter(order =>
      order.status?.toLowerCase().includes("pending") ||
      order.status?.toLowerCase().includes("approval")
    );

    const statOrders = orders.filter(order =>
      order.priority?.toLowerCase() === "stat" ||
      order.priority?.toLowerCase() === "urgent"
    );

    const completed = orders.filter(order =>
      order.status?.toLowerCase().includes("completed") ||
      order.status?.toLowerCase().includes("fulfilled")
    );

    return { ordersToday, pendingApproval, statOrders, completed };
  }, [orders]);

  // Filter orders based on type and search
  const filteredOrders = React.useMemo(() => {
    let filtered = orders;

    // Filter by type
    if (selectedType !== "all") {
      filtered = filtered.filter(order => {
        const orderType = order.type?.toLowerCase() || "";
        return orderType.includes(selectedType);
      });
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(order =>
        order.details?.toLowerCase().includes(query) ||
        order.type?.toLowerCase().includes(query) ||
        order.status?.toLowerCase().includes(query) ||
        order.orderedByName?.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [orders, selectedType, searchQuery]);

  const formatDate = (date: Date | string) => {
    try {
      const d = typeof date === "string" ? new Date(date) : date;
      return d.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return "N/A";
    }
  };

  const getPriorityBadge = (priority: string) => {
    const priorityLower = priority?.toLowerCase() || "";
    if (priorityLower === "stat" || priorityLower === "urgent") {
      return (
        <Badge variant="destructive" className="bg-red-500 text-white">
          {priority || "N/A"}
        </Badge>
      );
    }
    if (priorityLower === "routine" || priorityLower === "normal") {
      return (
        <Badge variant="default" className="bg-blue-500 text-white">
          {priority || "N/A"}
        </Badge>
      );
    }
    return (
      <Badge variant="outline">
        {priority || "N/A"}
      </Badge>
    );
  };

  const getStatusBadge = (status: string) => {
    const statusLower = status?.toLowerCase() || "";
    if (statusLower.includes("completed") || statusLower.includes("fulfilled")) {
      return (
        <Badge variant="default" className="bg-green-500 text-white">
          {status || "N/A"}
        </Badge>
      );
    }
    if (statusLower.includes("pending") || statusLower.includes("approval")) {
      return (
        <Badge variant="default" className="bg-orange-500 text-white">
          {status || "N/A"}
        </Badge>
      );
    }
    return (
      <Badge variant="outline">
        {status || "N/A"}
      </Badge>
    );
  };

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-foreground">Orders</h1>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          New Order
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Orders Today</p>
                <p className="text-2xl font-bold">{ordersToday.length}</p>
                {ordersToday.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">No data</p>
                )}
              </div>
              <div className="relative">
                <FileText className="h-8 w-8 text-blue-500" />
                <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-blue-500 rounded-full border-2 border-background" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Pending Approval</p>
                <p className="text-2xl font-bold">{pendingApproval.length}</p>
                {pendingApproval.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">No data</p>
                )}
              </div>
              <div className="relative">
                <Clock className="h-8 w-8 text-orange-500" />
                <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-orange-500 rounded-full border-2 border-background" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground mb-1">STAT Orders</p>
                <p className="text-2xl font-bold">{statOrders.length}</p>
                {statOrders.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">No data</p>
                )}
              </div>
              <div className="relative">
                <AlertCircle className="h-8 w-8 text-red-500" />
                <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-background" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Completed</p>
                <p className="text-2xl font-bold">{completed.length}</p>
                {completed.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">No data</p>
                )}
              </div>
              <div className="relative">
                <CheckCircle className="h-8 w-8 text-green-500" />
                <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-background" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Orders Management */}
      <Card>
        <CardContent className="p-6">
          <div className="space-y-4">
            {/* Title and Description */}
            <div>
              <h2 className="text-xl font-bold text-foreground mb-1">Orders Management</h2>
              <p className="text-sm text-muted-foreground">
                Manage patient orders, labs, and medications.
              </p>
            </div>

            {/* Filters and Search */}
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
              <Tabs value={selectedType} onValueChange={(v) => setSelectedType(v as OrderType)}>
                <TabsList>
                  <TabsTrigger value="all">All Types</TabsTrigger>
                  <TabsTrigger value="medications">Medications</TabsTrigger>
                  <TabsTrigger value="labs">Labs</TabsTrigger>
                  <TabsTrigger value="imaging">Imaging</TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="flex gap-2 w-full sm:w-auto">
                <div className="relative flex-1 sm:flex-initial">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 w-full sm:w-[200px]"
                  />
                </div>
                <Button variant="outline" size="icon">
                  <Filter className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Orders Table */}
            <div className="border rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-foreground uppercase tracking-wider">
                        ORDER DETAILS
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-foreground uppercase tracking-wider">
                        TYPE
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-foreground uppercase tracking-wider">
                        PRIORITY
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-foreground uppercase tracking-wider">
                        STATUS
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-foreground uppercase tracking-wider">
                        DATE
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-foreground uppercase tracking-wider">
                        ORDERED BY
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredOrders.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-12 text-center">
                          <p className="text-muted-foreground">No orders recorded yet.</p>
                        </td>
                      </tr>
                    ) : (
                      filteredOrders.map((order) => (
                        <tr key={order.id} className="hover:bg-muted/50 transition-colors">
                          <td className="px-4 py-3">
                            <div className="max-w-md">
                              <p className="text-sm font-medium text-foreground truncate">
                                {order.details || "No details"}
                              </p>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="outline">
                              {order.type || "N/A"}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            {getPriorityBadge(order.priority)}
                          </td>
                          <td className="px-4 py-3">
                            {getStatusBadge(order.status)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Calendar className="h-4 w-4" />
                              <span>
                                {order.dateOrdered 
                                  ? formatDate(order.dateOrdered)
                                  : formatDate(order.visitDate)}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <User className="h-4 w-4" />
                              <span>{order.orderedByName || "N/A"}</span>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
