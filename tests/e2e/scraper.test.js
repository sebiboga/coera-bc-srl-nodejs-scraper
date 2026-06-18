import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import companyConfig from '../../config/company.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

const HAS_SOLR = !!process.env.SOLR_AUTH;
function itIfSolr(name, fn, timeout) {
  if (HAS_SOLR) return it(name, fn, timeout);
  return it.skip(`${name} (skipped: SOLR_AUTH not set)`, fn, timeout);
}

const TEST_CIF = companyConfig.cif;
const CAREERS_URL = companyConfig.careerUrl;

describe('E2E: COERA scraping pipeline', () => {
  describe('co-era.com/careers — real HTML fetch', () => {
    let html;
    let index;

    beforeAll(async () => {
      const res = await fetch(CAREERS_URL, {
        headers: { 'User-Agent': 'job_seeker_ro_spider', 'Accept': 'text/html' }
      });
      expect(res.ok).toBe(true);
      html = await res.text();
      index = await import('../../index.js');
    }, 60000); // Pitfall #5 — RO sites slow from Azure runners

    it('contains at least one careerButton anchor', () => {
      expect(html).toMatch(/class=["'][^"']*careerButton[^"']*["']/);
    });

    it('parses at least one job with expected shape', () => {
      const { jobs, total } = index.parseHtmlJobs(html);
      expect(total).toBeGreaterThan(0);
      const sample = jobs[0];
      expect(sample.url.startsWith('https://www.co-era.com')).toBe(true);
      expect(sample.title.length).toBeGreaterThan(0);
      expect(sample.workmode).toBe('hybrid');
      expect(Array.isArray(sample.location)).toBe(true);
      expect(sample.location.length).toBeGreaterThan(0);
    });
  });

  describe('Job model mapping', () => {
    it('maps a scraped job to the SOLR model with required fields', async () => {
      const index = await import('../../index.js');
      const raw = {
        url: 'https://www.co-era.com/careers/test-position/',
        title: 'Test Position',
        location: ['Cluj-Napoca'],
        workmode: 'hybrid',
        tags: []
      };
      const mapped = index.mapToJobModel(raw, TEST_CIF, 'COERA BC SRL');
      expect(mapped.url).toBe(raw.url);
      expect(mapped.cif).toBe(TEST_CIF);
      expect(mapped.company).toBe('COERA BC SRL');
      expect(mapped.status).toBe('scraped');
      expect(mapped.date).toBeDefined();
    });
  });

  describe('Transform for SOLR', () => {
    it('uppercases company name and keeps Romanian city', async () => {
      const index = await import('../../index.js');
      const payload = {
        source: 'co-era.com',
        company: 'coera bc srl',
        cif: TEST_CIF,
        jobs: [
          { url: 'https://www.co-era.com/careers/a/', title: 'A', location: ['Cluj-Napoca'], workmode: 'hybrid' }
        ]
      };
      const result = index.transformJobsForSOLR(payload);
      expect(result.company).toBe('COERA BC SRL');
      expect(result.jobs[0].location).toEqual(['Cluj-Napoca']);
      expect(result.jobs[0].workmode).toBe('hybrid');
    });
  });
});
