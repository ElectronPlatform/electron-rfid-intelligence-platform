# Electron Platform Philosophy

Status: Historical broader platform philosophy

The approved product-design authority is
[`docs/PROJECT_CONSTITUTION.md`](docs/PROJECT_CONSTITUTION.md). This document
retains broader Portal, Preview, funding and support philosophy. If a product
principle conflicts, the Constitution takes precedence.

This document describes the principles behind Electron Platform. It is not a feature list, release plan or legal document. It is a guide for future decisions about the app, Portal, documentation, support, previews, funding and long-term architecture.

## Purpose

Electron Platform exists to help people explore, understand and document RFID technologies in a calm, safe and understandable way.

Electron should make RFID workflows clearer without hiding important technical reality. It should help users identify cards, understand what is known, preserve useful context and make informed decisions without needing to remember every low-level device command.

The long-term goal is not to be only a Proxmark3 tool. Electron should become a trustworthy RFID intelligence platform where devices, knowledge, reports, research and support work together.

## Core Principles

### Local First

Electron should work locally by default.

Card data, notes, reports, research records, device logs and support packages should remain on the user's machine unless the user explicitly chooses to share them.

### Privacy First

Electron should never silently upload sensitive information.

RFID data can be personal, security-sensitive or customer-sensitive. The user must understand what is included before anything leaves their machine.

### User Controlled

The user should decide what to scan, save, export, share and delete.

Electron should guide, explain and warn, but it should not take control away from the user.

### Transparency Over Complexity

Electron should prefer clear, understandable workflows over hidden magic.

When Electron runs a device command, creates a report, builds a feedback package or stores research, the user should be able to understand what happened and where the data went.

### Trust Before Monetisation

Trust is part of the product.

Funding, licensing or preview controls should never weaken safety, privacy, transparency or respectful treatment of users.

### Human-Friendly Design

Electron should explain technical RFID concepts in language a careful beginner can understand, while still being useful to experienced users.

The app and Portal should feel professional, calm and understandable, not like a pile of technical tools.

### Long-Term Maintainability

Electron should grow through clear architecture rather than scattered quick fixes.

Shared concepts should have one clear source of truth where practical, including reports, device profiles, device capabilities, command safety, preview configuration, app naming and storage folders.

## User Trust

Electron should never surprise users with hidden uploads, hidden writes, unclear device actions or confusing data handling.

The user should be able to answer:

- What is Electron doing?
- What data is being used?
- What command is being run?
- What will be saved?
- What will be shared?
- What risks exist?

If the answer is unclear, Electron should explain it better.

## Safety

Safety should be part of the protected core of Electron Platform.

Read-only and safe workflows should be easy. Risky operations should be clearly explained, guarded and never hidden behind vague buttons.

Safety features should not become paid features.

Protected safety areas include:

- Device Guard
- command safety checks
- unsafe command warnings
- read/write risk explanations
- no-device detection
- timeout handling
- clear user confirmation before risky workflows

## Design Philosophy

Electron should feel careful, capable and trustworthy.

The interface should help users understand RFID workflows without overwhelming them. It should avoid unnecessary technical complexity, but it should not pretend risky or complex actions are simpler than they are.

The Electron Portal should share the same identity as the app:

- calm;
- dark, focused visual language;
- clear structure;
- no aggressive marketing;
- one obvious path for the main action;
- support and documentation easy to find.

## Preview Philosophy

Preview participation exists to improve Electron Platform.

The value of a Preview participant comes from testing, reporting bugs, suggesting improvements and helping the project understand real-world RFID workflows.

Preview participation should remain independent from donations or financial support.

Preview access and Preview extensions should be based on testing value, project needs, trust and development usefulness, not payment.

## Funding & Sustainability

Voluntary support exists to help keep Electron Platform sustainable.

It enables continued development, testing, documentation, hardware research, maintenance and future improvements while allowing the platform to remain independent, user-focused and privacy-respecting.

Support is not payment for access.

It is participation in helping Electron Platform continue to grow.

## Protected Core

Electron Platform may accept voluntary support, but the platform's protected core remains trust-based.

The following should not depend on payment or supporter status:

- safety;
- privacy;
- basic RFID workflows;
- essential documentation;
- bug fixes;
- feedback participation;
- Preview participation.

Support may help the project grow, but it should not reduce the baseline experience for users who cannot or do not donate.

## Support Expectations

Voluntary support helps Electron Platform continue to grow and improve.

Development depends on available time, testing, project priorities and technical feasibility.

Every contribution is appreciated, but voluntary support does not create an obligation to deliver specific features, timelines or individual support.

Support is a way to participate in the future of Electron Platform, not a purchase of guaranteed outcomes.

## Maintainer Philosophy

Maintainer tools should help Ronald maintain the platform safely.

They may help manage release metadata, support links, download URLs, preview labels, signed extension tokens and release checks.

They should not become hidden gates, payment systems or confusing internal machinery exposed to users.

## Long-Term Direction

Electron Platform should be built as a platform, not just a single-device tool.

Future architecture should continue moving toward:

- device profiles;
- capability-based device support;
- central report models;
- reusable command libraries;
- clear support flows;
- portable static Portal hosting;
- documentation as a maintained project asset;
- clean separation between source code, runtime data, releases and archives.

Build the structure first.

Then fill it sprint by sprint.
