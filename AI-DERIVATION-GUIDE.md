# AI Derivation Guide — Creating or Recreating a Scraper from this Template

**Audience:** AI agents (Claude, etc.) tasked with deriving a new Node.js scraper from this EPAM template for a different Romanian company.

**Scope:** Every step from "user gave me a target company" to "CI is green and scraper runs daily, jobs visible on peviitor.ro".

**Source of truth:** This guide is consolidated from real-world issues encountered during the first four derivations (MEJIX, Talent Matchmakers, Artsoft, Continental Hotels). Each pitfall here corresponds to a closed GitHub issue — references at the bottom.

> **AI agents: after applying this guide to a derived repo, DELETE this file from the derived repo. It belongs only in the EPAM template.**

---

## 0. Decision tree — Use this guide when:

- User asks to create a scraper for company X → **CREATE flow**
- User asks to recreate / rewrite an existing scraper repo → **RECREATE flow** (delete + recreate via template)
- User points to an existing repo that wasn't created via template → **RECREATE flow** (badge won't appear unless re-done via template)

If unsure, ask the user.

---

## 1. Prerequisites

Before starting, confirm:

1. **`gh` CLI is authenticated** (`gh auth status`)
2. **Target company info is known**:
   - Legal name (`SRL`, `SA`, `SCA` — get the real one, may differ from repo slug)
   - CIF (Romanian fiscal code; can be 7-9 digits)
   - Brand (commercial name, may differ from legal)
   - Career URL
3. **Target site is understood** — fetch the career page first to identify:
   - JSON API? HTML scrape with cheerio? POST AJAX returning HTML?
   - Pagination? Filters? Required headers/cookies?
4. **EPAM template is in `is_template: true` state** (check via `gh api repos/sebiboga/epam-systems-international-srl-nodejs-scraper -q .is_template`)

---

## 2. CREATE flow — fresh new scraper

### 2.1 Create repo from template (gets the "Generated from" badge)

```bash
gh repo create sebiboga/<slug>-nodejs-scraper \
  --template sebiboga/epam-systems-international-srl-nodejs-scraper \
  --public \
  --description "Scraper automat pentru locurile de muncă <LEGAL_NAME> (CIF: <CIF>) — extrage de pe <CAREER_URL> și publică pe peviitor.ro"
```

**Verify the badge is set** (this confirms the template feature actually worked):

```bash
gh api repos/sebiboga/<slug>-nodejs-scraper -q '.template_repository.full_name'
# expect: sebiboga/epam-systems-international-srl-nodejs-scraper
```

If the badge is missing → the repo was created without `--template`. Delete and retry.

### 2.2 Clone locally

```bash
git clone https://github.com/sebiboga/<slug>-nodejs-scraper.git
cd <slug>-nodejs-scraper
```

---

## 3. RECREATE flow — replace an existing repo

The badge "Generated from EPAM" can only appear if the repo is created via the template feature. If the existing repo was created manually (copy-paste, fork), you must delete and recreate.

### 3.1 Learn from the existing repo first

Before destroying anything, extract company-specific intelligence:

```bash
# Get the scraping logic, identity, target URLs
gh api repos/sebiboga/<slug>-nodejs-scraper/contents/index.js -q .content | base64 -d
gh api repos/sebiboga/<slug>-nodejs-scraper/contents/config/company.json -q .content | base64 -d 2>/dev/null
gh api repos/sebiboga/<slug>-nodejs-scraper/contents/company.json -q .content | base64 -d 2>/dev/null
gh api repos/sebiboga/<slug>-nodejs-scraper/contents/ROBOTS.md -q .content | base64 -d
```

Identify:
- **Identity** — CIF, legal name, brand
- **Scraping URL + method** (API/HTML/AJAX)
- **Selectors / API params** (e.g. POST body, cheerio selectors)
- **City/workmode rules** (defaults, mappings)

### 3.2 Delete and recreate

```bash
gh repo delete sebiboga/<slug>-nodejs-scraper --yes
# then follow Section 2 (CREATE flow)
```

---

## 4. Apply company-specific changes

