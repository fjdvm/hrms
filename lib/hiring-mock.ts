/**
 * Static sample data for the Offers and Hired screens.
 * These screens are UI only for now; nothing here is read from or written to the database.
 */

export type OfferStatus = "Draft" | "Sent" | "Accepted" | "Declined";

export type OfferRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  salary: string;
  startDate: string;
  sent: string | null;
  replyBy: string | null;
  status: OfferStatus;
};

export const OFFERS: OfferRow[] = [
  { id: "rafael-santiago", name: "Rafael Santiago", email: "raf.santiago@gmail.com", role: "Delivery Coordinator", salary: "₱19,000", startDate: "3 Nov 2026", sent: "20 Oct 2026", replyBy: "27 Oct 2026", status: "Sent" },
  { id: "ellaine-torres", name: "Ellaine Torres", email: "ellaine.torres@gmail.com", role: "Branch Cashier", salary: "₱15,500", startDate: "10 Nov 2026", sent: "22 Oct 2026", replyBy: "29 Oct 2026", status: "Sent" },
  { id: "noel-bautista", name: "Noel Bautista", email: "noel.bautista@gmail.com", role: "Production Staff", salary: "₱16,500", startDate: "10 Nov 2026", sent: "24 Oct 2026", replyBy: "31 Oct 2026", status: "Sent" },
  { id: "bryan-castillo", name: "Bryan Castillo", email: "bryan.castillo@gmail.com", role: "Production Staff", salary: "₱16,000", startDate: "17 Nov 2026", sent: null, replyBy: null, status: "Draft" },
  { id: "angelica-ramos", name: "Angelica Ramos", email: "angelica.ramos@gmail.com", role: "Quality Control Inspector", salary: "₱21,000", startDate: "3 Nov 2026", sent: "16 Oct 2026", replyBy: "23 Oct 2026", status: "Accepted" },
  { id: "jasmine-reyes", name: "Jasmine Reyes", email: "jas.reyes@gmail.com", role: "Branch Cashier", salary: "₱15,000", startDate: "27 Oct 2026", sent: "12 Oct 2026", replyBy: "19 Oct 2026", status: "Declined" },
];

export const OFFER_TABS = [
  { label: "All", count: 15 },
  { label: "Draft", count: 1 },
  { label: "Sent", count: 3 },
  { label: "Accepted", count: 10 },
  { label: "Declined", count: 1 },
];

export type PreEmploymentDoc = { name: string; hint: string; fromApplication?: boolean };

export const PRE_EMPLOYMENT_DOCS: PreEmploymentDoc[] = [
  { name: "Resume", hint: "From application", fromApplication: true },
  { name: "Valid government ID", hint: "From application", fromApplication: true },
  { name: "NBI clearance", hint: "Not older than 6 months" },
  { name: "Health certificate", hint: "From the city health office" },
  { name: "SSS number", hint: "E-1 form or SSS ID" },
  { name: "PhilHealth number", hint: "MDR or PhilHealth ID" },
  { name: "Pag-IBIG MID and TIN", hint: "For payroll deductions and tax" },
];

export type Employee = {
  name: string;
  email: string;
  employeeId: string;
  position: string;
  department: string;
  branch: string;
  startDate: string;
  status: "Onboarding" | "Active";
};

export const EMPLOYEES: Employee[] = [
  { name: "Ellaine Torres", email: "ellaine.torres@gmail.com", employeeId: "BR-EMP-0058", position: "Branch Cashier", department: "Branches", branch: "Cainta branch", startDate: "10 Nov 2026", status: "Onboarding" },
  { name: "Rafael Santiago", email: "raf.santiago@gmail.com", employeeId: "BR-EMP-0057", position: "Delivery Coordinator", department: "Distribution", branch: "Main kitchen", startDate: "3 Nov 2026", status: "Onboarding" },
  { name: "Angelica Ramos", email: "angelica.ramos@gmail.com", employeeId: "BR-EMP-0056", position: "Quality Control Inspector", department: "Production", branch: "Main kitchen", startDate: "3 Nov 2026", status: "Onboarding" },
  { name: "Noel Garcia", email: "noel.garcia@gmail.com", employeeId: "BR-EMP-0055", position: "Production Staff", department: "Production", branch: "Main kitchen", startDate: "6 Oct 2026", status: "Active" },
  { name: "Liza Bautista", email: "liza.bautista@brenraphaels.ph", employeeId: "BR-EMP-0031", position: "Production Head", department: "Production", branch: "Main kitchen", startDate: "2 Feb 2024", status: "Active" },
  { name: "Paolo Garcia", email: "paolo.garcia@brenraphaels.ph", employeeId: "BR-EMP-0024", position: "Branch Head", department: "Branches", branch: "Cainta branch", startDate: "15 Aug 2023", status: "Active" },
  { name: "Carlo Mendoza", email: "carlo.mendoza@brenraphaels.ph", employeeId: "BR-EMP-0019", position: "Delivery Lead", department: "Distribution", branch: "Main kitchen", startDate: "4 Jan 2023", status: "Active" },
];

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
