/**
 * COERA BC SRL Job Scraper - Main Entry Point
 *
 * Scrapes job listings from co-era.com/careers (single-page HTML) and stores
 * them in Solr. Uses cheerio (HTML parsing), not an API.
 */

import fetch from "node-fetch";
import fs from "fs";
import * as cheerio from "cheerio";
import { fileURLToPath } from "url";
import { validateAndGetCompany } from "./company.js";
import { querySOLR, deleteJobByUrl, upsertJobs, upsertCompany } from "./solr.js";
import { generateJobsMarkdown } from "./src/markdown-generator.js";
import companyConfig from "./config/company.js";

// ============================================================================
// CONFIGURATION CONSTANTS — derived from config/company.json
// ============================================================================

const COMPANY_CIF = companyConfig.cif;
const JOB_BASE = companyConfig.apiBase;
const CAREER_URL = companyConfig.careerUrl;

// Request timeout in milliseconds (10 seconds)
const TIMEOUT = 10000;

// Global variable to store company name after validation
let COMPANY_NAME = null;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Promise-based sleep function to introduce delays between requests
 * @param {number} ms - Milliseconds to sleep
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ============================================================================
// API FUNCTIONS - Fetching data from COERA Careers
// ============================================================================

/**
 * Fetches the COERA careers page HTML.
 * @returns {Promise<string>} The raw HTML
 */
