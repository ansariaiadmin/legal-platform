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

    // Wrap res.end so the final status code is recorded once the response is sent.
    res.end = ((...args: Parameters<Response['end']>) => {
      const duration = Date.now() - start;
      const route = req.route?.path || req.path || 'unknown';
      metrics.recordHttpRequest(req.method, route, res.statusCode, duration);
      return (originalEnd as (...a: Parameters<Response['end']>) => Response)(...args);
    }) as Response['end'];

    next();
  };
}
