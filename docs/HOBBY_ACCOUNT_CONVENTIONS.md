# Hobby-Account Conventions

This document lives in `specimen-registry` because it's the first real repo on the `mpgonzalez271` hobby account. If more repos accumulate, it may migrate to a dedicated `.github` repo. Recorded here first so it's discoverable from anywhere on the account.

## Account purpose

`mpgonzalez271` is a hobby, experimental, and AI-collaboration GitHub account. It is intentionally separate from my production account (`mpgonzalez27`) so that:

- Real work is not mixed with experiments
- AI-agent-driven code doesn't touch production credentials
- Failed experiments can be deleted without collateral damage
- Public reviewers of any hobby project (like specimen-registry) can see the whole context of the account clearly

## Naming

- Kebab-case for repos: `specimen-registry`, `hail-mary-scout`
- One project per repo, no monorepos on this account
- Repos named `experiment-<name>` are understood to be short-lived and may be deleted

## README-first discipline

Every repo has a `README.md` at its root with:

1. One-line description (matches the GitHub `description` field)
2. Status badge: `active`, `paused`, `archived`, or `experiment`
3. What it is, in plain words
4. Who it's for (if it has an audience beyond me)
5. AI-assistance disclosure where material
6. License

## AI-assistance disclosure

Every repo on this account is built with substantial AI-assistant collaboration. This is disclosed:

- **Always** in the profile README (the account itself is disclosed as AI-collaborative)
- **Explicitly** in individual repos where the disclosure is material — e.g., `specimen-registry` requires source-locked verification of every AI-generated claim because it publishes machine-readable data on published scientific specimens

## Isolation from production

The following are **never** touched by tools operating on this account:

- The `mpgonzalez27` production GitHub account
- The `ghostholding.com` Cloudflare account's zones other than `specimenregistry.org` (the SAR-scoped API token can only see that one zone)
- Any Ghost Holding, FQHC 340B Compliance, IVÉ, SAVE, or OBE work

## Token scoping

Every credential provisioned for use on this account follows narrow-scope-per-project:

- One PAT per project, scoped only to that project's repos (or one PAT for the whole account when repo count is low)
- Never a "workflow" or "admin:org" scope on classic PATs — use fine-grained PATs with per-repo permissions
- Cloudflare tokens scoped to one zone at a time, with explicit zone whitelisting
- All credentials logged in the credential vault with a name that identifies the project

## Deletion policy

- `experiment-*` repos may be deleted after 30 days of inactivity without further approval
- Named-project repos are never deleted without explicit user approval
- All deletions require `confirm_action` for the specific repo
