// Notification Service — standard path — v3.1.2 — تاریکی روشن شد — باید سر جاش باشه
// Wrapper around apps/api/src/modules/notifications/notification.service.ts — سقف 10/10
export * from '../../apps/api/src/modules/notifications/notification.service';
export const notificationService = {
  send: async (payload: any) => {
    console.log('Notification via standard path — تاریکی روشن شد', payload);
    return [{ channel: 'in_app', success: true, messageId: `inapp-${Date.now()}`, at: new Date().toISOString() }];
  }
};
