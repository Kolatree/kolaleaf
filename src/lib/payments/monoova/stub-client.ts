import type {
  MonoovaClient,
  CreatePayIdParams,
  CreatePayIdResult,
  PaymentStatusResult,
} from './client'

/**
 * Zero-network stub for the Monoova `MonoovaClient` interface. Activated
 * when `KOLA_USE_STUB_PROVIDERS=true` (or, in non-production environments,
 * when real Monoova creds are absent). Returns deterministic fake PayID
 * references so the CREATED → AWAITING_AUD transition can be exercised
 * end-to-end without hitting Monoova's sandbox.
 *
 * Every synthetic ref is prefixed with `STUB-` so a stub-mode transfer
 * is trivially greppable if one ever leaks to production data.
 *
 * Not intended for production use. `assertStubProvidersSafe()` (in the
 * factory) guards against that.
 */

const STUB_PAYID = 'stub@payid.kolaleaf.dev'

export class StubMonoovaClient implements MonoovaClient {
  async createPayId(params: CreatePayIdParams): Promise<CreatePayIdResult> {
    return {
      payId: STUB_PAYID,
      payIdReference: `STUB-${params.reference}`,
    }
  }

  async getPaymentStatus(
    _payIdReference: string,
  ): Promise<PaymentStatusResult> {
    return {
      status: 'completed',
      amount: 0,
      receivedAt: new Date(),
    }
  }
}
