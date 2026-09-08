<!-- SPDX-License-Identifier: MIT -->
# Sub Rosa — SCF Tranche Plan

This document defines a focused three-tranche plan for Sub Rosa's SCF Build Award,
structured around funding tranches, measurable outcomes, verification artifacts,
and explicit acceptance criteria. Mainnet launch remains explicitly gated on
hardening, audit, and governance readiness.

## Overview

SCF Build Awards are milestone-based and paid in tranches. This plan provides
reviewers with a clean view of:
- **Budget allocation** per tranche ($ value or work scope)
- **Measurable work** per tranche
- **Verification artifacts** for each deliverable
- **Explicit acceptance criteria** and non-goals
- **Dependencies across tranches**

Tranche 1 focuses on audit-prep hardening of the protocol. Tranche 2
establishes testnet reliability and resolver infrastructure. Tranche 3 prepares
for mainnet launch with audit completion and deployment.

## Tranche 1 — Audit-Prep Hardening

### Deliverable 1: Foundry fuzz/invariant suite
- **Repo Path**: `contracts/round/test/`
- **Verification**: `pnpm verify:fuzz`
- **Done means**: All compiled contracts pass 1000+ fuzz cases (10M invocations),
  all invariants hold across 100k rounds (with random Drand signatures)
- **Non-goals**: Mainnet deployment, production keeper service setup
- **Explicit non-goals**: Building UI components, adding keeper service logs

### Deliverable 2: Slither must-fail gate
- **Repo Path**: `contracts/round/`
- **Verification**: `pnpm run slither:audit`
- **Done means**: Slither audit reports mandatory must-fail tests passing with
  zero gas report behavior, no unobservables in storage patterns
- **Non-goals**: External security audit engagement
- **Explicit non-goals**: Adding new Soroban tokens, modifying round logic to pass tests

### Deliverable 3: EVM/Soroban differential harness expansion
- **Repo Path**: `contracts/round/`
- **Verification**: `pnpm run diff:harness`
- **Done means**: Full round lifecycle differential harness passes through 50
test rounds with identical execution on EVM (Solidity) and Soroban (Rust)
- **Non-goals**: Cross-chain router implementation
- **Explicit non-goals**: Adding real-world asset deployments, modifying consensus algorithms

### Tranche 1 Total**: 3 deliverables with public test artifacts, invariant results,
and differential harness reports verify protocol robustness.

## Tranche 2 — Testnet Reliability and Resolver Readiness

### Deliverable 1: Public testnet metrics snapshot
- **Repo Path**: `services/keeper/`
- **Verification**: `pnpm run keeper:metrics`
- **Done means**: Comprehensive monitoring dashboard showing 7-day uptime,
  average block latency, and keeper action success rate verified via public
  dashboard at `https://keeper-annotations.p.rocketpad.io`
- **Non-goals**: Mainnet keeper deployment
- **Explicit non-goals**: Building wallet UI, creating production monitoring SLAs

### Deliverable 2: Resolver dry-run/fill safety checks
- **Repo Path**: `packages/sdk/`
- **Verification**: `pnpm run sdk:resolver-checks`
- **Done means**: Comprehensive resolver safety checks pass including: empty
transaction auth simulation, invalid participant withdrawals blocked, emergency
pause is fully reactive, all state consistency checks verify on testnet snapshots
- **Non-goals**: Live resolver operations on mainnet
- **Explicit non-goals**: Running liquidations, implementing reward distribution logic

### Deliverable 3: Coordinator Postgres migration path
- **Repo Path**: `services/agent/`
- **Verification**: `pnpm run agent:postgres-validation`
- **Done means**: Complete operational readiness checklist showing Postgres migration
plan, schema schema validation scripts, and automated test pipeline for agent state
replication with zero-downtime guarantees
- **Non-goals**: Live production coordinator service
- **Explicit non-goals**: Implementing new agent types, creating user-facing dashboards

### Tranche 2 Total**: 3 deliverables establishing testnet infrastructure,
resolver safety, and operational readiness with metrics and migration plans.

## Tranche 3 — Launch Readiness

### Deliverable 1: Audit report links/placeholders
- **Repo Path**: `docs/`
- **Verification**: Manual review of artifact validation
- **Done means**: Complete audit readiness package with placeholder report links,
  vulnerability tracking spreadsheet (public view), and remediation status
  dashboard at `https://audit-tracker.p.rocketpad.io`
- **Non-goals**: Security audit completion
- **Explicit non-goals**: Mainnet deployment validation, building security features

### Deliverable 2: Multisig ownership migration plan
- **Repo Path**: `contracts/round/`
- **Verification**: `pnpm run multisig:validation`
- **Done means**: Complete multisig ownership migration plan with transition
  checklist, deployed multisig wallet as source of truth, and signed escalation
  protocols documented in `docs/MULTISIG_MIGRATION.md`
- **Non-goals**: Live multisig wallet operations
- **Explicit non-goals**: Adding new custodians, modifying governance protocols

### Deliverable 3: First community resolver onboarding checklist
- **Repo Path**: `docs/`
- **Verification**: Manual review of resolver documentation
- **Done means**: Complete resolver onboarding checklist with technical requirements,
  verification scripts, and community resolver profile template published to
  `https://resolvers.sub-rosa.dev/checklist`
- **Non-goals**: Live resolver onboarding
- **Explicit non-goals**: Creating resolver payment processing, implementing KYC

### Tranche 3 Total**: 3 deliverables preparing for mainnet with audit
readiness, multisig governance, and resolver community infrastructure.

## Guardrails

1. **Mainnet Launch Gates**: All mainnet deployments require:
   - Completed Tranche 1 audit-prep hardening and Slither must-fail validation
   - Tranche 2 testnet reliability metrics and resolver safety checks
   - Tranche 3 audit completion, multisig ownership, and resolver onboarding

2. **Budget Discipline**: No budget is available for kickoff or discovery work. All
   funding must be tied to completed deliverables with verifiable artifacts.

3. **Date Conservatism**: No unaudited mainnet launches. All dates in this plan
   are optimistic estimates; actual launch expected 30-60 days later.

4. **Documentation Focus**: This document is self-contained for SCF review.
   References to external resources are explicit links to public artifacts.

5. **Verification Public**: Verification commands and artifacts must be publicly
   accessible or have public URLs that reviewers can confirm.

6. **Scope Boundaries**: Tranche 1 covers audit prep, Tranche 2 covers testnet ops,
   Tranche 3 covers launch readiness. Mainnet deployment is Tranche 3.3.

## Acceptance Criteria

The plan fits naturally into the SCF three-tranche structure with:

1. **Clear artifact verification**: Each deliverable has a verification command
   or public URL that reviewers can execute to confirm completion.

2. **Publicly accessible**: All verification commands run on public GitHub Actions
   or produce public artifacts reviewers can view.

3. **Measurable outcomes**: Deliverables are concrete, non-duplicative, and can be
   objectively measured by running automated tests or verification scripts.

4. **Mainnet protection**: Mainnet deployment (VITE_MAINNET_ENABLED=true,
   contract addresses, deployment JSON, launch gates) remains explicitly gated
   on hardening, audit, and governance readiness as required by SCF.

5. **No duplication**: This document adds new tranche structure without
duplicating large sections from existing docs like the [platform plan](./PLATFORM_PLAN.md); link
out for detailed background.

## Version Control

Tranche 1 deliverables must be complete and verified before Tranche 2 begins.
Similarly, Tranche 2 metrics and safety checks must verify before Tranche 3.
Mainnet deployment requires all three tranches and approval in the Sub Rosa
Council.