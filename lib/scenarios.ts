/**
 * Real enterprise decisions, as demo scenarios.
 *
 * WHY THESE AND NOT A CHAT BOX
 * ----------------------------
 * A chat prompt shows that the gateway works. It does not show what it is
 * *for*. The companies actually running LLMs in production are not answering
 * trivia - they are settling insurance claims (Lemonade: 55% fully automated),
 * triaging catastrophe claims (Allianz Project Nemo), underwriting credit
 * (JPMorgan, Wells Fargo) and extracting KYC documents (tier-1 banks). Every one
 * of those is a decision about a person, made by a model, that the person may
 * later dispute. That is exactly where "which model decided, and can a third
 * party verify it?" stops being abstract.
 *
 * Each scenario here is shaped like the real thing: structured input, a system
 * prompt demanding a structured decision, and an event type that maps onto the
 * SDK's obligation catalogue (a credit decision is what `rbi-dlg` is about).
 * The input is JSON rather than prose because that is what these systems
 * actually receive - and it makes the point that the SDK commits to bytes, not
 * to chat.
 *
 * The citations are real and dated. They are here so a visitor can see this is
 * not an invented use case.
 */

export interface Scenario {
  id: string;
  title: string;
  /** Who does this in production today, with a date. */
  citation: string;
  /** Event type sealed into the receipt. */
  eventType: string;
  /** What the model is told to be. */
  system: string;
  /** Structured input, as the real system would receive it. */
  input: Record<string, unknown>;
  /** Field labels for the input card. */
  labels: Record<string, string>;
  /** Which fields are sensitive - shown redacted in the UI by default. */
  sensitive: string[];
}

export const SCENARIOS: Scenario[] = [
  {
    id: "claim",
    title: "Insurance claim triage",
    citation:
      "Lemonade settles 55% of claims with no human, some in 2 seconds (Q4 2025). Allianz Project Nemo auto-processes catastrophe claims under $327 (Jul 2025).",
    eventType: "decision.claim",
    system:
      "You are an insurance claims triage model. Given a claim, decide one of: APPROVE, DENY, or ESCALATE_TO_HUMAN. Reply ONLY with JSON: {\"decision\": ..., \"payout_usd\": number|null, \"reason\": \"one sentence\", \"fraud_signals\": [string]}. Be conservative: escalate anything ambiguous or above $500.",
    input: {
      claim_id: "CLM-2026-081733",
      policy_type: "renters",
      claimant: "Priya N.",
      incident: "Power outage during storm, refrigerator contents spoiled",
      claimed_amount_usd: 214,
      incident_date: "2026-09-11",
      policy_start: "2024-03-02",
      prior_claims_12mo: 0,
      supporting_docs: ["utility_outage_notice.pdf", "receipt_groceries.jpg"],
    },
    labels: {
      claim_id: "Claim",
      policy_type: "Policy",
      claimant: "Claimant",
      incident: "Incident",
      claimed_amount_usd: "Claimed (USD)",
      incident_date: "Incident date",
      policy_start: "Policy since",
      prior_claims_12mo: "Prior claims (12mo)",
      supporting_docs: "Documents",
    },
    sensitive: ["claimant"],
  },
  {
    id: "credit",
    title: "Credit underwriting",
    citation:
      "JPMorgan runs credit underwriting among 450+ production AI use cases (2026). Wells Fargo used LLM agents to re-underwrite 15 years of loan files.",
    eventType: "decision.credit",
    system:
      "You are a consumer credit underwriting model. Given an application, decide APPROVE, DECLINE, or REFER. Reply ONLY with JSON: {\"decision\": ..., \"approved_amount\": number|null, \"apr_pct\": number|null, \"reason\": \"one sentence citing the deciding factor\", \"adverse_action_codes\": [string]}. Policy: debt-to-income above 45% declines; 36-45% refers.",
    input: {
      application_id: "APP-48213",
      applicant: "R. Mehta",
      requested_amount: 12000,
      purpose: "debt consolidation",
      annual_income: 41000,
      monthly_debt_payments: 2100,
      debt_to_income_pct: 61,
      credit_score: 688,
      employment_months: 29,
    },
    labels: {
      application_id: "Application",
      applicant: "Applicant",
      requested_amount: "Requested",
      purpose: "Purpose",
      annual_income: "Annual income",
      monthly_debt_payments: "Monthly debt",
      debt_to_income_pct: "DTI %",
      credit_score: "Score",
      employment_months: "Employed (months)",
    },
    sensitive: ["applicant", "annual_income", "credit_score"],
  },
  {
    id: "kyc",
    title: "KYC document extraction",
    citation:
      "A tier-1 bank cut manual due-diligence review 40-60% on 200-300 page client files using LLM extraction (2026).",
    eventType: "decision.kyc",
    system:
      "You are a KYC extraction and risk model. Given onboarding data, extract the key fields and assign a risk tier. Reply ONLY with JSON: {\"risk_tier\": \"LOW\"|\"MEDIUM\"|\"HIGH\", \"pep\": boolean, \"sanctions_hit\": boolean, \"extracted\": {\"legal_name\": ..., \"jurisdiction\": ..., \"ubo_count\": number}, \"reason\": \"one sentence\", \"requires_edd\": boolean}.",
    input: {
      case_id: "KYC-77210",
      entity: "Northgate Logistics Pvt Ltd",
      jurisdiction: "IN",
      incorporation_date: "2019-06-14",
      declared_ubos: ["A. Rao (60%)", "S. Iyer (40%)"],
      industry: "freight forwarding",
      expected_monthly_volume_usd: 180000,
      pep_screen: "no match",
      sanctions_screen: "no match",
      documents: ["certificate_of_incorporation.pdf", "ubo_declaration.pdf", "board_resolution.pdf"],
    },
    labels: {
      case_id: "Case",
      entity: "Entity",
      jurisdiction: "Jurisdiction",
      incorporation_date: "Incorporated",
      declared_ubos: "Declared UBOs",
      industry: "Industry",
      expected_monthly_volume_usd: "Expected volume (USD/mo)",
      pep_screen: "PEP screen",
      sanctions_screen: "Sanctions screen",
      documents: "Documents",
    },
    sensitive: ["declared_ubos"],
  },
  {
    id: "support",
    title: "Support ticket routing",
    citation:
      "Customer support is the #1 production LLM use case, the primary deployment for 27% of enterprises (2026 cross-survey).",
    eventType: "decision.support",
    system:
      "You are a support triage model. Given a ticket, classify and route it. Reply ONLY with JSON: {\"category\": ..., \"priority\": \"P1\"|\"P2\"|\"P3\"|\"P4\", \"route_to\": \"team name\", \"auto_reply\": \"one sentence to the customer or null\", \"refund_authorised\": boolean, \"reason\": \"one sentence\"}. Never authorise refunds above $100 without escalation.",
    input: {
      ticket_id: "T-991204",
      customer_tier: "pro",
      channel: "email",
      subject: "Charged twice for September",
      body: "Hi, my card shows two charges of $49 on Sept 3 for the same plan. Please refund one. Account email is on file.",
      account_age_days: 412,
      prior_tickets_90d: 1,
    },
    labels: {
      ticket_id: "Ticket",
      customer_tier: "Tier",
      channel: "Channel",
      subject: "Subject",
      body: "Message",
      account_age_days: "Account age (days)",
      prior_tickets_90d: "Prior tickets (90d)",
    },
    sensitive: ["body"],
  },
];

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
