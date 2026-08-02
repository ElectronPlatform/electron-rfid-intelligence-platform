# Support Philosophy

Status: Working draft for review

This is an internal planning document. It is not a public support page and not a final funding decision.

It collects the current shared thinking about voluntary support for Electron Platform.

## Phase 1: Why Support Exists

Voluntary support exists to help keep Electron Platform sustainable.

It enables continued development, testing, documentation, hardware research, maintenance and future improvements while allowing the platform to remain independent, user-focused and privacy-respecting.

Support is not payment for access.

It is participation in helping Electron Platform continue to grow.

## Phase 2: Protected Core

Funding must never weaken trust.

The following areas should remain free and trust-based:

- safety features;
- privacy and local control;
- basic RFID workflows;
- essential documentation;
- bug fixes and stability improvements;
- feedback participation;
- Preview participation.

Preview participation exists to improve the platform and should remain separate from donations.

## Phase 2.5: Support Expectations

Voluntary support helps Electron Platform continue to grow and improve.

Development depends on available time, testing, project priorities and technical feasibility.

Every contribution is appreciated, but voluntary support does not create an obligation to deliver specific features, timelines or individual support.

Support is a way to participate in the future of Electron Platform, not a purchase of guaranteed outcomes.

## Suitable Support Benefits

Possible future supporter benefits should remain outside the protected core.

Examples that may fit the philosophy:

- optional acknowledgement;
- supporter listing if the person agrees;
- development updates;
- behind-the-scenes notes;
- community recognition;
- a non-essential supporter page;
- cosmetic appreciation that does not affect safety, privacy or access.

Avoid:

- paid Preview access;
- paid Preview extensions;
- paid bug fixes;
- paid safety features;
- paid documentation needed for safe use;
- paid access to essential support;
- any wording that suggests donations buy Ronald's time.

## Draft Portal Structure

Possible future Support page layout:

1. Why support Electron Platform
   - short explanation of sustainability;
   - positive focus on what support enables.

2. Ways to help
   - testing;
   - bug reports;
   - feedback;
   - documentation suggestions;
   - hardware behaviour reports;
   - voluntary financial support.

3. What support means
   - appreciation;
   - participation in the future of the project;
   - not payment for guaranteed outcomes.

4. What remains trust-based
   - safety;
   - privacy;
   - basic RFID workflows;
   - feedback;
   - Preview participation.

5. Transparency
   - the project remains local-first and privacy-first;
   - no hidden tracking should be added for funding.

6. Future goals
   - hardware testing;
   - documentation;
   - release preparation;
   - Portal improvements;
   - multi-device support.

## Platform Comparison

No provider has been selected.

All details should be verified again before implementation because fees, country support and terms can change.

### Ko-fi

Strengths:

- Friendly support-oriented tone.
- Fits "support as appreciation" well.
- Common for creators and small projects.
- Easy to link from a static GitHub Pages website.
- Can be used without building payment code.

Risks / questions:

- Payment processing still depends on connected providers.
- Need to verify fees for one-time donations, memberships, shop items and the selected account type.
- Need to review how much personal information is visible to supporters.

Fit for Electron Platform:

Good candidate for a soft "Support Electron" link.

### Buy Me a Coffee

Strengths:

- Simple public support page.
- Easy for non-technical supporters to understand.
- Easy to link from a static site.

Risks / questions:

- "Buy me a coffee" may feel slightly casual compared with Electron Platform's professional tone.
- Need to verify fees, payout options and country support.
- Need to review privacy and what personal details are shown.

Fit for Electron Platform:

Possible, but the public label should probably be "Support Electron" rather than "Buy me a coffee".

### PayPal

Strengths:

- Widely recognised internationally.
- Familiar to many users.
- Easy to create a payment or donation link.
- Works with static websites.

Risks / questions:

- Can feel more like a commercial transaction.
- Fee structure varies by country, payment type and currency.
- Personal or business account visibility must be reviewed carefully.
- Bank/tax/accounting implications need review.

Fit for Electron Platform:

Useful, but should be handled carefully to avoid making support feel like payment for service.

Current project direction:

Ronald currently prefers PayPal as the first support provider to prepare for.

Implementation should still remain conservative:

- no payment handling inside Electron;
- no donation tracking inside Electron;
- no supporter/license linkage;
- no automatic unlocks;
- a simple externally hosted PayPal support link only;
- support wording must remain clear that support is voluntary appreciation.

### Stripe Payment Links

Strengths:

- Professional.
- Works well for fixed support amounts or simple payment links.
- Easy to link from a static website.
- Strong long-term infrastructure if the project becomes more formal.

Risks / questions:

- More business-like than creator-support platforms.
- Requires more setup and administration.
- Fees and tax handling need review.
- May feel too formal for the first support phase.

Fit for Electron Platform:

Better later if Electron Platform becomes more structured commercially.

### GitHub Sponsors

Strengths:

- Strong fit for open-source or developer-facing projects.
- Support is clearly connected to project sustainability.
- Good trust signal for technical users.
- Public sponsor visibility can be optional depending on configuration.

Risks / questions:

- Availability and eligibility need review.
- Best fit if the project is presented as open-source or community-supported.
- May be less familiar to non-developer users.

Fit for Electron Platform:

Potentially very good if Electron Platform's public GitHub presence becomes central.

## Static Site Integration Notes

The Portal is hosted as a static GitHub Pages website.

The simplest future integration is a normal external link:

- Support Electron button;
- support URL stored in central configuration;
- no backend;
- no payment processing inside the Portal;
- no user tracking required.

## Maintainer Tool Recommendations

Future configuration items that may belong in the Maintainer Tool:

- support URL;
- support button visibility;
- selected support platform label;
  - initial provider direction: PayPal;
- public support text;
- short support disclaimer;
- contact email;
- Portal URL;
- documentation URL;
- feedback/contact URL;
- Google Drive download URL;
- Preview build label;
- release channel;
- future supporter page URL;
- analytics provider selection, if added later.

The Maintainer Tool should edit configuration safely. Ronald should not need to manually edit JavaScript for routine project settings.

## Consistency Review

The current proposals remain consistent with Electron Platform if:

- support remains voluntary;
- support does not control Preview access;
- support does not unlock safety or privacy features;
- support does not create hidden tracking;
- users remain in control;
- the Portal wording stays calm and transparent;
- Ronald's time is respected without sounding defensive.

Discussion point for later:

Before any public support button is added, Ronald should review tax, legal and account visibility implications for his own situation.
