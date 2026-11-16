# Operation Timbang reference and calculation

`who2006-growth-standards.json` contains the LMS tables used by the Operation Timbang service. Its documented origin is the WHO-maintained [`WorldHealthOrganization/anthro`](https://github.com/WorldHealthOrganization/anthro) package's `R/sysdata.rda` at commit `b776d8a12b1c97369c748b561159fd2ec4f4db58` (package version 1.1.0.9000). The source objects are `growthstandards_weianthro`, `growthstandards_lenanthro`, `growthstandards_wflanthro`, and `growthstandards_wfhanthro`. The WHO Child Growth Standards and WHO Anthro software pages describe the standards and their intended use: [WHO Child Growth Standards](https://www.who.int/tools/child-growth-standards/standards) and [WHO Anthro software](https://www.who.int/tools/child-growth-standards/software). The upstream package is GPL-3.0; the accompanying `WHO-ANTHRO-LICENSE.txt` contains its license.

The WHO-maintained Anthro source was checked at the documented immutable commit for the LMS calculation, extreme-score adjustment, day-based reference selection, and length/height standardization. In particular, `R/z-score-helper.R` specifies the LMS equation and adjusted calculation outside +/-3 SD, states that length is used through day 730 and height from day 731, and adds/subtracts 0.7 cm when the recorded method differs. `R/z-score-weight-for-lenhei.R` specifies interpolation between adjacent 0.1 cm rows and the supported ranges. This source-code check supports the corresponding algorithm and range conventions implemented here.

The local JSON was compared row-by-row and parameter-by-parameter to those four objects in `R/sysdata.rda` downloaded from the pinned commit. All LMS values matched exactly (absolute tolerance 1e-12; zero mismatches): WFA and HFA each contain 1,827 rows per sex, WFL 651 rows per sex, and WFH 551 rows per sex. Upstream numeric sex values 1 and 2 map to local `male` and `female` respectively. Age arrays are ordered 0 through 1826 days; WFL rows cover 45.0-110.0 cm and WFH rows 65.0-120.0 cm in 0.1 cm steps. Source RData SHA-256: `e021d51a1e95237e141d7c85382887997d62c8ccd092a791c8fad003d7a5e7c7`; local JSON SHA-256: `0e7a263d963d18a1aece6bff7abeb1d6af3b6b338f9866ba719ba80978a502aa`.

The numerical tests also use published regression expectations from the same pinned WHO Anthro source: female WAZ at age 1,522 days, 17 kg rounds to 0.24 (`tests/testthat/test-zscore-weight-for-age.R`); male length-for-age at day 44 and length 50 cm rounds to -3.29 (`tests/testthat/test-zscore-length-for-age.R`). The local service matches both. These are comparisons against WHO Anthro's published test expectations, not an execution of the WHO R package or standalone WHO Anthro executable. Its R test suite itself was not run here.

The embedded arrays preserve the upstream L, M, and S values without synthesizing missing rows. Weight-for-age and length/height-for-age references are indexed by sex and rounded age in days, 0 through 1826. Weight-for-length references cover 45.0-110.0 cm and weight-for-height references cover 65.0-120.0 cm, at 0.1 cm increments.

The backend calculates WAZ, HAZ, and WHZ independently using the exact date of measurement and the child's date of birth. Age in days selects WHO reference rows (rounded to a day); the under-five eligibility check uses days divided by 30.4375 and completed calendar months. Invalid/impossible dates, future birthdates or measurement dates, and measurements before birth are rejected. Dates are treated as calendar dates, not local timestamps; the form uses `Asia/Manila` for its current-date bound. Age shown in the form is completed calendar months and the backend returns the same completed-month value.

The backend retains full precision for each Z-score and uses that value for classification. The form rounds to two decimal places only for presentation. Live MySQL inspection found `DECIMAL(5,2)` score columns, which would truncate the added precision on persistence. A backward-compatible precision-widening migration is provided at `backend/src/scripts/migrateOperationTimbangZScorePrecision.sql`. It has not been applied. Existing stored values remain at their already-rounded precision; the migration cannot reconstruct precision lost previously.

The National Nutrition Council/Department of Health *Manual of Operations and Data Quality Check Protocol: Operation Timbang Plus*, supplied locally as `docs/OPTPLU2.pdf`, was examined. Section 3, Table 3.3 (printed p. 181; PDF p. 182) gives these boundaries: below -3 SD is severe; >= -3 and < -2 is moderate; >= -2 and <= +2 is normal; > +2 and <= +3 is overweight; > +3 is obesity. It lists underweight categories for WFA, stunting/tall for L/HFA, and wasting/overweight/obesity for WFL/H. Section 1 definitions (printed pp. 20-22) identify WFA as the underweight indicator, WFL for children 0-23 months, and WFH for ages 24-59 months. The implementation now uses the table's indicator-specific thresholds and labels: “Moderately underweight,” “Moderately stunted,” and “Moderately wasted,” replacing generic category names; WAZ's former “High weight-for-age” is replaced by the Table 3.3 overweight and obesity categories. No combined overall status is inferred.

The manual title page credits the National Nutrition Council, Department of Health, UNICEF, and UPLB partners. The preface calls it revised/improved guidance, but no numbered edition or publication date was found in the inspected front matter. The PDF metadata creation date is 2023-12-18 and is not treated as a publication date. The official NNC-hosted URL is https://nnc.gov.ph/wp-content/uploads/OPTPLU2.pdf; it returned HTTP 403 during this review, so this verification used the supplied local copy. Since Table 3.3 explicitly includes overweight/obesity categories in its WFA row, an authorized local nutrition professional should confirm that interpretation for the intended reporting workflow before deployment, particularly in light of the limits of WAZ as a standalone measure of excess weight.

The regression tests cover date validation, age boundaries, measurement standardization, sex selection, threshold boundaries, and precision. Tests using reference-table medians are internal consistency checks, not independent expected-value verification. Run them with Node's built-in test runner:

```powershell
cd backend
node --test tests/operationTimbang.test.js
```

Before applying the precision migration, back up the database and confirm the live definitions using these read-only MySQL checks:

```sql
SHOW CREATE TABLE residents;
SHOW CREATE TABLE operation_timbang;
SHOW CREATE TABLE operation_timbang_assessments;

SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, NUMERIC_PRECISION, NUMERIC_SCALE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('residents', 'operation_timbang', 'operation_timbang_assessments')
ORDER BY TABLE_NAME, ORDINAL_POSITION;

SELECT sex, COUNT(*) AS resident_count
FROM residents
GROUP BY sex;

SELECT COUNT(*) AS measurements_before_birth
FROM operation_timbang ot
JOIN residents r ON r.resident_id = ot.resident_id
WHERE ot.date_recorded < r.birthdate;
```

The observed local schema uses `DATE` for birthdate and measurement date, nullable `ENUM('male','female')` for sex, `DECIMAL(5,1)` kg/cm measurements, and `DECIMAL(5,2)` Z-scores. `operation_timbang` references residents and users; assessments reference measurements. Tables use InnoDB. The local aggregate data check found two records dated before the linked birthdate and one assessment with all three scores missing; review these records through authorized data-quality procedures rather than correcting them by assumption. The runtime database connection was authenticated as `root@localhost`; avoid using a globally privileged account for normal application access.

The live MySQL connection was available only when running from the backend directory, because `dotenv` loads `.env` relative to the process working directory. A root-directory launch loaded no database password and reproduced `ER_ACCESS_DENIED_ERROR`; from `backend`, the local connection succeeded as `root@localhost`. That account has global administrative privileges and is not suitable for normal application use. Database schema facts and the unapplied precision migration are described above.

The review found that the older saved category strings may differ from the corrected OPT Plus terms. No stored assessments or historical statuses were changed. A controlled, authorized migration/reassessment plan is needed before dashboard and report aggregates can avoid mixing legacy and updated status labels.

Do not use generated seed assessments as real records: demo residents are identified with a `SEED-DEMO-` household number and a `DEMO` name prefix; seed assessments are generated by the production OPT Plus calculation service from synthetic reference-median measurements.
