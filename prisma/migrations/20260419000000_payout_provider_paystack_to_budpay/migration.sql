-- Rename enum value PAYSTACK → BUDPAY.
--
-- Product decision (Apr 2026): BudPay replaces Paystack as the NGN
-- payout fallback; BudPay is now the primary disburser with
-- Flutterwave as fallback. Wave 1 is pre-production, so no real
-- transfer rows reference PAYSTACK. Dev DBs that have test rows
-- with payoutProvider='PAYSTACK' get them silently mapped to
-- 'BUDPAY' — the point of the rename is to preserve whatever dev
-- rows exist rather than dropping them.
--
-- Postgres RENAME VALUE is in-place DDL: no table scan, no downtime.

ALTER TYPE "PayoutProvider" RENAME VALUE 'PAYSTACK' TO 'BUDPAY';