**Single edit point principle:** the template was designed so the only file you edit for identity is `config/company.json`. All scraper code, CI workflows, and the static HTML read from this file.

### 4.1 Edit `config/company.json`

```json
{
  "cif": "<7-9 digits>",
  "legalName": "<COMPANY NAME LEGAL>",
  "brand": "<Commercial brand>",
  "website": "https://...",
  "careerUrl": "https://...",
  "apiBase": "https://...",
  "apiEndpoint": "<optional, e.g. /_ajax/get-job-list.php>",
  "apiCountryId": "<optional, only if site uses country IDs>",
  "defaultLocation": "<city>",
  "scraperFile": "https://raw.githubusercontent.com/sebiboga/<slug>-nodejs-scraper/main/.github/workflows/job-seeker-ro-spider.yml"
}
```

Also overwrite `docs/company.json` with the same content — it's the copy served by GitHub Pages so the dashboard reflects the new company even before the first scrape.

### 4.2 Rewrite `index.js` scraping logic

Only **two functions** should be company-specific: `fetchJobs*()` and `parse*Jobs()`. The rest (mapping, transformation, SOLR upsert, markdown generation) is generic — do not change.

**Common scraping patterns observed in the ecosystem:**

| Pattern | Used by | Approach |
|---------|---------|----------|
| Paginated JSON API | EPAM | GET + loop pages until empty |
| Single-page HTML | MEJIX | GET, cheerio selector on response |
| POST AJAX → HTML | Continental Hotels | POST with form params, cheerio on response |
| Teamtailor HTML | Talent Matchmakers | GET, navigate `team-tailor`-style markup |

**Probe the endpoint first** with `curl` to see what params are required. Continental's old scraper failed because it omitted `id_lang` — a single missing form param made the endpoint return PHP warnings instead of jobs.

### 4.3 Delete stale ANAF cache

The template ships with `company.json` at the root — this is EPAM's ANAF cache. If you don't delete it, the first scrape will use EPAM's identity from cache:

```bash
rm -f company.json
```

The new ANAF data for the derived company will be fetched and cached on first run.

---

## 5. Update tests (mandatory — CI gates on them)

The template has 4 test layers; ALL must pass before merge.

### 5.1 `tests/unit/index.test.js` — rewrite the scraper-specific block

Replace the `parseApiJobs` block (EPAM-specific) with tests for your new parser:

- Use an HTML fixture matching your target site's response
- Test title/URL/location/workmode extraction
- Test edge cases (empty response, missing fields)

### 5.2 `tests/unit/company.test.js` — rename the ANAF mock constant

Rename `EPAM_ANAF_RECORD` → `<COMPANY>_ANAF_RECORD` and update the mocked data to match the new ANAF response (run `curl https://demoanaf.ro/api/company/<CIF>` to see the real shape).

### 5.3 `tests/unit/solr.test.js` — check CIF regex

If your CIF is 7 digits (some Romanian companies have shorter CIFs), the default `/^\d{8}$/` regex will fail. Replace with `/^\d{6,9}$/` or whichever range covers Romanian CIFs you're targeting.

### 5.4 `tests/integration/workflow.test.js` — make config-driven

Replace hardcoded `EPAM_CIF` with `companyConfig.cif` imported from `../../config/company.js`. Same for legal name and brand assertions.

For ANAF searches that return multiple matches, find by CIF (deterministic) — not by position in the result array.

### 5.5 `tests/e2e/scraper.test.js` — rewrite fully

Replace EPAM's API fetch with your new scraping method. Increase `beforeAll` timeout to **60s** if your target site is in Romania (Azure GH runners are slow to RO IPs).

### 5.6 `tests/consistency/repo.test.js` — make brand assertion dynamic

```js
import companyConfig from "../../config/company.js";
// then later:
expect(html.toLowerCase()).toContain(companyConfig.brand.toLowerCase());
```

Hardcoded brand strings break with each derivation.

### 5.7 `tests/validate-epam-jobs.js` — rename

```bash
git mv tests/validate-epam-jobs.js tests/validate-<brand>-jobs.js
```

Update the workflow `automation-testing.yml` to reference the new filename.

