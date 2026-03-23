import {
  Breadcrumb,
  BreadcrumbHome,
  Breadcrumbs,
  BreadcrumbSeparator,
} from "@/components/breadcrumbs";
import { DashboardContent } from "@/components/dashboard";
import { SidebarLayoutContent } from "@/components/sidebar-layout";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Monitor your MTG card prices in real time.",
};

export default function DashboardPage() {
  return (
    <SidebarLayoutContent
      breadcrumbs={
        <Breadcrumbs>
          <BreadcrumbHome />
          <BreadcrumbSeparator />
          <Breadcrumb>Dashboard</Breadcrumb>
        </Breadcrumbs>
      }
    >
      <DashboardContent />
    </SidebarLayoutContent>
  );
}
