/** Must match the gateway Caller's app: Live tickets subscribe to this case-sensitive channel. */
export const notificationsApp = () => process.env.NOTIFICATIONS_APP ?? "hrms";
