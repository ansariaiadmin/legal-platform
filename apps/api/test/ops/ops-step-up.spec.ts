import { Reflector } from '@nestjs/core';
import { OpsController } from '../../src/modules/ops/ops.controller';
import { AREA_LOCK_KEY } from '../../src/modules/authvault/area-lock.guard';

/**
 * FIELD REVIEW 2026-09-05 #6 (step-up subset): the mortal verbs — export
 * every secret / import a whole office back — must carry the ops area lock
 * metadata, so when the office enabled the ops lock these endpoints demand
 * the second-factor ticket instead of trusting a stolen session JWT.
 * This spec guards the GUARD WIRING (metadata presence), while
 * authvault tests prove the guard's logic.
 */
describe('ops surface step-up wiring', () => {
  const reflector = new Reflector();

  it('backup export requires the ops area ticket', () => {
    const area = reflector.get(AREA_LOCK_KEY, OpsController.prototype.download);
    expect(area).toBe('ops');
  });

  it('backup restore requires the ops area ticket', () => {
    const area = reflector.get(AREA_LOCK_KEY, OpsController.prototype.restore);
    expect(area).toBe('ops');
  });

  it('read-only deployment readout stays ticket-free (not every verb is mortal)', () => {
    const area = reflector.get(AREA_LOCK_KEY, OpsController.prototype.deployment);
    expect(area).toBeUndefined();
  });
});
