# U76f — User-Facing String Audit Notes (Pre-AUSTRAC Review)

Last updated: 2026-05-14
Source: `ios/Kolaleaf/Features/` and `ios/Kolaleaf/Resources/Localizable.xcstrings`

## How to use this doc

Each entry below is a string the engineering team flagged for a likely
compliance question. The compliance officer should:

1. **Accept** — the wording is fine as-is (annotate "accepted").
2. **Rewrite** — provide an alternative (engineering applies it in a
   follow-up commit).
3. **Defer** — flag for legal review.

After officer review, applying changes is a one-line edit per string in
the source file or the `.xcstrings` catalog. The flagged file paths and
line numbers reflect the tree at the time of this audit; if line numbers
have drifted by review time, grep for the exact source string.

> **Note on the catalog file.** `ios/Kolaleaf/Resources/Localizable.xcstrings`
> is currently an empty shell — Xcode populates the entries from the 121
> `String(localized:)` wrappings and the `Text("…")` literals on the next
> build. The strings in this audit are therefore listed by their **source
> location** (`.swift` file + line) rather than by catalog key. After the
> first build that populates the catalog, every flagged string will also
> exist in `Localizable.xcstrings` under the keys called out below where
> the source uses an explicit `localized:` identifier.

---

## Priority items — please review first

These are the load-bearing claims the engineering team thinks are most
likely to attract regulator attention. They sit on screens every user
sees, and several make either a regulatory-status claim or a speed claim.

- **S-201 / S-202** — Welcome trust strip ("Licensed AU money transmitter"
  and "AUSTRAC RG 105"). First-impression regulatory signal; needs to be
  exactly the wording legal is comfortable defending.
- **S-001** — `EmptySendView` "in seconds" tagline (only true-speed
  claim left in the live copy).
- **S-101** — Welcome subtitle "quickly, securely, and affordably"
  (triple-claim about speed, security, and price).
- **S-401 / S-402 / S-403** — KYC intro screen tells the user verification
  is "AUSTRAC requires this" and is "required by Australian law for every
  transfer". The framing is regulatory-legal and should be reviewed for
  precision.
- **S-301** — Receipt "Best available rate" placeholder. Currently static
  copy not derived from a real bank-rate delta.

---

## Flagged strings

### Speed / timing claims

#### S-001: `ios/Kolaleaf/Features/Send/EmptySendView.swift:60` — `"Add a recipient to send Naira home in seconds."`

- **Why flagged:** "in seconds" is a speed promise. End-to-end NGN
  settlement depends on Monoova PayID arrival + Flutterwave payout, both
  of which can fail / retry / fall back to Paystack. The state machine
  even has `FLOAT_INSUFFICIENT`, `NGN_FAILED`, and `NEEDS_MANUAL` states.
  A reasonable user reading "in seconds" would not anticipate a 24-hour
  hold or manual review.
- **Suggested rewrite:** "Add a recipient to send Naira home." (drop the
  speed claim entirely) or "Add a recipient to start your first
  transfer." **Accept this**

#### S-002: `ios/Kolaleaf/Features/KYC/KYCIntroView.swift:86` — `"AUSTRAC requires this for every Australian remittance customer. It takes about 3 minutes."`

- **Why flagged:** "It takes about 3 minutes" is an expectation-setting
  claim. Sumsub flows can stall on document upload / liveness check /
  manual review. Officer should confirm whether the time estimate is
  defensible or should be softer.
- **Suggested rewrite:** "It usually takes a few minutes." or drop the
  duration sentence. **Accept**

#### S-003: `ios/Kolaleaf/Features/KYC/KYCProcessingView.swift:89` — `"This usually takes 30 seconds."`

- **Why flagged:** Same shape as S-002 — narrower window, more aggressive
  promise. The polling fallback can take materially longer (the VM
  surfaces "Pausing for Xs" rate-limit messages).
- **Suggested rewrite:** "We're checking your documents now. It usually takes a few minutes and we will write you if any issue. " (drop the
  duration). **Accept**

#### S-004: `ios/Kolaleaf/Features/KYC/KYCUnderReviewView.swift:74` — `"Under 24 hours"`