### 5.8 `tests/package.json` — rename the test package

Change `"name": "epam-scraper-tests"` to `"name": "<slug>-scraper-tests"`.

---

## 6. Documentation sweep (high-risk — see pitfalls section)

You will likely use `sed` for a bulk rename of "EPAM" → new brand. **This is dangerous.** Read the entire "Pitfalls — bulk sed" section below before running sed.

After sed, **always** do these manual review passes:

1. **README.md** — restore the "Derivat din EPAM template" link (sed will have changed it to point at the new repo, which is self-referential)
2. **CONTRIBUTING.md** — replace the inherited "Deriving a New Scraper" checklist with a slim "this is a derived scraper" intro pointing back to EPAM template
3. **AGENTS.md** — change "📐 This Repo Is a Template" to "🌱 This Repo Is a Derived Scraper"
4. **ROBOTS.md** — analyze the new target site's `robots.txt` (e.g. Continental Hotels has none → 302 redirect). Keep a "Diferență față de EPAM template" section that compares against the EPAM constraints.
5. **CHANGELOG.md** — REPLACE with a fresh `1.0.0` entry. Don't keep EPAM's version history (it doesn't belong here).
6. **package.json** — set `name` to `scraper-<brand>-ro` and `version` to `1.0.0`.
7. **docs/index.html** — i18n strings still contain "EPAM Careers API" / "EPAM Romania". Replace with new brand. Make sure the page title fallback constants match the new company.
8. **delete_request.json** — `cif:` field should be the new CIF.

---

## 7. CI configuration

### 7.1 Update workflow labels

The two workflows have `sed -i` lines that set test report titles. After bulk rename these will already say the new company name, but verify:

```bash
grep -rn "EPAM SYSTEMS\|EPAM Careers" .github/workflows/
# expect: no matches
```

### 7.2 Verify the critical CI ordering

These two ordering rules are NOT optional — both came from production CI failures:

1. **`Sync with remote` step MUST run BEFORE `Install dependencies`** (issue #38). `npm install` modifies `package-lock.json`, which breaks the subsequent rebase.
2. **`Sync with remote` step MUST have `if: github.event_name != 'pull_request'`** (issue #37). PR runs lack git identity, so the rebase aborts.

Both should already be correct in the template — verify with:

```bash
grep -B1 -A2 "Sync with remote" .github/workflows/*.yml
```

Expected output for each workflow:
```yaml
- name: Sync with remote
  if: github.event_name != 'pull_request'
  run: git pull origin main --rebase -X theirs
- name: Install dependencies
  run: npm install
```

---

## 8. GitHub repo settings

These are settings on the derived repo, not in code:

```bash
# Topics (required by consistency tests)
gh repo edit sebiboga/<slug>-nodejs-scraper \
  --add-topic job-seeker-ro-spider \
  --add-topic peviitor-ro

# Homepage URL (will be set after Pages is enabled)
gh repo edit sebiboga/<slug>-nodejs-scraper \
  --homepage "https://sebiboga.github.io/<slug>-nodejs-scraper/"

# Enable GitHub Pages from /docs on main
gh api -X POST repos/sebiboga/<slug>-nodejs-scraper/pages \
  -f source[branch]=main \
  -f source[path]=/docs
```

**The `SOLR_AUTH` secret must be added MANUALLY** via the UI:

`Settings → Secrets and variables → Actions → New repository secret`
- Name: `SOLR_AUTH`
- Value: same as EPAM (user knows it; don't guess)

You CANNOT copy secrets between repos via `gh` — flag this to the user as a manual step.

---

## 9. Verify locally before pushing

```bash
npm install
npm run test:unit        # Must pass before push
node -e "import('./index.js').then(m => /* live scrape probe */)"
```

Probe your scraping logic against the real site to confirm at least one job is parsed correctly.

---

## 10. Commit, push, trigger CI

```bash
git add -A
git commit -m "feat: convert template into <COMPANY> scraper

Derived from sebiboga/epam-systems-international-srl-nodejs-scraper."
git push

# Trigger CI to verify
gh workflow run job-seeker-ro-spider.yml --repo sebiboga/<slug>-nodejs-scraper
```

**Watch for typical failures** (each has a known fix below):
- "Sync with remote" failing → CI workflow ordering wrong (see Section 7.2)
- "Run Integration Tests" → most likely sed mangling (see Pitfall #1)
- "Run E2E Tests" timeout → bump `beforeAll` to 60s (Pitfall #5)
- "Consistency tests" → Pages not deployed yet OR homepage URL not set

---

## 11. Update EPAM template's "Derived Scrapers" table

After CI is green, add the new repo to EPAM's README:

```markdown
| [<slug>-nodejs-scraper](https://github.com/sebiboga/<slug>-nodejs-scraper) | <Legal Name> | <CIF> | <Method, e.g. HTML/cheerio> | ✅ Live |
```

Plus `CONTRIBUTING.md`'s "Validated in production" callout (if it lists derivatives).

This makes future AI agents aware that another working example exists.

---

## 12. Pitfalls (read before each derivation)

### Pitfall #1 — Bulk sed creates mangled identifiers (issue #5 Continental)

If you do this:
```bash
sed -i 's/epam.com/jobs-newcompany.ro/g' file.js
```

it will ALSO replace `epamCompany` (a variable name) with `jobs-newcompany.ropany` — invalid JavaScript.

**Mitigation:** after every bulk sed, run:
```bash
grep -rnE '\b[a-z]+\.[a-z]+[a-z]+\b' --include="*.js" .  # catches identifier pollution
node -c file.js  # syntax check
npm run test:unit  # full validation
```

Better yet, use word-boundary sed patterns: `sed -i 's/\bepam\b/newbrand/g'`.

### Pitfall #2 — ANAF returns multiple matches (issue #5 Continental)

If you search ANAF by brand name and assert the first result is your company, you're wrong — ANAF often returns 10+ unrelated companies with similar names first. Always find by CIF (deterministic):

```js
const match = results.find(c => c.cui.toString() === COMPANY_CIF);
```

### Pitfall #3 — SOLR may uppercase brand on store (issue #5 Continental)

If your config says `"brand": "Continental Hotels"` but SOLR returns `"CONTINENTAL HOTELS"`, tests asserting exact case will fail. Always use `.toLowerCase()` on both sides of brand comparisons in integration tests.

### Pitfall #4 — `lastScraped` format inconsistency (issue #6 Continental)

Older SOLR records may store `lastScraped` as full ISO timestamp (`2026-06-16T11:13:50.058Z`) while newer code writes `YYYY-MM-DD`. Make the test regex permissive:

```js
expect(doc.lastScraped).toMatch(/^\d{4}-\d{2}-\d{2}(T.*)?$/);
```

This is a known schema drift bug — track upstream as issue in EPAM template if not already fixed.

### Pitfall #5 — E2E timeout from Azure runners (issue #7 Continental)

Romania-hosted sites are often slow from GH Actions Azure runners. The default 30s `beforeAll` timeout is not enough. Use 60s for live-fetch hooks:

```js
beforeAll(async () => { /* ... */ }, 60000);
```

### Pitfall #6 — CIF length varies (issue #9 Continental)

Romanian CIFs are NOT always 8 digits. Continental Hotels has 7 digits (`1559737`). The default regex `/^\d{8}$/` in `tests/unit/solr.test.js` will fail. Use `/^\d{6,9}$/`.

### Pitfall #7 — Stale ANAF cache from template (issue #1 Continental)

The template ships with `company.json` (root) containing EPAM's ANAF data. The caching logic in `company.js` will read this cache first and skip ANAF for the derived company → first scrape uses EPAM identity. **Always `rm -f company.json` early in derivation.**

### Pitfall #8 — "Generated from" badge requires template feature (issue #1 Continental)

If the existing repo was created by `gh repo create` without `--template`, the badge will never appear. The ONLY way to add the badge retroactively is to delete and recreate via the template. Confirm with `gh api repos/<owner>/<repo> -q '.template_repository.full_name'` — if it returns `null`, the badge is missing.

### Pitfall #9 — Forgot to update the EPAM template's "Derived Scrapers" list (issue #1 Continental)

This is the last manual step and easy to miss. Set a reminder.

---

## 13. Issue tracking rule

**File a GitHub issue for every fix you apply that isn't a typo.** Even retroactively. Close it immediately if already fixed, but log it. This builds a knowledge base that future derivations and audits can search.

When the fix is template-wide (would benefit ALL derived scrapers), file in EPAM. When it's specific to the derived scraper (like company-specific scraping bugs), file there.

---

## 14. Reference: past derivations as worked examples

| Repo | Method | CIF | Notable | Issues |
|------|--------|-----|---------|--------|
| [epam-systems-international-srl-nodejs-scraper](https://github.com/sebiboga/epam-systems-international-srl-nodejs-scraper) | JSON API | 33159615 | Template (this repo) | — |
| [mejix-srl-nodejs-scraper](https://github.com/sebiboga/mejix-srl-nodejs-scraper) | HTML/cheerio (single-page) | 17372688 | First derivative — validated template works | — |
| [talent-matchmakers-srl-nodejs-scraper](https://github.com/sebiboga/talent-matchmakers-srl-nodejs-scraper) | Teamtailor HTML | 38460545 | — | — |
| [artsoft-consult-srl-nodejs-scraper](https://github.com/sebiboga/artsoft-consult-srl-nodejs-scraper) | HTML/cheerio | 15997630 | — | — |
| [continental-hotels-srl-nodejs-scraper](https://github.com/sebiboga/continental-hotels-srl-nodejs-scraper) | POST AJAX → HTML | 1559737 (7 digits!) | First SA (not SRL), exposed CIF regex bug | [#5](https://github.com/sebiboga/continental-hotels-srl-nodejs-scraper/issues/5), [#6](https://github.com/sebiboga/continental-hotels-srl-nodejs-scraper/issues/6), [#7](https://github.com/sebiboga/continental-hotels-srl-nodejs-scraper/issues/7), [#9](https://github.com/sebiboga/continental-hotels-srl-nodejs-scraper/issues/9) |

Read the linked Continental issues — they are the most detailed real-world record of pitfalls.

---

## 15. Source issues feeding this guide

This guide is a synthesis. The underlying source-of-truth issues are:

**EPAM template:**
- [#34](https://github.com/sebiboga/epam-systems-international-srl-nodejs-scraper/issues/34) — Extract config into a single file (the "single source of truth" principle)
- [#35](https://github.com/sebiboga/epam-systems-international-srl-nodejs-scraper/issues/35) — Shared validator module (`src/job-validator.js`)
- [#36](https://github.com/sebiboga/epam-systems-international-srl-nodejs-scraper/issues/36) — Derive a second scraper (validation)
- [#37](https://github.com/sebiboga/epam-systems-international-srl-nodejs-scraper/issues/37) — Sync with remote on PR runs
- [#38](https://github.com/sebiboga/epam-systems-international-srl-nodejs-scraper/issues/38) — Sync ordering before npm install

**Continental Hotels (deepest learning ground):**
- [#1](https://github.com/sebiboga/continental-hotels-srl-nodejs-scraper/issues/1) — Post-creation tracking
- [#3](https://github.com/sebiboga/continental-hotels-srl-nodejs-scraper/issues/3) — Typo from sed + ANAF instability
- [#5](https://github.com/sebiboga/continental-hotels-srl-nodejs-scraper/issues/5) — 4 distinct bulk-sed bugs
- [#6](https://github.com/sebiboga/continental-hotels-srl-nodejs-scraper/issues/6) — lastScraped format drift
- [#7](https://github.com/sebiboga/continental-hotels-srl-nodejs-scraper/issues/7) — E2E timeout from Azure
- [#9](https://github.com/sebiboga/continental-hotels-srl-nodejs-scraper/issues/9) — CIF format regex

---

**End of guide.** Reading time: ~10 minutes. Following this guide end-to-end: ~30–60 minutes per derivation if everything goes smoothly, longer if the target site has unusual quirks.

If you encounter a NEW class of pitfall not covered here, file an issue and update this guide.
