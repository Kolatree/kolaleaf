'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/http/api-client'
import { colors, radius } from '@/components/design/KolaPrimitives'

const SUMSUB_SCRIPT_ID = 'sumsub-websdk-builder'
const SUMSUB_SCRIPT_SRC = 'https://static.sumsub.com/idensic/static/sns-websdk-builder.js'

interface SumsubWebSdkInstance {
  launch(selector: string): void
}

interface SumsubWebSdkChain {
  withConf(config: Record<string, unknown>): SumsubWebSdkChain
  withOptions(options: Record<string, unknown>): SumsubWebSdkChain
  on(event: string, handler: (payload: unknown) => void): SumsubWebSdkChain
  onMessage(handler: (type: string, payload: unknown) => void): SumsubWebSdkChain
  build(): SumsubWebSdkInstance
}

interface SumsubWebSdkBuilder {
  init(accessToken: string, expirationHandler: () => Promise<string>): SumsubWebSdkChain
}

declare global {
  interface Window {
    snsWebSdk?: SumsubWebSdkBuilder
  }
}

function loadSumsubScript(): Promise<void> {
  if (window.snsWebSdk) return Promise.resolve()

  const existing = document.getElementById(SUMSUB_SCRIPT_ID)
  if (existing) {
    if (existing.getAttribute('data-loaded') === 'true') return Promise.resolve()
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Sumsub WebSDK failed to load')), {
        once: true,
      })
    })
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.id = SUMSUB_SCRIPT_ID
    script.src = SUMSUB_SCRIPT_SRC
    script.async = true
    script.onload = () => {
      script.setAttribute('data-loaded', 'true')
      resolve()
    }
    script.onerror = () => reject(new Error('Sumsub WebSDK failed to load'))
    document.head.appendChild(script)
  })
}

async function fetchFreshToken(): Promise<string> {
  const res = await apiFetch('kyc/access-token', { method: 'POST' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || typeof data.accessToken !== 'string') {
    throw new Error('Unable to refresh Sumsub access token')
  }
  return data.accessToken
}

export function SumsubWebSdk({
  accessToken,
  onSubmitted,
}: {
  accessToken: string
  onSubmitted: () => void
}) {
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const container = document.getElementById('sumsub-websdk-container')
    if (container) container.innerHTML = ''

    async function launch() {
      try {
        setError('')
        await loadSumsubScript()
        if (cancelled) return

        const sdk = window.snsWebSdk
        if (!sdk) throw new Error('Sumsub WebSDK is unavailable')

        const instance = sdk
          .init(accessToken, fetchFreshToken)
          .withConf({ lang: 'en', theme: 'light' })
          .withOptions({ addViewportTag: false, adaptIframeHeight: true })
          .on('idCheck.onApplicantSubmitted', onSubmitted)
          .on('idCheck.onApplicantStatusChanged', onSubmitted)
          .on('idCheck.onError', (payload) => {
            console.error('Sumsub WebSDK error', payload)
          })
          .onMessage((type) => {
            if (
              type === 'idCheck.onApplicantSubmitted' ||
              type === 'idCheck.onApplicantStatusChanged'
            ) {
              onSubmitted()
            }
          })
          .build()

        instance.launch('#sumsub-websdk-container')
      } catch {
        if (!cancelled) {
          setError('Unable to load identity verification. Please refresh and try again.')
        }
      }
    }

    launch()

    return () => {
      cancelled = true
      const activeContainer = document.getElementById('sumsub-websdk-container')
      if (activeContainer) activeContainer.innerHTML = ''
    }
  }, [accessToken, onSubmitted])

  return (
    <div>
      {error && (
        <div
          role="alert"
          style={{
            background: '#fef1f2',
            color: '#b00020',
            fontSize: '13px',
            padding: '10px 12px',
            borderRadius: '8px',
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}
      <div
        id="sumsub-websdk-container"
        style={{
          minHeight: 560,
          background: colors.cardBg,
          borderRadius: radius.card,
          overflow: 'hidden',
        }}
      />
    </div>
  )
}