- **Why flagged:** Posted as a "Typical wait" claim on the under-review
  screen. AUSTRAC-triggered manual reviews can exceed 24h. Officer should
  decide if this is a soft norm or a commitment.
- **Suggested rewrite:** "Most are reviewed within 24 hours." **Accept**

---

### Guarantee / absolute claims

#### S-101: `ios/Kolaleaf/Features/Onboarding/WelcomeView.swift:103` — `"Kolaleaf helps Africans abroad support loved ones quickly, securely, and affordably."`

- **Why flagged:** Triple claim. "quickly" is a speed claim, "securely"
  is a security guarantee, "affordably" is a price claim. Each individual
  word is mild, but in combination they form an aggregate promise.
  Compliance officer should confirm comfort with each leg.
- **Suggested rewrite:** "Kolaleaf helps Africans abroad support loved
  ones across borders." (drop all three adverbs) or keep one if defensible. Keep.

#### S-102: `ios/Kolaleaf/Features/Onboarding/WelcomeView.swift:94` — `"Send money home with\ntrust, care, and confidence."`

- **Why flagged:** "trust" framed as a product attribute the user gets,
  not as a brand value. Lighter weight than S-101 but worth a look.
- **Suggested rewrite:** "Send money home with care." **Accept**

#### S-103: `ios/Kolaleaf/Features/Send/TransferStateLabels.swift:35` — `"We've reserved your rate."` keep this. 

- **Why flagged:** "Reserved" sounds like a firm commitment for a fixed
  amount of time. The transfer expires at 24h (see S-501 below) but the
  word "reserved" without a duration could imply something stronger.
- **Suggested rewrite:** "Your rate is held for 24 hours." 

#### S-104: `ios/Kolaleaf/Features/Send/ReceiptViewModel.swift:93` — `"Money's home"` (headline on COMPLETED receipt)

- **Why flagged:** Strong "delivered" claim. Engineering confirms it only
  fires on `TransferStatus.completed`, but the recipient bank may still
  hold the money briefly after `COMPLETED` settles. Officer should
  confirm "home" reads as "delivered" and is acceptable.
- **Suggested rewrite:** "Transfer complete". Use this

#### S-105: `ios/Kolaleaf/Features/Send/TransferStateLabels.swift:45` — `"Your recipient has the money."`

- **Why flagged:** Same risk class as S-104. Stated as a fact on the
  `.completed` row even if the recipient bank hasn't fully credited the
  account.
- **Suggested rewrite:** "We've paid out to your recipient's bank." use this

---

### Treasury / float exposure

#### S-201: `ios/Kolaleaf/Features/Onboarding/WelcomeView.swift:159` — `"Licensed AU money transmitter"`

- **Why flagged:** Regulatory status statement on the first screen any
  user sees. The wording needs to be exactly what legal is comfortable
  defending; "licensed" is a stronger term than "registered" (AUSTRAC
  registers, not licences). The README/CLAUDE.md correctly calls Kolaleaf
  "AUSTRAC-registered", so the trust strip currently says something
  stronger than the rest of the codebase.
- **Suggested rewrite:** "AUSTRAC-registered remittance provider" use this

#### S-202: `ios/Kolaleaf/Features/Onboarding/WelcomeView.swift:163` — `"AUSTRAC RG 105"` - Use "Austrac Registered".

