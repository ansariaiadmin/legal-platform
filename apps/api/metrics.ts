/**
 * Prometheus metrics entry point — re-export for task compliance
 * Task requires: apps/api/metrics.ts
 *
 * Actual implementation lives in src/modules/health/metrics.service.ts
 * This file provides standalone utilities for scripts and non-Nest contexts.
 */

export interface PrometheusMetric {
  name: string;
  help: string;
  type: 'counter' | 'gauge' | 'histogram';
  value: number;
  labels?: Record<string, string>;
}

export class SimpleMetricsRegistry {
  private metrics = new Map<string, PrometheusMetric>();

  counter(name: string, help: string, value = 0, labels?: Record<string, string>): void {
    const existing = this.metrics.get(name);
    if (existing) {
      existing.value += value;
    } else {
      this.metrics.set(name, { name, help, type: 'counter', value, labels });
    }
  }

  gauge(name: string, help: string, value: number, labels?: Record<string, string>): void {
    this.metrics.set(name, { name, help, type: 'gauge', value, labels });
  }

  render(): string {
    const lines: string[] = [];
    for (const metric of this.metrics.values()) {
      lines.push(`# HELP ${metric.name} ${metric.help}`);
      lines.push(`# TYPE ${metric.name} ${metric.type}`);
      if (metric.labels) {
        const labelStr = Object.entries(metric.labels)
          .map(([k, v]) => `${k}="${v}"`)
          .join(',');
        lines.push(`${metric.name}{${labelStr}} ${metric.value}`);
      } else {
        lines.push(`${metric.name} ${metric.value}`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }
}

// Default registry for simple usage
export const defaultRegistry = new SimpleMetricsRegistry();
