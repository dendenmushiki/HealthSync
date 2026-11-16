# Adolescent BMI-for-age reference

`who2007-bmi-for-age.json` is derived from the official WHO 2007 BMI-for-age expanded Z-score Excel references for girls and boys, linked from the [WHO BMI-for-age (5–19 years) page](https://www.who.int/tools/growth-reference-data-for-5to19-years/indicators/bmi-for-age):

- [Girls BMI-for-age Z-score workbook](https://cdn.who.int/media/docs/default-source/child-growth/growth-reference-5-19-years/bmi-for-age-(5-19-years)/bmi-girls-z-who-2007-exp.xlsx?sfvrsn=79222875_2)
- [Boys BMI-for-age Z-score workbook](https://cdn.who.int/media/docs/default-source/child-growth/growth-reference-5-19-years/bmi-for-age-(5-19-years)/bmi-boys-z-who-2007-exp.xlsx?sfvrsn=a84bca93_2)

Each sex-specific table contains monthly WHO `L`, `M`, and `S` values, plus the BMI values at -3, -2, +2, and +3 SD, for ages 61–228 completed months. Data is bundled locally so previews work without a database seed or an internet connection. WHO's expanded tables, rather than the former sparse hand-authored points, are the source of every stored reference value.

The service calculates BMI in kg/m², applies the LMS equation, and follows the WHO expanded-table linear adjustment outside ±3 SD. It rejects scores outside the WHO plausible BMI-for-age range (-5 to +5), missing sex/reference data, and ages outside the bundled grid. Classifications follow WHO 5–19 BMI-for-age boundaries: below -3 SD severe thinness, below -2 SD thinness, through +1 SD normal, above +1 SD overweight, and above +2 SD obesity. The recorded age is completed calendar months at the assessment date; date-only values are handled as calendar dates to avoid timezone shifts.

No runtime package, migration, or remote API is required. Existing `who_bmi_for_age_ref` rows are no longer used for calculation; the legacy population script now derives its expanded reference points from the same WHO dataset and does not overwrite an already-populated table.
