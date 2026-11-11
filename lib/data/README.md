`philippine-places.json` is a bundled province → city/municipality list extracted
from the PSA PSGC June 2026 snapshot distributed by
https://github.com/Tenasia/ph-psgc/tree/2026-Q2/psgc (PSA source:
https://psa.gov.ph/classification/psgc).

Only province and city/municipality names are retained. Independent cities and
NCR municipalities have no PSGC province and are explicitly grouped under their
region name for the province selector. No runtime network requests are made.

To refresh, read `psgc/index.json`, fetch each province's
`psgc/areas/{code}.json` and retain its `cities[].name`; append each region's
`independent[].name` under that region's name. Sort province keys for stable diffs.
