import {
  Building2,
  CreditCard,
  Briefcase,
  FileText,
  CalendarClock,
  CalendarDays,
  UserSearch,
  LayoutDashboard,
  LayoutGrid,
  Truck,
  Users,
  UserCheck,
  Users2,
  GraduationCap,
  History,
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

/** The sidebar, top to bottom. Performance has a Module but no HRMS pages to list yet. */
export const sidebarSections: NavSection[] = [
  {
    items: [
      { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard, module: "Dashboard" },
    ],
  },
  {
    label: "RECRUITMENT",
    items: [
      { name: "Job Postings", href: "/job-postings", icon: Briefcase, module: "Job Postings" },
      { name: "Applicants", href: "/applicants", icon: UserSearch, module: "Applications" },
    ],
  },
  {
    label: "HIRING",
    items: [
      { name: "Interviews", href: "/interviews", icon: CalendarClock, module: "Interviews" },
      { name: "Offers", href: "/offers", icon: FileText, module: "Offers" },
    ],
  },
  {
    label: "EMPLOYEE",
    items: [
      { name: "Information", href: "/employee-information", icon: Users, module: "Employee Information" },
      { name: "Onboarding", href: "/employee-onboarding", icon: UserCheck, module: "Employee Onboarding" },
    ],
  },
  {
    label: "TRAINING",
    items: [
      { name: "Trainings", href: "/training", icon: GraduationCap, module: "Training" },
      { name: "Calendar", href: "/training/calendar", icon: CalendarDays, module: "Training" },
      { name: "Training history", href: "/training/history", icon: History, module: "Training" },
    ],
  },
];

/** The item a path belongs to: the longest href that is the path or a parent of it, so Calendar is not also Trainings. */
export function activeHref(pathname: string, sections: NavSection[]): string | undefined {
  return sections
    .flatMap((section) => section.items.map((item) => item.href))
    .filter((href) => pathname === href || pathname.startsWith(href + "/"))
    .sort((a, b) => b.length - a.length)[0];
}

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
