import type { Request, Response, NextFunction } from 'express';
import { MetricsService } from '../modules/health/metrics.service';

/**
 * HTTP metrics middleware — records request duration, status, route for Prometheus.
 */
export function metricsMiddleware(metrics: MetricsService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = Date.now();

    // Skip metrics endpoint itself to avoid recursion
    if (req.path === '/api/metrics' || req.path === '/metrics') {
      return next();
    }

    const originalEnd = res.end.bind(res);

    // @ts-ignore — monkey patch end to capture status
    res.end = function (...args: any[]) {
      const duration = Date.now() - start;
      const route = req.route?.path || req.path || 'unknown';
      metrics.recordHttpRequest(req.method, route, res.statusCode, duration);
      return originalEnd(...args);
    } as any;

    next();
  };
}
