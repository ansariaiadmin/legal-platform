export const logger = {
  info: (obj: any, msg?: string) => console.log(`[INFO] ${msg || ''}`, obj),
  error: (obj: any, msg?: string) => console.error(`[ERROR] ${msg || ''}`, obj),
  warn: (obj: any, msg?: string) => console.warn(`[WARN] ${msg || ''}`, obj),
};
