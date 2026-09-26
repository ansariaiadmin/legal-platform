import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from './metrics.service';

export interface AlertRule {
  name: string;
  condition: () => boolean;
  message: string;
  severity: 'critical' | 'warning' | 'info';
}

export interface Alert {
  rule: string;
  message: string;
  severity: 'critical' | 'warning' | 'info';
  timestamp: string;
  value?: number;
}

/**
 * Alerting service with Telegram and Slack integration.
 * Evaluates rules like: error rate >5% for 5min, DB failures, disk <10%, agent failures.
 */
@Injectable()
export class AlertingService {
  private readonly logger = new Logger(AlertingService.name);
  private alerts: Alert[] = [];
  private errorRateWindow: Array<{ timestamp: number; errorRate: number }> = [];
  private diskCheckCache: { freePercent: number; timestamp: number } | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly metrics: MetricsService,
  ) {}

  private getTelegramConfig(): { botToken: string; chatId: string } | null {
    const botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    const chatId = this.configService.get<string>('TELEGRAM_ALERT_CHAT_ID');
    if (!botToken || !chatId) return null;
    return { botToken, chatId };
  }

  private getSlackConfig(): { webhookUrl: string } | null {
    const webhookUrl = this.configService.get<string>('SLACK_WEBHOOK_URL');
    if (!webhookUrl) return null;
    return { webhookUrl };
  }

  async sendTelegramAlert(alert: Alert): Promise<void> {
    const config = this.getTelegramConfig();
    if (!config) {
      this.logger.debug('Telegram not configured, skipping');
      return;
    }

    const text = `*${alert.severity.toUpperCase()}*: ${alert.rule}\n${alert.message}\nTime: ${alert.timestamp}`;

    try {
      const response = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.chatId,
          text,
          parse_mode: 'Markdown',
        }),
      });

      if (!response.ok) {
        this.logger.warn(`Telegram alert failed: ${response.status}`);
      } else {
        this.logger.log(`Telegram alert sent: ${alert.rule}`);
      }
    } catch (error) {
      this.logger.error(`Telegram send error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async sendSlackAlert(alert: Alert): Promise<void> {
    const config = this.getSlackConfig();
    if (!config) {
      this.logger.debug('Slack not configured, skipping');
      return;
    }

    const payload = {
      text: `${alert.severity.toUpperCase()}: ${alert.rule}`,
      attachments: [
        {
          color: alert.severity === 'critical' ? 'danger' : alert.severity === 'warning' ? 'warning' : '#36a64f',
          fields: [
            { title: 'Rule', value: alert.rule, short: true },
            { title: 'Severity', value: alert.severity, short: true },
            { title: 'Message', value: alert.message, short: false },
            { title: 'Time', value: alert.timestamp, short: true },
          ],
        },
      ],
    };

    try {
      const response = await fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        this.logger.warn(`Slack alert failed: ${response.status}`);
      } else {
        this.logger.log(`Slack alert sent: ${alert.rule}`);
      }
    } catch (error) {
      this.logger.error(`Slack send error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async sendAlert(alert: Alert): Promise<void> {
    this.alerts.push(alert);
    // Keep last 100 alerts
    if (this.alerts.length > 100) {
      this.alerts = this.alerts.slice(-100);
    }

    this.logger.warn(`ALERT [${alert.severity}] ${alert.rule}: ${alert.message}`);

    // Send to both channels in parallel
    await Promise.allSettled([
      this.sendTelegramAlert(alert),
      this.sendSlackAlert(alert),
    ]);
  }

  // Check error rate >5% for 5 minutes
  checkHighErrorRate(): Alert | null {
    const stats = this.metrics.getStats();
    const errorRate = stats.http.errorRatePercent;

    const now = Date.now();
    this.errorRateWindow.push({ timestamp: now, errorRate });
    // Keep 5 minutes window
    this.errorRateWindow = this.errorRateWindow.filter(entry => now - entry.timestamp <= 5 * 60 * 1000);

    if (this.errorRateWindow.length < 2) return null;

    const avgErrorRate = this.errorRateWindow.reduce((sum, e) => sum + e.errorRate, 0) / this.errorRateWindow.length;

    if (avgErrorRate > 5 && stats.http.requestsTotal > 20) {
      return {
        rule: 'high_error_rate',
        message: `نرخ خطا بالا: ${avgErrorRate.toFixed(2)}% در 5 دقیقه گذشته (آستانه 5%)`,
        severity: 'critical',
        timestamp: new Date().toISOString(),
        value: avgErrorRate,
      };
    }

    return null;
  }

  checkDbFailures(): Alert | null {
    const stats = this.metrics.getStats();
    if (stats.db.failuresTotal > 5) {
      return {
        rule: 'db_connection_failures',
        message: `خطای اتصال دیتابیس: ${stats.db.failuresTotal} خطا ثبت شده`,
        severity: 'critical',
        timestamp: new Date().toISOString(),
        value: stats.db.failuresTotal,
      };
    }
    return null;
  }

  async checkDiskSpace(): Promise<Alert | null> {
    try {
      const { execSync } = await import('child_process');
      const output = execSync('df -h / | tail -1 | awk \'{print $5}\'').toString().trim();
      const usedPercent = parseInt(output.replace('%', ''), 10);
      const freePercent = 100 - usedPercent;

      this.diskCheckCache = { freePercent, timestamp: Date.now() };

      if (freePercent < 10) {
        return {
          rule: 'disk_space_low',
          message: `فضای دیسک کم: فقط ${freePercent}% باقی مانده (آستانه 10%)`,
          severity: 'critical',
          timestamp: new Date().toISOString(),
          value: freePercent,
        };
      } else if (freePercent < 20) {
        return {
          rule: 'disk_space_warning',
          message: `هشدار فضای دیسک: ${freePercent}% باقی مانده`,
          severity: 'warning',
          timestamp: new Date().toISOString(),
          value: freePercent,
        };
      }
    } catch {
      // Ignore disk check failures
    }
    return null;
  }

  checkAgentFailures(): Alert | null {
    const stats = this.metrics.getStats();
    if (stats.agents.failuresTotal > 10) {
      return {
        rule: 'agent_failures_high',
        message: `تعداد خطای دستیاران زیاد است: ${stats.agents.failuresTotal} خطا`,
        severity: 'warning',
        timestamp: new Date().toISOString(),
        value: stats.agents.failuresTotal,
      };
    }

    for (const [agentId, count] of Object.entries(stats.agents.failuresByAgent as Record<string, number>)) {
      if (count > 5) {
        return {
          rule: 'agent_specific_failures',
          message: `دستیار ${agentId} با ${count} خطا مواجه شده است`,
          severity: 'warning',
          timestamp: new Date().toISOString(),
          value: count,
        };
      }
    }

    return null;
  }

  async evaluateAll(): Promise<Alert[]> {
    const alerts: Alert[] = [];

    const errorRateAlert = this.checkHighErrorRate();
    if (errorRateAlert) alerts.push(errorRateAlert);

    const dbAlert = this.checkDbFailures();
    if (dbAlert) alerts.push(dbAlert);

    const diskAlert = await this.checkDiskSpace();
    if (diskAlert) alerts.push(diskAlert);

    const agentAlert = this.checkAgentFailures();
    if (agentAlert) alerts.push(agentAlert);

    for (const alert of alerts) {
      await this.sendAlert(alert);
    }

    return alerts;
  }

  getRecentAlerts(limit = 20): Alert[] {
    return this.alerts.slice(-limit).reverse();
  }

  getDiskStatus(): { freePercent: number; timestamp: number } | null {
    return this.diskCheckCache;
  }
}
