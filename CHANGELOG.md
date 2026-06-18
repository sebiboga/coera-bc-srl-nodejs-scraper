# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-06-18

### Added
- Initial release — derived from [EPAM template](https://github.com/sebiboga/epam-systems-international-srl-nodejs-scraper) (v1.5.0)
- HTML scraping for COERA BC SRL (CIF 32519996) at https://www.co-era.com/careers/
- Selector `a.careerButton`, title from `title` attribute (with "| City1 & City2" suffix stripped)
- City extraction from title suffix (Cluj, Brașov, etc.)
- Default location `Cluj-Napoca` (COERA HQ), default workmode `hybrid`
- All template features inherited: `config/company.json` single source of truth, 7-day ANAF cache, `docs/jobs.md` generation, 4-layer test suite, daily scheduled scraping, GitHub Pages dashboard

## License

Copyright (c) 2026 BOGA SEBASTIAN-NICOLAE
Licensed under MIT License
