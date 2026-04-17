'use client'

import { useState, useCallback } from 'react'
import { apiFetch } from '@/lib/http/api-client'
import { isAbortError, AUTH_TIMEOUT_MS, GENERIC_ERROR, SERVER_SLOW_ERROR } from '@/lib/http/fetch-with-timeout'

// Shared submit pattern for the onboarding / auth wizard pages. Every
// step's handler boils down to: clear error → loading on → fetch with
// timeout → parse body → branch on ok/!ok → loading off. The hook
// centralises that scaffold so:
//   - every page gets the same isAbortError translation
//   - every page gets the same generic-error fallback copy
//   - individual pages only write what's genuinely page-specific
//     (success nav, reason-based redirects)
export interface WizardResponse {
  error?: string
  reason?: string
  [key: string]: unknown
}

// `onFail` return semantics:
//   string  → display as the error banner copy (overrides data.error)
//   null    → suppress the error banner (used when a redirect handles recovery)
//   void    → display `data.error || GENERIC_ERROR`
export interface WizardSubmitConfig<TOk extends WizardResponse = WizardResponse> {
  endpoint: string
  method?: 'POST' | 'GET' | 'PUT' | 'DELETE'
  body?: unknown
  timeoutMs?: number
  onOk: (data: TOk) => void | Promise<void>
  onFail?: (
    data: WizardResponse,
    status: number,
  ) => string | null | void | Promise<string | null | void>
}

export function useWizardSubmit() {
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = useCallback(
    async <TOk extends WizardResponse = WizardResponse>(
      config: WizardSubmitConfig<TOk>,
    ): Promise<void> => {
      setError('')
      setLoading(true)
      try {
        const res = await apiFetch(config.endpoint, {
          method: config.method ?? 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: config.body === undefined ? undefined : JSON.stringify(config.body),
          timeoutMs: config.timeoutMs ?? AUTH_TIMEOUT_MS,
        })
        const data = (await res.json().catch(() => ({}))) as WizardResponse
        if (!res.ok) {
          const override = config.onFail
            ? await config.onFail(data, res.status)
            : undefined
          if (override === null) return // redirect handled; suppress banner
          setError(
            typeof override === 'string' ? override : data.error || GENERIC_ERROR,
          )
          return
        }
        await config.onOk(data as TOk)
      } catch (err) {
        setError(isAbortError(err) ? SERVER_SLOW_ERROR : GENERIC_ERROR)
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  return { submit, error, loading, setError }
}
