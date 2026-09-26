import { ExpertRegistry } from '../../src/modules/orchestrator/expert-registry';
import { AgentsBootstrap } from '../../src/modules/orchestrator/agents.bootstrap';
import { civilExpert } from '@legal-platform/agent-civil-expert';
import { criminalExpert } from '@legal-platform/agent-criminal-expert';
import { familyExpert } from '@legal-platform/agent-family-expert';
import { registrationExpert } from '@legal-platform/agent-registration-expert';

/**
 * Agent Fleet Integration Tests — 4 tests for real agents
 * Task: at least 2 real agents work, integration test, 4 tests
 */

describe('Agent Fleet Integration — Real Agents', () => {
  it('civil expert is real (not mock) and provides contract analysis', async () => {
    const result = await civilExpert.executeExpert({
      taskId: 'integration-civil-1',
      query: 'قرارداد اجاره آپارتمان مسکونی با مبلغ ۲۰ میلیون تومان ودیعه و ماهی ۵ میلیون اجاره، مدت یک سال',
    });

    expect(result.ok).toBe(true);
    expect(result.output).toContain('تحلیل قرارداد');
    expect(result.output).not.toContain('این پاسخ مولدنشده است');
    expect(result.citations).toBeDefined();
    expect(result.citations!.length).toBeGreaterThan(0);
    expect(result.meta?.requiresReview).toBe(true);
    expect(result.meta?.field).toBe('civil');
  });

  it('criminal expert is real (not mock) and provides crime analysis', async () => {
    const result = await criminalExpert.executeExpert({
      taskId: 'integration-criminal-1',
      query: 'اتهام کلاهبرداری ۵۰۰ میلیون تومانی و مجازات آن',
    });

    expect(result.ok).toBe(true);
    expect(result.output).toContain('کلاهبرداری');
    expect(result.output).toContain('مجازات');
    expect(result.output).not.toContain('این پاسخ مولدنشده است');
    expect(result.citations).toBeDefined();
    expect(result.citations!.length).toBeGreaterThan(0);
    expect(result.meta?.requiresReview).toBe(true);
    expect(result.meta?.field).toBe('criminal');
  });

  it('agent routing works for civil and criminal queries', async () => {
    const civilRoute = await civilExpert.route({ query: 'فسخ قرارداد اجاره به دلیل عدم پرداخت اجاره بها' });
    expect(civilRoute?.skillId).toBe('civil:contracts');
    expect(civilRoute!.score).toBeGreaterThanOrEqual(0.4);

    const criminalRoute = await criminalExpert.route({ query: 'قرار بازداشت موقت در دادسرا' });
    expect(criminalRoute?.skillId).toBe('crim:procedure');
    expect(criminalRoute!.score).toBeGreaterThanOrEqual(0.4);
  });

  it('fleet health checks all pass', async () => {
    const agents = [civilExpert, criminalExpert, familyExpert, registrationExpert];

    for (const agent of agents) {
      const health = await agent.health();
      expect(health.healthy).toBe(true);
      expect(agent.agentId).toBeDefined();
      expect(agent.field).toBeDefined();
      expect(agent.capabilities().length).toBeGreaterThan(0);
    }
  });

  it('civil expert handles property and inheritance queries', async () => {
    const propertyResult = await civilExpert.executeExpert({
      taskId: 'integration-civil-prop',
      query: 'خرید ملک و بررسی سند و استعلامات لازم',
    });

    expect(propertyResult.ok).toBe(true);
    expect(propertyResult.output).toContain('ملک');

    const inheritanceResult = await civilExpert.executeExpert({
      taskId: 'integration-civil-inherit',
      query: 'تقسیم ارث و سهم الارث دختر و پسر',
    });

    expect(inheritanceResult.ok).toBe(true);
    expect(inheritanceResult.output).toContain('ارث');
  });

  it('criminal expert handles procedure and sentencing', async () => {
    const procedureResult = await criminalExpert.executeExpert({
      taskId: 'integration-crim-proc',
      query: 'مراحل دادرسی کیفری از دادسرا تا دادگاه',
    });

    expect(procedureResult.ok).toBe(true);
    expect(procedureResult.output).toContain('دادرسی کیفری');

    const sentencingResult = await criminalExpert.executeExpert({
      taskId: 'integration-crim-sent',
      query: 'تخفیف مجازات و شرایط تعلیق اجرای مجازات',
    });

    expect(sentencingResult.ok).toBe(true);
    expect(sentencingResult.output).toContain('تخفیف');
  });
});

describe('Agent Fleet — production roster', () => {
  it('registers the five field experts and never the reference template', () => {
    const registry = new ExpertRegistry();
    new AgentsBootstrap(registry).onModuleInit();
    const ids = registry.list().map((a) => a.agentId).sort();
    expect(ids).toEqual([
      'civil-expert',
      'criminal-expert',
      'family-expert',
      'international-expert',
      'registration-expert',
    ]);
  });

  it('at least 2 real agents work (civil and criminal)', async () => {
    const civilHealth = await civilExpert.health();
    const criminalHealth = await criminalExpert.health();

    expect(civilHealth.healthy).toBe(true);
    expect(criminalHealth.healthy).toBe(true);

    const civilResult = await civilExpert.executeExpert({
      taskId: 'real-check-civil',
      query: 'قرارداد مشارکت در ساخت',
    });
    const criminalResult = await criminalExpert.executeExpert({
      taskId: 'real-check-criminal',
      query: 'جرم خیانت در امانت',
    });

    // Real agents should have grounded citations
    expect(civilResult.meta?.grounded).toBe(true);
    expect(criminalResult.meta?.grounded).toBe(true);
  });
});
