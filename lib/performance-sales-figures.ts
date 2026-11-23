import { SALES_NO_ORDERS_WARNING_DAYS, type SalesInput } from "./performance-sales-scoring";

/**
 * The figures behind the sales KPI's result, shown on the Employee's evaluation and saved with a submission (so a submitted Evaluation shows
 * the figures it was scored on, whatever is imported or linked later). Pure: no database, no clock.
 */
export type SalesFigures = { netSales: number; orders: number; presentDays: number; target: number };

/** The figures to show, or null when there are none to show: the sales KPI is not in the set, or it has no figures (not linked, no import, no target). */
export function salesFigures(input: SalesInput | undefined, presentDays: number): SalesFigures | null {
  return input?.status === "ready" ? { netSales: input.netSales, orders: input.orders ?? 0, presentDays, target: input.target } : null;
}

/**
 * A cashier with many present days and no POS orders at all is shown a warning, so a wrong link is noticed: a real cashier sells something over
 * {@link SALES_NO_ORDERS_WARNING_DAYS} days, an account linked to the wrong Employee does not. The result is still scored (0); the warning only points at the link.
 */
export function noOrdersWarning(figures: SalesFigures | null): string | null {
  return figures && figures.orders === 0 && figures.presentDays >= SALES_NO_ORDERS_WARNING_DAYS
    ? `No POS orders in ${figures.presentDays} present days. Check that the right POS account is linked.` : null;
}
