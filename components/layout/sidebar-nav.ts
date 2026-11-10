import {
  Building2,
  CalendarCheck,
  CreditCard,
  BadgeCheck,
  Briefcase,
  FileText,
  CalendarClock,
  UserSearch,
  LayoutDashboard,
  LayoutGrid,
  Truck,
  UserCog,
  Users,
  Users2,
  WalletCards,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { MODULES, type Module } from "@/lib/modules";

export interface SystemItem {
  fullName: string;
  desc: string;
  icon: LucideIcon;
  active: boolean;
  url?: string;
}

export type SystemChild = SystemItem;

export interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  /** The Module whose access decision gates this tab and its page. */
  module: Module["name"];
}

export interface NavSection {
  /** A visual label only; access is decided per tab. */
  label?: string;
  items: NavItem[];
}

/** The sidebar, top to bottom. */
export const sidebarSections: NavSection[] = [
  {
    items: [
      { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard, module: "Dashboard" },
    ],
  },
  {
    label: "RECRUITMENT",
    items: [
      { name: "Job Postings", href: "/job-postings", icon: Briefcase, module: "Recruitment and Hiring" },
      { name: "Applicants", href: "/applicants", icon: UserSearch, module: "Recruitment and Hiring" },
    ],
  },
  {
    label: "HIRING",
    items: [
      { name: "Interviews", href: "/interviews", icon: CalendarClock, module: "Recruitment and Hiring" },
      { name: "Offers", href: "/offers", icon: FileText, module: "Recruitment and Hiring" },
      { name: "Hired", href: "/hired", icon: BadgeCheck, module: "Recruitment and Hiring" },
    ],
  },
  {
    items: [
      { name: "Attendance", href: "/attendance", icon: CalendarCheck, module: "Attendance" },
      { name: "Employee Information", href: "/employee-information", icon: Users, module: "Employee Information" },
      { name: "Payroll & ESS", href: "/payroll-ess", icon: WalletCards, module: "Payroll & ESS" },
      { name: "User Management", href: "/user-management", icon: UserCog, module: "User Management" },
    ],
  },
];

/** The sections a Staff member sees, given the Module pages they may open; empty sections drop out. */
export function sidebarFor(permittedPages: string[]): NavSection[] {
  const permittedModules = new Set(
    MODULES.filter((m) => permittedPages.includes(m.href)).map((m) => m.name),
  );

  return sidebarSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => permittedModules.has(item.module)),
    }))
    .filter((section) => section.items.length > 0);
}

export const systems: SystemItem[] = [
  {
    fullName: "Enterprise Portal",
    desc: "All systems hub & app launcher",
    icon: LayoutGrid,
    active: false,
    url: process.env.NEXT_PUBLIC_HOST_URL ?? "https://portal.buildwrite.me/",
  },
  {
    fullName: "Customer Relationship Management",
    desc: "Contact profiles, tickets & marketing",
    icon: Building2,
    active: false,
    url: process.env.NEXT_PUBLIC_CRMS_URL ?? "https://creoms.buildwrite.me/",
  },
  {
    fullName: "Human Resource Management",
    desc: "Staff directory & payroll",
    icon: Users2,
    active: true,
    url: process.env.NEXT_PUBLIC_HRMS_URL ?? "https://hrms.buildwrite.me/",
  },
  {
    fullName: "Point of Sale",
    desc: "Retail & register checkout",
    icon: CreditCard,
    active: false,
    url: "https://web-pos-alpha-vert.vercel.app/",
  },
  {
    fullName: "IMS - Inventory Management System",
    desc: "Inventory & logistics",
    icon: Truck,
    active: false,
    url: "https://br-sims.vercel.app/",
  },
];
