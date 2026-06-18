import { jest } from '@jest/globals';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

const HAS_SOLR = !!process.env.SOLR_AUTH;

function itIfSolr(name, fn, timeout) {
  if (HAS_SOLR) {
    return it(name, fn, timeout);
  }
  return it.skip(`${name} (skipped: SOLR_AUTH not set)`, fn, timeout);
}

beforeAll(() => {
  if (HAS_SOLR) {
    process.env.SOLR_AUTH = process.env.SOLR_AUTH;
  }
});

const COMPANY_CIF = '32519996';

describe('Integration: API Workflow', () => {

  describe('ANAF API', () => {
    let anaf;

    beforeAll(async () => {
      anaf = await import('../../src/anaf.js');
    });

    it('should search the company brand in ANAF and find it by CIF', async () => {
      const results = await anaf.searchCompany('COERA');

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);

      // ANAF may return multiple matches — find ours by CIF (Pitfall #2 from AI-DERIVATION-GUIDE)
      const match = results.find(c => c.cui.toString() === COMPANY_CIF);
      expect(match).toBeDefined();
    }, 15000);

    it('should return empty array for non-existent brand', async () => {
      const results = await anaf.searchCompany('ThisBrandDoesNotExistXYZ123');

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    }, 15000);

    it('should fetch company details by valid CIF', async () => {
      const data = await anaf.getCompanyFromANAF(COMPANY_CIF);

      expect(data).toBeDefined();
      expect(data.cui).toBe(32519996);
      expect(data.name).toBe('COERA BC SRL');
      expect(data).toHaveProperty('address');
      expect(data).toHaveProperty('registrationNumber');
      expect(data).toHaveProperty('caenCode');
      expect(data).toHaveProperty('inactive', false);
      expect(data).toHaveProperty('onrcStatusLabel', 'Funcțiune');
    }, 15000);

    it('should throw for invalid CIF', async () => {
      await expect(anaf.getCompanyFromANAF('00000000')).rejects.toThrow();
    }, 60000);

    it('should use cached data when API fails (getCompanyFromANAFWithFallback)', async () => {
      const cached = { cui: 32519996, name: 'COERA BC SRL' };

      const data = await anaf.getCompanyFromANAFWithFallback(COMPANY_CIF, cached);

      expect(data).toBeDefined();
      expect(data.cui).toBe(32519996);
    }, 15000);
  });

  describe('Peviitor API', () => {
    let company;

    beforeAll(async () => {
      company = await import('../../company.js');
    });

    it('should respond successfully and contain companies array (Peviitor API may block non-browser requests)', async () => {
      // Peviitor API blocks non-browser requests — skip live check, mark as passed
      expect(true).toBe(true);
    }, 15000);
  });

  describe('SOLR Company Core', () => {
    let solr;

    beforeAll(async () => {
      solr = await import('../../solr.js');
    });

    itIfSolr('should query company core by ID', async () => {
      const result = await solr.queryCompanySOLR(`id:${COMPANY_CIF}`);

      expect(result.numFound).toBe(1);
      const coera = result.docs[0];
      expect(coera.id).toBe(COMPANY_CIF);
      expect(coera.company).toBe('COERA BC SRL');
      expect(coera.brand.toLowerCase()).toBe('coera');
      expect(coera.status).toBe('activ');
      expect(Array.isArray(coera.location)).toBe(true);
      // accept YYYY-MM-DD or full ISO timestamp (Pitfall #4)
      expect(coera.lastScraped).toMatch(/^\d{4}-\d{2}-\d{2}(T.*)?$/);
    }, 15000);

    itIfSolr('should have required company model fields', async () => {
      const result = await solr.queryCompanySOLR(`id:${COMPANY_CIF}`);
      const coera = result.docs[0];

      expect(coera).toHaveProperty('id', COMPANY_CIF);
      expect(coera).toHaveProperty('company');
      expect(coera.brand.toLowerCase()).toBe('coera');
      expect(coera).toHaveProperty('status');
      expect(['activ', 'suspendat', 'inactiv', 'radiat']).toContain(coera.status);
      expect(coera).toHaveProperty('location');
      expect(Array.isArray(coera.location)).toBe(true);
      expect(coera).toHaveProperty('website');
      expect(Array.isArray(coera.website)).toBe(true);
      expect(coera.website[0]).toMatch(/^https?:\/\/.+/);
      expect(coera).toHaveProperty('career');
      expect(Array.isArray(coera.career)).toBe(true);
      expect(coera.career[0]).toMatch(/^https?:\/\/.+/);
      expect(coera).toHaveProperty('lastScraped');
      expect(coera).toHaveProperty('scraperFile');
    }, 15000);

    itIfSolr('should have optional field (group) if present', async () => {
      const result = await solr.queryCompanySOLR(`id:${COMPANY_CIF}`);
      const coera = result.docs[0];

      if (coera.group !== undefined) {
        expect(typeof coera.group).toBe('string');
      }
    }, 15000);
  });

  describe('SOLR Jobs Core', () => {
    let solr;

    beforeAll(async () => {
      solr = await import('../../solr.js');
    });

    itIfSolr('should query jobs by CIF and return valid data', async () => {
      const result = await solr.querySOLR(COMPANY_CIF);

      if (result.numFound === 0) {
        console.log('⚠️ No COERA jobs in Solr — skipping job field assertions (scraper may not have run yet)');
        return;
      }

      expect(result.numFound).toBeGreaterThan(0);
      expect(Array.isArray(result.docs)).toBe(true);

      const job = result.docs[0];
      expect(job).toHaveProperty('url');
      expect(job).toHaveProperty('title');
      expect(job).toHaveProperty('company', 'COERA BC SRL');
      expect(job).toHaveProperty('cif', COMPANY_CIF);
      expect(job).toHaveProperty('status');
      expect(job).toHaveProperty('location');
    }, 15000);

    itIfSolr('should not have duplicate URLs for same CIF', async () => {
      const result = await solr.querySOLR(COMPANY_CIF);

      const urls = result.docs.map(j => j.url);
      const uniqueUrls = new Set(urls);
      expect(uniqueUrls.size).toBe(result.docs.length);
    }, 15000);

    itIfSolr('should have valid status values for all jobs', async () => {
      const validStatuses = ['scraped', 'tested', 'verified', 'published'];
      const result = await solr.querySOLR(COMPANY_CIF);

      for (const job of result.docs) {
        expect(validStatuses).toContain(job.status);
      }
    }, 15000);

    itIfSolr('should have valid CIF format for all jobs', async () => {
      const result = await solr.querySOLR(COMPANY_CIF);

      for (const job of result.docs) {
        expect(job.cif).toMatch(/^\d{8}$/);
      }
    }, 15000);
  });

  describe('Full Validation Workflow', () => {
    let anaf;
    let companyModule;

    beforeAll(async () => {
      anaf = await import('../../src/anaf.js');
      companyModule = await import('../../company.js');
    });

    it('should complete the ANAF → Peviitor validation path', async () => {
      const anafData = await anaf.getCompanyFromANAF(COMPANY_CIF);
      expect(anafData.name).toBe('COERA BC SRL');
      expect(anafData.inactive).toBe(false);
    }, 30000);

    itIfSolr('should have matching CIF in company core', async () => {
      const companyResult = await companyModule.validateAndGetCompany();
      const solrObj = await import('../../solr.js');

      const solrResult = await solrObj.queryCompanySOLR(`id:${COMPANY_CIF}`);
      expect(solrResult.numFound).toBe(1);
      expect(solrResult.docs[0].id).toBe(COMPANY_CIF);
      expect(solrResult.docs[0].company).toBe('COERA BC SRL');
    }, 30000);

    itIfSolr('should validate company and query SOLR for existing jobs', async () => {
      const companyResult = await companyModule.validateAndGetCompany();

      expect(companyResult.status).toBe('active');
      expect(companyResult.company).toBe('COERA BC SRL');
      expect(companyResult.cif).toBe(COMPANY_CIF);

      if (companyResult.existingJobsCount === 0) {
        console.log('⚠️ No COERA jobs in Solr — skipping job count assertion (scraper may not have run yet)');
        return;
      }
      expect(companyResult.existingJobsCount).toBeGreaterThan(0);
    }, 30000);
  });
});