async function fetchJobsHtml() {
  const res = await fetch(CAREER_URL, {
    headers: {
      "User-Agent": "job_seeker_ro_spider",
      "Accept": "text/html"
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${CAREER_URL}`);
  return res.text();
}

const ROMANIAN_CITIES = [
  "București", "Bucuresti", "Cluj-Napoca", "Cluj Napoca", "Brașov", "Brasov",
  "Timișoara", "Timisoara", "Iași", "Iasi", "Sibiu", "Oradea", "Constanța", "Constanta"
];

/**
 * Extracts Romanian cities mentioned in the title's location segment.
 * COERA encodes locations after a pipe in titles like:
 *   "Go beyond for your role! | Cluj & Brasov"
 *
 * @param {string} title
 * @returns {string[]} unique normalized city names
 */
function extractCities(title) {
  if (!title || !title.includes("|")) return [];
  const locationPart = title.split("|").slice(1).join("|");
  const found = new Set();
  for (const city of ROMANIAN_CITIES) {
    if (new RegExp(`\\b${city.replace(/[-\\s]/g, "[-\\s]?")}\\b`, "i").test(locationPart)) {
      // Prefer diacritic form
      const canonical = city
        .replace("Bucuresti", "București")
        .replace("Brasov", "Brașov")
        .replace("Timisoara", "Timișoara")
        .replace("Iasi", "Iași")
        .replace("Constanta", "Constanța");
      found.add(canonical);
    }
  }
  return [...found];
}

/**
 * Parses COERA careers HTML.
 * Selector: a.careerButton
 * Title is in the `title` attribute (with optional "| City1 & City2" suffix).
 *
 * @param {string} html
 * @returns {{jobs: Array<Object>, total: number}}
 */
function parseHtmlJobs(html) {
  const $ = cheerio.load(html);
  const jobs = [];

  $("a.careerButton").each((_, el) => {
    const $a = $(el);
    const href = ($a.attr("href") || "").trim();
    const rawTitle = ($a.attr("title") || $a.text()).trim();
    if (!rawTitle || !href) return;

    // Strip the trailing "| Cities" segment from the displayed title
    const cleanTitle = rawTitle.split("|")[0].trim();
    const url = href.startsWith("http") ? href : `${JOB_BASE}${href.startsWith("/") ? "" : "/"}${href}`;

    const cities = extractCities(rawTitle);
    const location = cities.length > 0 ? cities : [companyConfig.defaultLocation];

    // COERA is a software dev consultancy with HQ in Cluj — most positions hybrid
    const workmode = "hybrid";

    jobs.push({ url, title: cleanTitle, workmode, location, tags: [] });
  });

  return { jobs, total: jobs.length };
}

// ============================================================================
// SCRAPING LOGIC - Single-page collection (no pagination)
// ============================================================================

/**
 * Scrapes all COERA job listings in a single GET to /careers/.
 * @param {boolean} _testOnlyOnePage - Ignored; signature kept for template compatibility
 * @returns {Promise<Array>}
 */
async function scrapeAllListings(_testOnlyOnePage = false) {
  console.log(`Fetching ${CAREER_URL}`);
  const html = await fetchJobsHtml();
  const { jobs, total } = parseHtmlJobs(html);
  console.log(`Found ${total} jobs`);

  const seen = new Set();
  const unique = [];
  for (const job of jobs) {
    if (!seen.has(job.url)) {
      seen.add(job.url);
      unique.push(job);
    }
  }
  console.log(`Total unique jobs collected: ${unique.length}`);
  return unique;
}

// ============================================================================
// DATA TRANSFORMATION - Preparing jobs for Solr storage
// ============================================================================

/**
 * Maps raw job data to Solr-compatible job model with timestamps and status
 * @param {Object} rawJob - Job object from scraper
 * @param {string} cif - Company identifier
 * @param {string} companyName - Company name
 * @returns {Object} - Job object ready for Solr storage
 */
function mapToJobModel(rawJob, cif, companyName = COMPANY_NAME) {
  const now = new Date().toISOString();

  const job = {
    url: rawJob.url,
    title: rawJob.title,
    company: companyName,
    cif: cif,
    location: rawJob.location?.length ? rawJob.location : undefined,
    tags: rawJob.tags?.length ? rawJob.tags : undefined,
    workmode: rawJob.workmode || undefined,
    date: now,
    status: "scraped"
  };

  // Remove undefined fields to keep payload clean
  Object.keys(job).forEach((k) => job[k] === undefined && delete job[k]);

  return job;
}

/**
 * Transforms jobs to match Solr schema and filters for Romanian locations
 * - Ensures company name is uppercase
 * - Filters locations to only Romanian cities
 * - Normalizes work mode values
 * @param {Object} payload - Job payload with jobs array
 * @returns {Object} - Transformed payload ready for Solr
 */
function transformJobsForSOLR(payload) {
  // List of Romanian cities for location validation
  // Includes both Romanian and English spellings with diacritics
  const romanianCities = [
    'Bucharest', 'București', 'Cluj-Napoca', 'Cluj Napoca',
    'Timișoara', 'Timisoara', 'Iași', 'Iasi', 'Brașov', 'Brasov',
    'Constanța', 'Constanta', 'Craiova', 'Bacău', 'Sibiu',
    'Târgu Mureș', 'Targu Mures', 'Oradea', 'Baia Mare', 'Satu Mare',
    'Ploiești', 'Ploiesti', 'Pitești', 'Pitesti', 'Arad', 'Galați', 'Galati',
    'Brăila', 'Braila', 'Drobeta-Turnu Severin', 'Râmnicu Vâlcea', 'Ramnicu Valcea',
    'Buzău', 'Buzau', 'Botoșani', 'Botosani', 'Zalău', 'Zalau', 'Hunedoara', 'Deva',
    'Suceava', 'Bistrița', 'Bistrita', 'Tulcea', 'Călărași', 'Calarasi',
    'Giurgiu', 'Alba Iulia', 'Slatina', 'Piatra Neamț', 'Piatra Neamt', 'Roman',
    'Dumbrăvița', 'Dumbravita', 'Voluntari', 'Popești-Leordeni', 'Popesti-Leordeni',
    'Chitila', 'Mogoșoaia', 'Mogosoaia', 'Otopeni'
  ];

  // Create lookup set for O(1) city validation
  const citySet = new Set(romanianCities.map(c => c.toLowerCase()));

  /**
   * Normalizes work mode strings to standard values
   * @param {string} wm - Raw work mode string
   * @returns {string|undefined} - Normalized work mode
   */
  const normalizeWorkmode = (wm) => {
    if (!wm) return undefined;
    const lower = wm.toLowerCase();
    if (lower.includes('remote')) return 'remote';
    if (lower.includes('office') || lower.includes('on-site') || lower.includes('site')) return 'on-site';
    return 'hybrid';
  };

  // Transform the payload
  const transformed = {
    ...payload,
    company: payload.company?.toUpperCase(), // Solr convention: uppercase company names
    jobs: payload.jobs.map(job => {
      // Filter locations to only include valid Romanian cities
      // Also accept generic "Romania" or "România" as valid
      const validLocations = (job.location || []).filter(loc => {
        const lower = loc.toLowerCase().trim();
        if (lower === 'romania' || lower === 'românia') return true;
        return citySet.has(lower);
      }).map(loc => loc.toLowerCase() === 'romania' ? 'România' : loc);

      return {
        ...job,
        location: validLocations.length > 0 ? validLocations : ['România'], // Default to Romania if no city match
        workmode: normalizeWorkmode(job.workmode)
      };
    })
  };

  return transformed;
}

// ============================================================================
// MAIN ORCHESTRATION - Coordinates the entire scraping workflow
// ============================================================================

/**
 * Main function that orchestrates the complete scraping workflow:
 * 1. Check existing jobs in Solr
 * 2. Validate company via ANAF
 * 3. Scrape jobs from COERA endpoint
 * 4. Transform data for Solr
 * 5. Upsert jobs to Solr
 * 6. Report summary
 */
async function main() {
  // Check for --test flag to run in test mode (single page only)
  const testOnlyOnePage = process.argv.includes("--test");
  
  try {
    // Ensure tmp/ directory exists (for jobs.json and company.json backups)
    fs.mkdirSync("tmp", { recursive: true });
    // Step 1: Get count of existing jobs in Solr for comparison
    console.log("=== Step 1: Get existing jobs count ===");
    const existingResult = await querySOLR(COMPANY_CIF);
    const existingCount = existingResult.numFound;
    console.log(`Found ${existingCount} existing jobs in SOLR`);
    console.log("(Keeping existing jobs - will upsert COERA jobs only)");

    // Step 2: Validate company data via ANAF (ensures we have correct company info)
    console.log("=== Step 2: Validate company via ANAF ===");
    const { company, cif, address } = await validateAndGetCompany();
    COMPANY_NAME = company;
    const localCif = cif;

    // Upsert company to SOLR company core with full address from ANAF
    try {
      await upsertCompany({
        id: cif,
        company,
        brand: companyConfig.brand,
        status: "activ",
        location: address ? [address] : [companyConfig.defaultLocation],
        website: [companyConfig.website],
        career: [companyConfig.careerUrl],
        lastScraped: new Date().toISOString().split('T')[0],
        scraperFile: companyConfig.scraperFile
      });
    } catch (err) {
      console.log(`Note: Could not upsert company to SOLR core: ${err.message}`);
    }
    
    // Step 3: Scrape all jobs from co-era.com/careers
    const rawJobs = await scrapeAllListings(testOnlyOnePage);
    const scrapedCount = rawJobs.length;
    console.log(`📊 Jobs scraped from COERA careers website: ${scrapedCount}`);

    // Step 4: Map raw jobs to Solr model with CIF and company name
    const jobs = rawJobs.map(job => mapToJobModel(job, localCif));

    // Create payload with metadata
    const payload = {
      source: "co-era.com",
      scrapedAt: new Date().toISOString(),
      company: COMPANY_NAME,
      cif: localCif,
      jobs
    };

    // Step 5: Transform jobs (filter locations, normalize values)
    console.log("Transforming jobs for SOLR...");
    const transformedPayload = transformJobsForSOLR(payload);
    const validCount = transformedPayload.jobs.filter(j => j.location).length;
    console.log(`📊 Jobs with valid Romanian locations: ${validCount}`);

    // Save transformed jobs to file (for debugging/backup)
    fs.writeFileSync("tmp/jobs.json", JSON.stringify(transformedPayload, null, 2), "utf-8");
    console.log("Saved tmp/jobs.json");

    // Generate and save docs/jobs.md
    const companyData = {
      id: localCif,
      company: transformedPayload.company,
      brand: companyConfig.brand,
      status: "activ",
      location: address ? [address] : [companyConfig.defaultLocation],
      website: [companyConfig.website],
      career: [companyConfig.careerUrl],
      lastScraped: new Date().toISOString().split('T')[0]
    };
    const markdown = generateJobsMarkdown(companyData, transformedPayload.jobs);
    fs.mkdirSync("docs", { recursive: true });
    fs.writeFileSync("docs/jobs.md", markdown, "utf-8");
    console.log("Saved docs/jobs.md");

    // Publish a copy of company config for the static HTML to consume
    fs.writeFileSync("docs/company.json", JSON.stringify(companyConfig, null, 2), "utf-8");
    console.log("Saved docs/company.json");

    // Step 6: Upsert all jobs to Solr (add/update)
    console.log("\n=== Step 6: Upsert jobs to SOLR ===");
    await upsertJobs(transformedPayload.jobs);

    // Step 7: Verify final count in Solr
    const finalResult = await querySOLR(COMPANY_CIF);
    console.log(`\n📊 === SUMMARY ===`);
    console.log(`📊 Jobs existing in SOLR before scrape: ${existingCount}`);
    console.log(`📊 Jobs scraped from COERA: ${scrapedCount}`);
    console.log(`📊 Jobs in SOLR after scrape: ${finalResult.numFound}`);
    console.log(`====================`);

    console.log("\n=== DONE ===");
    console.log("Scraper completed successfully!");

  } catch (err) {
    console.error("Scraper failed:", err);
    process.exit(1);
  }
}

// Export functions for testing
export { parseHtmlJobs, mapToJobModel, transformJobsForSOLR };

// Run main function when executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
