# Offline nutrition reference data

These JSON files are copied verbatim from the backend calculation references so the browser uses the same rows and calculations while offline:

- `who2006-growth-standards.json` is derived from the WHO-maintained `WorldHealthOrganization/anthro` package at commit `b776d8a12b1c97369c748b561159fd2ec4f4db58`. Its source documentation is in `backend/src/services/nutrition/WHO-CHILD-GROWTH-STANDARDS.md`. The upstream GPL-3.0 license is included in `frontend/public/licenses/WHO-ANTHRO-LICENSE.txt`.
- `who2007-bmi-for-age.json` contains the expanded sex-specific monthly BMI-for-age references from the official WHO 2007 tables for ages 61–228 completed months. Its source and calculation notes are in `backend/src/services/nutrition/WHO-ADOLESCENT-BMI-REFERENCE.md`.

The backend and frontend copies must remain byte-identical. Update both together and run the backend and frontend nutrition regression tests when reference data changes.
