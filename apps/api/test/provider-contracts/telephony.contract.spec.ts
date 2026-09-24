import { MockTelephonyAdapter } from '../../src/providers/telephony/mock-telephony.adapter';

/** TelephonyProvider contract (SPEC section 8). */
describe('TelephonyProvider contract', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });

  afterAll(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('initiates an outbound call and returns a call id', async () => {
    const adapter = new MockTelephonyAdapter();

    const session = await adapter.createOutboundCall({ toNumber: '+989123456789' });

    expect(session.callId).toEqual(expect.any(String));
    expect(session.status).toBe('initiated');
    expect(session.toNumber).toBe('+989123456789');
  });

  it('normalises an inbound webhook into a typed event', async () => {
    const adapter = new MockTelephonyAdapter();

    const event = await adapter.handleInboundWebhook({
      CallSid: 'call-abc',
      From: '+989120000000',
      To: '+982100000000',
      CallStatus: 'missed',
    });

    expect(event.callId).toBe('call-abc');
    expect(event.direction).toBe('inbound');
    expect(event.status).toBe('missed');
  });

  it('maps an unknown gateway status to ringing rather than throwing', async () => {
    const adapter = new MockTelephonyAdapter();

    const event = await adapter.handleInboundWebhook({ CallStatus: 'some-new-state' });
    expect(event.status).toBe('ringing');
  });

  it('reports healthy outside production only', async () => {
    const adapter = new MockTelephonyAdapter();
    expect((await adapter.verifyConfig()).valid).toBe(true);

    process.env.NODE_ENV = 'production';
    expect((await adapter.verifyConfig()).valid).toBe(false);
  });
});