- **Why flagged:** AUSTRAC issues a _registration number_ (or AUS RA
  number) to remitters; "RG 105" is the AUSTRAC _Remittance Sector
  Register_ identifier convention. Officer must confirm:
  (a) RG 105 is in fact Kolaleaf's correct register reference,
  (b) the way it's labelled here is the form AUSTRAC asks regulated
  entities to publish, and
  (c) no additional qualifier is required (e.g., "Kolaleaf Pty Ltd,
  AUSTRAC remittance reg. RG 105").
  Engineering does not have authoritative source for this number — it
  was carried through from the design wireframe.
- **Suggested rewrite:** Defer to officer + legal. The accessibility
  label at WelcomeView.swift:169 mirrors the same string and must change
  in lockstep.

#### S-203: `ios/Kolaleaf/Features/Onboarding/WelcomeView.swift:169` — accessibility label: `"Licensed Australian money transmitter, AUSTRAC reference RG 105"`

- **Why flagged:** Screen-reader version of S-201 + S-202. Must match
  whatever wording the officer approves above.
- **Suggested rewrite:** Mirror the resolved S-201/S-202 wording. use: Registerd Australian money transmitter

#### S-204: `ios/Kolaleaf/Features/Send/PayIDInstructionsView.swift:73` — `"Push your AUD"`

- **Why flagged:** "Push" is the bank-API verb for PayID transfers and
  is industry-standard, but a non-technical user could read it as "give
  us your funds" framing. Marginal; officer's call.
- **Suggested rewrite:**  "Send your AUD". use this. 

#### S-205: `ios/Kolaleaf/Features/Send/PayIDInstructionsView.swift:77` — `"Open your bank's app and send to this PayID. We'll handle the rest once funds arrive."`

- **Why flagged:** "We'll handle the rest" is a soft commitment. Defensible
  but worth confirming. (Engineering note: the float-paused / NGN-retry
  paths can intervene between AUD arrival and NGN settlement, so "the
  rest" is not always automatic in the user's lifetime view.)
- **Suggested rewrite:** "Once we receive it, we'll start your transfer." use this.

#### S-206: `ios/Kolaleaf/Features/FailurePaths/FloatPausedView.swift:80` — `"We're holding briefly while we top up."`

- **Why flagged:** "Top up" is treasury reasoning leaking to the user.
  The file's own header (`FloatPausedView.swift:6-7`) explicitly forbids
  the words "float", "treasury", "liquidity", "insufficient", "balance"
  — but "top up" is treasury operations vocabulary even if it doesn't
  hit the forbidden list. Officer should confirm: is "top up" acceptable
  user-facing language, or should this become "while we get things
  ready"?
- **Suggested rewrite:** "We're holding briefly while we get things
  ready." use this

#### S-207: `ios/Kolaleaf/Features/FailurePaths/FloatPausedView.swift:83` — `"Your transfer will continue automatically."`

- **Why flagged:** Stated as a guarantee. The float-pause auto-resume
  branch can fail (the VM has an "Estimated time to resume" + "Still
  holding" fallback at lines 133–145), so "will continue automatically"
  may overpromise.
- **Suggested rewrite:** "We'll resume your transfer as soon as we can." use this

#### S-208: `ios/Kolaleaf/Features/FailurePaths/FloatPausedView.swift:140` — `"Still holding"`

- **Why flagged:** Pairs with S-207. Once the ETA elapses, copy flips to
  "Still holding" — fine, but worth officer sign-off as a connected pair
  with S-206/S-207.
- **Suggested rewrite:** Accept. okay

#### S-209: `ios/Kolaleaf/Features/Send/PayIDInstructionsView.swift:73` (header context) and `ios/Kolaleaf/Features/Send/TransferStateLabels.swift:39` — `"Your funds are with us."`

- **Why flagged:** Subtitle on `AUD_RECEIVED`. "With us" is fine but
  loosely implies custody; AUSTRAC's settlement-account view of this
  step may have a preferred phrasing.
- **Suggested rewrite:** "We've received your AUD." use this

---

### KYC / verification copy

#### S-301: `ios/Kolaleaf/Features/Send/ReceiptViewModel.swift:109` — `"Best available rate"`

- **Why flagged:** Receipt summary line. Engineering comment at
  ReceiptViewModel.swift:103-105 confirms this is **static placeholder
  copy**, not derived from a real saved-vs-bank-rate calculation. AUSTRAC
  - ACCC would treat "best available rate" as an unsubstantiated
    superlative claim. This is engineering's highest-confidence rewrite
    candidate.
- **Suggested rewrite:** "Today's exchange rate" use this

#### S-302: `ios/Kolaleaf/Features/PostKYC/ConfirmProfileView.swift:63` — `"Legal name (verified)"`

- **Why flagged:** "Verified" is a strong factual claim. The name is
  pre-populated from the Sumsub KYC return, but the user may have
  rejected/edited it earlier. Officer should confirm "verified" is the
  right framing for the _legal_ name shown here (read-only).
- **Suggested rewrite:** "From your verified ID". use this

#### S-303: `ios/Kolaleaf/Features/PostKYC/ConfirmAddressView.swift:60` — `"AUSTRAC requires us to keep your residential address current."`

- **Why flagged:** Direct AUSTRAC reference + statement of customer
  obligation. Officer should confirm the wording matches what AML/CTF
  Rules require — the rule applies to the _reporting entity_, not
  directly to the customer.
- **Suggested rewrite:** "We need to keep your residential address up to
  date so we can comply with AUSTRAC rules." use this

#### S-304: `ios/Kolaleaf/Features/PostKYC/ConfirmAddressView.swift:78` — `"I still live at this address"`

- **Why flagged:** Toggle label. The act of toggling this constitutes a
  customer attestation. Officer should confirm wording is sufficient for
  audit-trail purposes (`transfer_events` / equivalent will record the
  attestation).
- **Suggested rewrite:** Accept, or "I confirm this is still my
  residential address." use this

#### S-305: `ios/Kolaleaf/Features/KYC/KYCIntroView.swift:152` — `"Kolaleaf is registered with AUSTRAC as a money-transfer business. Verifying your identity is required by Australian law for every transfer. Your documents are processed our third party regulated identity provider."` use this

- **Why flagged:** Most-load-bearing single sentence in the app. Three
  legal/regulatory claims in one paragraph:
  (1) "registered with AUSTRAC as a money-transfer business" — needs
  exact-form sign-off,
  (2) "required by Australian law for every transfer" — AUSTRAC's
  Customer Identification Procedures apply with threshold-based
  nuance; "every transfer" framing is engineering's interpretation,
  (3) "Sumsub, our regulated identity provider" — confirm Sumsub's
  regulatory status here is accurately stated for the jurisdiction.
- **Suggested rewrite:** Defer entirely to officer + legal. This is the
  paragraph that should be word-for-word approved.

#### S-306: `ios/Kolaleaf/Features/Onboarding/RegistrationDetailsView.swift:70` — `"A few details so we can comply with AUSTRAC."`

- **Why flagged:** Same shape as S-303. "Comply with AUSTRAC" is a soft
  paraphrase. Officer should confirm framing.
- **Suggested rewrite:** "A few details so we can verify your identity
  under Australian law." use this. 

---

### Customer obligation precision

#### S-401: `ios/Kolaleaf/Features/Onboarding/EmailEntryView.swift:106` — `"I agree to receive transactional emails about my transfers (required for compliance)."` use this

- **Why flagged:** Consent checkbox. Officer should confirm:
  (a) "transactional emails" is the right scope wording,
  (b) "required for compliance" is sufficient justification for the
  opt-in being mandatory rather than optional,
  (c) Whether AUSTRAC / SPAM Act considers this a valid express consent.
- **Suggested rewrite:** Defer to legal — the wording is fine but
  needs sign-off.

#### S-402: `ios/Kolaleaf/Features/Onboarding/PhoneEntryView.swift:158` — `"I agree to receive transactional SMS about my transfers (required for compliance)."` use this

- **Why flagged:** Same as S-401 for SMS. Spam Act has specific
  carve-outs for transactional messages; officer should confirm.
- **Suggested rewrite:** Defer to legal.

#### S-403: `ios/Kolaleaf/Features/Onboarding/PhoneEntryView.swift:89` — `"We'll text you a 6-digit code to verify it. Standard SMS rates apply."`

- **Why flagged:** "Standard SMS rates apply" is a common disclaimer, but
  AUSTRAC's parent regulator framework (and ACCC) like to see precise
  pricing disclosures. Officer's call whether this is enough.
- **Suggested rewrite:** "We'll text you a 6-digit code. Your
  mobile carrier's standard SMS charges may apply." use this

#### S-404: `ios/Kolaleaf/Features/FailurePaths/ExpiredTransferView.swift:67` — `"We didn't receive your AUD within 24 hours, so we let the rate go."`

- **Why flagged:** Explanatory copy on the expired-transfer screen.
  Customer-obligation framing — implies the 24h window is a contractual
  expectation. Officer should confirm the wording matches the T&Cs
  governing transfer expiry.
- **Suggested rewrite:** "Your locked rate expired after 24 hours." (and
  link to the T&Cs). use this

#### S-405: `ios/Kolaleaf/Features/FailurePaths/CancelTransferView.swift:110` — `"Your AUD never left your bank — nothing to refund."`

- **Why flagged:** Factual claim about funds custody. True for the
  AWAITING_AUD state (cancel is gated on that), but worded as if it is
  universally true on this screen.
- **Suggested rewrite:** Accept (the screen is only reachable in
  `AWAITING_AUD`), or "You haven't sent us any AUD yet — there's nothing
  to refund." use this

#### S-406: `ios/Kolaleaf/Features/FailurePaths/CancelTransferView.swift:232` — `"Your AUD has arrived. Track it instead."`

- **Why flagged:** "Track it instead" implies the user gives up control
  once the AUD has arrived. Compliance officer should confirm that
  customer-cancellation rights after AUD receipt are correctly
  represented.
- **Suggested rewrite:** "Your AUD has already arrived, so this transfer
  can't be cancelled. You can track its progress instead." use this

#### S-407: `ios/Kolaleaf/Features/Send/StepUpAuthSheet.swift:134` — `"You've sent a few transfers recently. Confirm with your authenticator to keep your account safe."`

- **Why flagged:** Velocity-step-up framing. Officer should confirm
  it's appropriate to _name the reason_ (velocity) to the user, vs. a
  generic "extra confirmation needed" prompt — naming the trigger may
  give bad actors information about thresholds.
- **Suggested rewrite:** "Please confirm this transfer with your
  authenticator." (drop the velocity hint). use this. 

---

### Currency / FX claims

#### S-501: `ios/Kolaleaf/Features/Send/SendView.swift:225` — `"Rate is out of date. Tap to refresh."`

- **Why flagged:** "Out of date" is a quality claim about the rate. The
  underlying rate is refreshed every 15 min by the rate engine; this
  banner appears when the cached quote ages out. Officer should confirm
  wording is acceptable.
- **Suggested rewrite:** "Rate has refreshed. Tap to use the new rate." use this

#### S-502: `ios/Kolaleaf/Features/FailurePaths/ExpiredTransferView.swift:176` — `"Today's rate is slightly lower than your locked rate."`

- **Why flagged:** Subjective qualifier "slightly" wraps a numeric
  comparison (the file's docstring at lines 166–168 shows the bands:
  <1% no banner, 1–3% "slightly", 3–10% percentage shown, >10% hard
  warning). Officer should confirm that subjective copy stacked on top
  of a true numeric delta is OK.
- **Suggested rewrite:** Accept (the precise pct is shown below it), or
  remove "slightly" and let the next-line percentage do the work. remove "slightly"

#### S-503: `ios/Kolaleaf/Features/FailurePaths/ExpiredTransferView.swift:185` and `:180` — `"Today's rate is X% lower than your locked rate."` / `"Today's rate is X% lower"`

- **Why flagged:** Factual numeric statement. Likely fine, but officer
  should confirm rounding policy is acceptable (the file uses
  `Decimal` rounding to 0 fractional digits in `pctDelta`).
- **Suggested rewrite:** Accept.

#### S-504: `ios/Kolaleaf/Features/FailurePaths/ExpiredTransferView.swift:188` — `"You'll receive less than your original quote."`

- **Why flagged:** Negative-outcome disclosure on the hard-warning
  branch (>10% rate move). Wording is fine but should be confirmed as
  the consumer-protection-grade disclosure.
- **Suggested rewrite:** "You'll receive less Naira than your original quote showed."

#### S-505: `ios/Kolaleaf/Features/Help/HelpViewModel.swift:70` — `"Daily limits, FX rates and service fees."`

- **Why flagged:** Mentions "service fees" — engineering wants the
  officer to confirm the help-card subtitle accurately reflects what the
  user finds at that URL, and that "service fees" matches the wording
  the legal team uses in T&Cs.
- **Suggested rewrite:** Accept 

---

## Strings that LOOK suspicious but are fine

Brief list with reasoning, so the officer doesn't re-question them.

- `ios/Kolaleaf/Features/Security/SecurityMenuView.swift:60` —
  "Require Face ID to open Kolaleaf". Security feature description,
  factual.
- `ios/Kolaleaf/Features/Security/BiometricLockView.swift:75` —
  "Use Face ID to unlock the app." Instructional, no guarantee.
- `ios/Kolaleaf/Features/Recipients/ResolvedNameCard.swift:101` —
  "Account holder" + line 118 accessibility label
  "Account holder \(name), confirmed". "Confirmed" here refers
  specifically to the resolved-name lookup against the bank's directory;
  factual, not a regulatory claim.
- `ios/Kolaleaf/Features/Recipients/AddRecipientView.swift:116` —
  "Pick the bank and account number — we'll confirm the holder name
  before saving." Describes a real verification step.
- `ios/Kolaleaf/Features/Activity/*` status labels ("Completed",
  "Failed", "Refunded", etc.) — direct mappings from `TransferStatus`,
  not promises.
- `ios/Kolaleaf/Features/Refer/ReferView.swift:71-74` — "Give $10,
  get $10" + share copy. Promotion mechanics; the dollar amounts may
  need separate consumer-promotion sign-off, but the wording itself
  isn't a remittance-regulatory issue.
- `ios/Kolaleaf/Features/Help/HelpViewModel.swift` defaultValues
  (transfer status / KYC / security card titles) — they're navigation
  labels to externally-hosted articles where the legal-team copy lives.
- `ios/Kolaleaf/Features/Send/TransferStateLabels.swift:37` —
  "Push AUD to your PayID. We'll handle the rest." See S-205 for the
  longer variant. The short subtitle here is the same risk class.

---

## Strings flagged for follow-up (not in catalog yet)

`Localizable.xcstrings` is currently an empty shell. Xcode populates it
from the next build. Every flagged string above is therefore in source
files now and will appear in the catalog after the next build cycle.
The strings marked with `S(...)` IDs above that **do not** have an
explicit `localized:` key will be created with auto-generated keys at
build time — engineering should run a populate-and-review pass once the
officer's decisions are in, so the auto-generated keys match the agreed
audit IDs.

In particular, these `Text("...")` literals do not currently have an
explicit `localized:` identifier and will be auto-keyed by Xcode:

- All Welcome screen trust-strip strings (S-201, S-202, S-203,
  S-101, S-102).
- KYCIntroView heading + rationale (S-002, S-305).
- KYCProcessingView heading (S-003).
- KYCUnderReviewView "Typical wait" / "Under 24 hours" (S-004).
- All FloatPausedView holding-banner copy (S-206, S-207, S-208).
- ExpiredTransferView expiry headline + rate-comparison copy (S-404,
  S-502, S-503, S-504).
- CancelTransferView reassurance + too-late card (S-405, S-406).
- ReceiptView "To {name}" / headline routing — the headline copy
  itself uses `localized:` keys (`receipt.headline.completed`,
  `receipt.headline.on_the_way`, `receipt.savings.best_available`) so
  S-104, S-105, and S-301 already have stable keys.
- StepUpAuthSheet velocity copy (S-407).
- EmailEntryView / PhoneEntryView opt-in copy (S-401, S-402, S-403).

When the catalog is repopulated post-review, these should be promoted to
explicit `String(localized: "<key>", defaultValue: "...")` so they get
deterministic catalog keys for future audits.

---

## Summary

- **Total strings flagged:** 31
- **Breakdown by category:**
  - Speed / timing claims: 4 (S-001 to S-004)
  - Guarantee / absolute claims: 5 (S-101 to S-105)
  - Treasury / float exposure: 9 (S-201 to S-209)
  - KYC / verification copy: 6 (S-301 to S-306)
  - Customer obligation precision: 7 (S-401 to S-407)
  - Currency / FX claims: 5 (S-501 to S-505)
- **Top three to read first:**
  1. **S-202 (`AUSTRAC RG 105`)** — load-bearing regulatory identifier,
     needs legal confirmation it's the correct form and number.
  2. **S-201 (`Licensed AU money transmitter`)** — the codebase elsewhere
     describes Kolaleaf as "AUSTRAC-registered"; the live UI is stronger.
  3. **S-305 (KYC rationale paragraph)** — bundles three regulatory
     claims in one sentence; should be officer-and-legal-approved word
     for word.
- **Engineering's own high-confidence rewrite:** S-301 ("Best available
  rate") — currently static placeholder copy not backed by a real
  saved-vs-bank-rate calculation. Recommend removing the row until the
  backend ships the comparison.
