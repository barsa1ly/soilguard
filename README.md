# SoilGuard

SoilGuard is a free, mobile-friendly web app for a field or any point you pick: wind-erosion risk and a control plan, the soil profile, soil-chemistry maps (pH, salinity, sodicity, CEC, organic matter, total nutrients), drought now and since 2000, and model-ready soil and weather files. It covers **Texas** now; the other states come later. Every source is free and open, read directly from the agency that makes it, and credited below. Live site: <https://barsa1ly.github.io/soilguard/>.

Tap the map, search a place, use GPS, or type coordinates. Points outside Texas are refused for now, and so are map clicks on a building, a road or water; the state button lists the other states as “(later)”. Search suggests towns, cities and counties as you type ("Tem" lists Temple, TX and the other Temples); press Enter to search a street address. The area tool analyses a whole field or ranch instead of one point. The app then pulls the soil survey, 10 years of hourly wind and the land cover for that point. It shows the risk, the wind-prone months, the full soil profile, the soil's chemistry by depth, drought at the point, and practices matched to the land use you choose.

**Coming:** runoff and soil loss by basin (NHDPlus HR) and soil moisture.

## Run it

It is a static site with no build step and no API keys. Serve the folder with any web server:

```bash
python -m http.server 8765
```

Then open <http://localhost:8765>. Opening `index.html` straight from disk also works in most browsers, but a server is more reliable. To link straight to a location, use `?lat=32.74&lon=-101.95`; add `&map=drought` or `&map=soilmaps` to open on that theme. Add `&from=2024-01-01&to=2024-12-31` (or `&period=5` or `&period=20`) for the wind period and `&model=ecmwf` for ECMWF wind; the address keeps both as you change them, so a copied link gives the same point, period and model (the erosive threshold and wind source are not in it).

To put it on a phone, host the folder on any static host (GitHub Pages, Netlify, S3), open it on the phone, and choose "Add to Home Screen". Wrapping it as a store app later (Capacitor/Cordova) needs no code changes.

**Which states a visitor can choose.** `js/config.js` sets `WG.config = { name: "SoilGuard", live: ["TX"] }`. `live` lists the states that can be chosen, searched into and clicked; the others are shown as “(later)”. The code and the data keep every state, so a state is opened by adding its code (`["TX", "OK"]`), and `null` opens all 48 contiguous states and DC.

## What it shows

| Tab | Content |
|---|---|
| Map themes | The bar under the search box, and the layer sheet, choose what the map shows: **Wind erosion** (the statewide erosion overlays), **Drought** (U.S. Drought Monitor this week, a year ago, five years ago or any week since 2000; monthly and seasonal drought outlooks) or **Soil maps** (pH, CEC and organic matter at four depths, salinity, sodicity, ten total elements and total nitrogen). Each overlay comes from the agency that makes it, with its own legend. **A past week:** a bar on the map steps through the Drought Monitor's weeks since 2000 or plays them one after another, and the Drought tab sends its chosen weeks there (a click on a chart). The theme also sets the panel's tabs, and `&map=drought` (or `soilmaps`) in the link opens on it. |
| Drought | This week's Drought Monitor class at the point and the drought outlooks; the Drought Monitor's class at the point for every week since 4 January 2000, shown over the last 2, 5 or 10 years or since 2000 (from Esri's Living Atlas copy of the weekly maps, and NDMC's own maps for any week it lacks; about 10 s since 2000; weeks read are kept in the browser for the last 60 locations); drought between years from gridMET Drought since 1980 (SPEI or SPI over 30 days to 5 years, or the Palmer index): the record coloured by Drought Monitor class, chosen years against each other, and each year's share in drought. |
| Soil maps | What each source says at the point: SSURGO chemistry by depth and horizon (pH, EC, SAR, ESP, CEC, base saturation, organic matter, CaCO₃, gypsum) with reaction, salinity and sodic classes; the 30 m gNATSGO values at the cell; SoilGrids total nitrogen; the 3 nearest USGS DS-801 sites (total elements); the 8 nearest NRCS KSSL lab pedons (measured K, Ca, Mg, Na, P, N, S). Each table downloads as CSV. Survey values describe typical soil, not a soil test, and total elements are not plant-available. |
| DOWNLOAD data for models | A tab with a down arrow in every theme: the soil and weather files for crop and watershed models, tables and series (below). |
| Map | Only the chosen states are shown (Texas for now; the code and data hold every state, opened through `js/config.js`): everything outside them is covered and can't be panned to, and `&states=KS,OK,TX` in the link opens the same states (`&states=US` the whole US). Each state's file loads only when the state is chosen, and its statewide maps only as the map comes near it. Every state has its statewide erosion maps; where SSURGO gives a county no usable climatic factor C (none in 16 states, some counties in 19 more), C is estimated from NASA POWER, and the legend names the states and the share of their area (above six such states, their number). The Practices tab gives every state its own plan (Texas from Texas sources, the others from their NRCS technical guides). Satellite imagery (Esri), with switchable USGS imagery+topo, OpenStreetMap streets and USGS topo bases. Overlays: place, river and county names; roads and street names; NHD rivers and streams; county lines (U.S. Census TIGER, on by default, exact at every zoom); statewide susceptibility, soil Wind Erodibility Group and climatic factor C; NLCD 2021 land cover; SSURGO map-unit lines at zoom 13+ (off by default). |
| Overview | Bare-soil risk (WEQ E = I × C/100) in t/ac/yr, with the five risk classes shown under it and this site's class lit; erodibility index C·I/T; mean wind; erosive-wind hours; prevailing erosive direction; Wind Erodibility Group (nine classes from 1, most erodible, to 8, not erodible), with I (0–310); climatic factor C (Garden City, KS = 100; official values 1–300, Texas 4–150; marked ≈ where it is an estimate); land cover; and a 12-month risk strip (red = high-risk months, ranked when the period covers all 12 months). Each score shows its scale or range. |
| Wind | Seasonal erosive-wind hours (red/amber/gray by risk), wind and gust climatology, gust days, erosive wind rose with the resultant soil-transport direction, precipitation vs ET₀, year-to-year trend with significance test, and indices (Fryberger drift potential, FAO climatic index, barrier orientation). You can switch the wind source (calibrated to the nearest airport, airport only, or gridded model only), the gridded model (NASA MERRA-2 directly by default, or ECMWF via Open-Meteo), the calibration station, the period (the last 5, 10 or 20 complete years, or your own dates: 30 days or more inside the model's record, with 20 or more in one calendar month), units and erosive threshold. A comparison card shows the reanalysis against the airport station. |
| Soil | Dominant SSURGO component and map unit, and an editable surface layer (sand, silt, clay, OM, CaCO₃, pH) that recalculates texture class, WEG and I, RWEQ erodible fraction and crust factor, and water properties (Saxton & Rawls 2006). The **+** expander opens the full profile: horizons with texture, bulk density, LL/DUL/SAT, AWC, Ksat, pH, CEC, CaCO₃, gypsum, EC, SAR, coarse fragments, root growth factor, estimated N; plus classification, slope (survey and USGS 3DEP), restrictive layer, drainage rate, runoff curve number, albedo, evaporation limit, T and Kw factors, capability class, components, crop yields and the reference plant community. Exports to CSV and to a crop-model `.SOL` file. A table explains the nine Wind Erodibility Groups (1 most erodible to 8 not erodible, with each group's I and NRCS's texture guide) and marks this soil's group; the app labels a soil's group by number and I, because a survey's group can differ from what the soil's texture alone suggests (Pullman clay loam is WEG 7). |
| Methods sheet | The page icon on the map, or the links under each result, opens a sheet listing which source supplied each value at this location, the scale and classes of every number (with the full NRCS definitions of the Wind Erodibility Groups), the full data-source catalog, and every equation with its terms, units and reference. |
| Area tool | The polygon button on the map. Draw a field or upload a boundary (zipped shapefile, .shp + .dbf + .prj, .kml, .kmz or .geojson; any size: boundaries over about 500 km² are read in tiles, and the time grows with the area, with a progress bar and Cancel). The panel shows total and analysed acres, the share and acres in each Wind Erodibility Group and bare-soil risk class (E = I × C / 100), area-weighted mean I and E, and the soil map units, with buildings, roads and water left out. Soil map units are coloured by WEG on the map. CSV export, and **Make a grid of this area**: cells from 20 cm up (square, turned by an angle, hexagons, or your own grid file), each holding the soil at the depths you choose and the weather, as a GeoTIFF, shapefile, GeoJSON or CSV. Cells are laid out in UTM (the area's zone or one you pick, on WGS 84 or NAD83), CONUS Albers or Web Mercator; the shapefile and CSV can be in that system, WGS 84 or NAD83 longitude and latitude, Web Mercator, or any system you paste as a proj4 definition (with its .prj if you have it), each with a .prj that QGIS and ArcGIS read. GeoJSON is always WGS 84; the GeoTIFF stays in the layout's system. Finer cells line up with a grid you already have; they add no detail, as the sources are coarser. The sheet lists the steps (draw or upload, make a grid, choose, **Build and preview**, **Download the zip**) and says before Build what it will read and roughly how long; a progress bar shows each step with counts, and Cancel stops it. After Build the Download section lists the zip's files and sizes; the files ticked can change without building again. gridMET is read for all weather cells at once (9 requests), so 9 weather cells over 10 years take about 5 s; a weather cell that does not answer is tried again, then left blank and named, with the reason, in the status and README instead of failing the build (when no weather cell answers, Build stops and says why). The weather can also be your own daily file, one for the whole area. **Data for models** writes the data sheet's model files (DSSAT, SWAT+, EPIC, APEX, APSIM, AquaCrop, CENTURY, DayCent, plain CSV) once for each soil (each map unit's main soil, or its soils weighted by their %) and each weather cell, not for every cell, with soil_id, wx_id and run_id columns and an index (`models/runs.csv`) that join each cell to its files. After Build you choose the columns (presets: erosion, soil properties, weather, model links, all) and the model folders to download. |
| Practices | Pick a land use (cropland, rangeland, shrubland, pasture/hay, CRP/go-back, disturbed land, bare sand) and answer 2–5 quick questions. You get a prioritized plan with NRCS practice codes, quantitative specs, a timing calendar against the local windy months, cover-crop and native-species tables for the region and soil group, and site notes. Texas plans come from Texas sources; every other state's from a profile of its own NRCS technical guide (plus extension and other official public pages for Kansas and a few western states), each statement cited (docs/METHODS.md §6). |
| Units table | The ruler button on the map. Pick metric, US or the default mix in one click, or a unit for each quantity (wind, rain, temperature, elevation, soil depth, water, Ksat, area, distances, soil loss, rates, seeding density, solar radiation). Numbers, charts, tables and legends follow it, and so do downloads, except the Soil tab's CSV (cm, cm/h) and the area CSV (acres, t/ac/yr), which keep fixed units, and the model files, which use each model's own; `?units=metric` or `?units=us` in the link sets it. |
| Downloads | Each chart has a download button: PNG, TIFF or JPEG at a chosen size (inches, cm, mm or pixels) and 72–1,200 DPI, with the DPI stored in the file; the wind rose also as SVG; every chart and table as CSV. The DOWNLOAD data for models tab writes model-ready files and can draw them first, below. |

## Model-ready soil and weather files

The **DOWNLOAD data for models** tab builds a zip for the chosen location. Its tabs give the weather files, the soil files, or both together in one zip:

| Model | Files |
|---|---|
| DSSAT 4.8 | one `.WTH` per year and one for all years (records outside 1941–2040 or over 99 years: 4-digit-year files of up to 99 years), soil `WG.SOL` |
| SWAT+ | station files (`.pcp`, `.tem`, `.slr`, `.hmd`, `.wnd`) with their `.cli` lists, `weather-sta.cli`, `weather-wgn.cli`, `soils.sol`, a QSWAT+ user soil table, and the SWAT2012 text format |
| EPIC 1102, APEX 1501 | daily `.DLY`, monthly statistics `.WP1`, wind `.WND`, soil `.SOL` |
| APSIM Next Gen / 7.10 | weather `.met` with a CO₂ column, soil `.apsimx` |
| AquaCrop 7 | climate `.CLI` with `.Tnx`, `.ETo` and `.PLU`, soil `.SOL`, and an AquaCrop-OSPy weather file |
| CENTURY 4.0, 4.5 | monthly weather `.wth`; a site file `.100` for each version, with the soil, its water layers and climate lines. The schedule and event files are yours. Written from the model's Fortran readers and not run in CENTURY here |
| DayCent (Dec 2016) | daily weather `.wth` (with solar radiation, humidity and wind when every day has them); a site file `.100` with climate lines; `soils.in` on NREL's layers, at most 20 rows and 9 CENTURY layers; `sitepar.in`. The schedule, `fix.100` and event files are yours. Written from the model's readers, checked against NREL's example runs, and not run in DayCent here |
| Plain CSV | daily weather and soil layers with units, and a README (ET₀ source, layers) |

- **Templates for your own files:** the sheet shows the layout a weather or soil file should have. Tick the columns you have, choose each one's unit (°C, °F or K; mm, inches or cm; MJ, W/m², kWh, langley or kJ; m/s, mph, km/h or knots; soil depths in cm, inches, mm, m or feet; g/kg or %; Ksat in eight units; and so on) and download a CSV or Excel template. Its column names state the units, such as `tmax (F)` or `wind at 3 m (mph)`, so the filled-in file loads with nothing else to set.
- **Weather:** gridMET (4 km, 1979 to about 2 days ago), PRISM (4 km, 1981 on: its own rain and temperature, with gridMET's solar radiation, humidity and wind, as PRISM has no wind), NASA POWER (1981 to about a week ago), or your own daily file (CSV, text or Excel, including NASA POWER, Open-Meteo, Campbell TOA5, GHCN, CIMIS, Davis and similar exports; columns found by name, and the sheet and README show which header each was read from and anything worth noting, such as a TOA5 day stamped at midnight being the day before; °C/°F, mm/in and the usual solar and wind units), with gaps optionally filled from gridMET. Grass ET₀ is the file's own column, or FAO-56 from its columns, and the README counts the days. Dates outside the source's record are left out. Codes such as −99.9, −996, 999 or 9999 are gaps, counted and fillable, except where the column's unit can hold them (9999 kJ/m² is a reading). A units row under the header, or a unit written in the cells, is read; a file with rows through the day is summarised to days, including a running rain total that resets at any hour; more than one station, or a Tmax no station could report, is refused with the reason. DSSAT, APSIM and AquaCrop cannot read missing values, so their files run from the first to the last day with Tmax and Tmin, with gaps filled and counted in the README.
- **Soil:** any component of the survey's map unit, or your own profile in an editable table (start from the survey, change values, add layers or load a CSV with lab spellings such as "pH (H2O)", "ECe" or "Upper depth", and units such as g/kg, cm/h or inches in the headers; blanks are estimated with Saxton & Rawls 2006, kept physical for any texture; the curve number follows the hydrologic group and slope). A blank organic matter stays blank where a file can do without it, and each model's README says what it does; a row with no depths, such as a Mean under the table, is left out; one file is one profile. Your profile belongs to the location it was made for.
- **Layers:** each model's usual layers, the horizons as they are, or custom depths you type (with SoilGrids and DSSAT presets). Each custom layer takes the thickness-weighted mean of the horizons it covers (organic matter, carbon, CaCO₃ and N weighted by mass, Ksat as a harmonic mean); models that take fewer layers merge the thinnest neighbours the same way. The profile stops at bedrock or a cemented layer; a profile that simply ends is extended with its deepest horizon.
- When the dates do not cover every month, or lack a variable the weather-generator statistics need, 10 complete years are read for TAV/AMP and those statistics. Failing that, months with 10 or more days are used, with a note. A model that still cannot get them gets a `NOT_WRITTEN.txt` saying why, instead of files with zeros; the rest of the zip is kept.
- **Drought Monitor, week by week:** `tables/drought_monitor_weekly.csv` gives the map date (Tuesday), valid to (Monday), class code (−1 none, 0–4 D0–D4), class, class name and in drought (D1–D4) yes/no, for the weeks the chosen dates touch (2000 on). With the daily table ticked too, `daily_weather.csv` gets each day's class. Every README also gives this week's class at the point.
- **Area grid, Drought Monitor:** under 3 · Weather and drought, add the U.S. Drought Monitor (this week only, 52 weeks, 2 or 5 years). Columns: `dm_now`, `dm_d0p`–`dm_d4p` (% of weeks in D0+, D1+, D2+, D3+, D4), `dm_max` and `dm_run` (the longest run of D1+ weeks); `drought/weeks.csv` gives each week's share of cells per class. Each week's map is read as a PNG from NDMC's WMS at about 0.001° and classed by colour; dated maps are kept in the browser for 15 days.
- **Preview:** before anything is saved, the Preview button draws what the download will hold: the daily weather as lines or bars by day, month or year, with its gaps, the numbers behind it and the gap-free copy some models get; each model's soil layers by depth; the wind series and summaries; and the files themselves, with sizes and their first lines. Each chart can be downloaded like the others. Download then uses the same weather without reading it again.
- Every file follows its model's manual, official example files and the reading code of its source (`docs/METHODS.md` §7). Each folder has a README with how to load the files and the soil layers that model's file has. The files have not been run in the models here.

## Data sources (all open, no keys)

**Kept for 15 days.** A place looked at again within 15 days loads at once: the answers that stay the same for days (soil survey, elevation, land cover, past weather and station records, the Drought Monitor's dated maps, place search) are kept in the browser (Cache Storage) for 15 days; live layers and this week's Drought Monitor are always asked fresh. Older answers are dropped at the next visit; clearing the site's data in the browser drops them all (docs/METHODS.md §0).

Every default source is read directly from the agency that produces it. Open-Meteo is only a backup: for hourly wind when NASA POWER errors or has not answered within 20 s, for daily weather when gridMET and NASA POWER both fail, and for elevation when USGS has not answered within 4 s (USGS took 9–16 s in tests; its 1 m answer replaces the 90 m one when it comes). Each part of the page is drawn as soon as its own source answers, so a slow source holds nothing else. You can still pick ECMWF wind (Open-Meteo's copy) on the Wind tab; ECMWF and the Copernicus CDS themselves need a personal key and queued jobs.

| Data | Producer | How the app reads it | If it fails |
|---|---|---|---|
| Hourly 10 m wind (default) | NASA MERRA-2, 0.5° × 0.625° | NASA POWER hourly API, direct | ECMWF via Open-Meteo (after 20 s without an answer) |
| Hourly 10 m wind (backup or option) | ECMWF IFS 9 km (2017 on), ERA5 0.25° (before) | Open-Meteo Historical Weather API (copy) | NASA MERRA-2 |
| Airport observations | NWS/FAA ASOS/AWOS, NOAA NCEI GHCNh | NCEI Access Data Service, direct | Iowa Environmental Mesonet ASOS archive |
| Daily precipitation, grass ET₀, temperature | gridMET 4 km (University of Idaho) | THREDDS OPeNDAP, direct; gridMET's yearly files on its file server (byte ranges) when THREDDS does not answer | NASA POWER daily, direct (Penman–Monteith ET₀ computed in the app), then ECMWF daily via Open-Meteo |
| Soils, WEG, I, T, climatic factor C | USDA-NRCS SSURGO; the point's county from Census TIGERweb (2020 counties) | Soil Data Access, direct; C for a county SSURGO gives no usable value: the pre-built NASA POWER estimate in the state's file | none |
| Elevation and slope | USGS 3DEP (1–10 m) | Elevation Point Query Service, direct | Copernicus 90 m DEM via Open-Meteo |
| Land cover | USGS/MRLC NLCD 2021 | MRLC WMS, direct (currently refuses browser requests) | Sentinel-2 10 m land cover (Impact Observatory, Microsoft, Esri) |
| Soil polygons in an area | USDA-NRCS SSURGO | Soil Data Access spatial query (clipped to the boundary), direct | none |
| Buildings (area tool, click check) | FEMA/ORNL USA Structures | ArcGIS feature service, direct | not removed; the panel says so |
| Roads (area tool, click check) | Census TIGER/Line | TIGERweb map service, direct; widened by road class | not removed; the panel says so |
| Water bodies (area tool, click check) | USGS NHD (lakes/ponds, reservoirs, marshes; playas stay in), plus SSURGO Water map units | NHD map service, direct | Esri's copy of NHD after 5 s (3 s for a click) |
| Boundary files | your shapefile, KML/KMZ or GeoJSON | read in the browser (shpjs, togeojson, JSZip); never uploaded | — |
| Statewide WEI/WEG grids | SSURGO via UC Davis SoilWeb | pre-built in `data/` | — |
| Place suggestions | U.S. Census Bureau 2020 Gazetteer and 2024 population estimates | pre-built, `data/places.txt` (`tools/build_places.py`) | — |
| Geocoding, basemaps | OpenStreetMap Nominatim; Esri, USGS | direct | — |
| County lines | U.S. Census TIGER | TIGERweb map service, drawn per tile, direct | — |
| Drought maps | U.S. Drought Monitor (NDMC, USDA, NOAA, NASA); NOAA CPC drought outlooks | NDMC MapServer WMS; NWS map services, direct | — |
| Drought tab | U.S. Drought Monitor at the point; Esri Living Atlas, U.S. Drought Intensity (its weekly maps since 2000); gridMET Drought (SPI, SPEI, PDSI), University of Idaho | NDMC WMS GetFeatureInfo; Living Atlas FeatureServer point query; THREDDS OPeNDAP, direct | Living Atlas: NDMC's dated maps; gridMET Drought: the same NetCDF-4 files on the University of Idaho's file server, read in place by byte ranges, only the chunks that hold the cell; else the tab says why |
| Drought Monitor in the area grid | U.S. Drought Monitor | NDMC WMS GetMap PNGs, read by colour, direct | a week not read is left out and named |
| Soil maps: pH, CEC, organic matter | USDA Forest Service gNATSGO 2022, 30 m (CC0) | image services (exportImage, getSamples), direct | left blank |
| Soil maps: salinity EC (0–25 cm), sodicity SAR (profile maximum) | UC Davis SoilWeb grids from SSURGO, 800 m (Walkinshaw, O'Geen and Beaudette) | pre-built per state, `data/states/XX/layer_soil_ec.png` and `layer_soil_sar.png` (`tools/build_soilmaps.py`) | — |
| Soil maps: total P, K, Ca, Mg, S, Zn, Fe, Mn, Cu, Na | USGS DS-801 (Smith et al. 2013), public domain | USGS WMS (classes in `data/soilchem_legend.json`), WFS and site JSON, direct | the tab says why |
| Soil maps: total nitrogen | ISRIC SoilGrids 2.0, 250 m (CC BY 4.0) | WMS and REST, direct | no value on built-up land and water |
| Soil maps tab: chemistry by horizon; lab pedons | USDA-NRCS SSURGO; NRCS Kellogg Soil Survey Laboratory (KSSL) | Soil Data Access, direct | the tab says why |
| Daily weather for model files | gridMET (default), PRISM, NASA POWER, or your file | THREDDS OPeNDAP (9 variables); PRISM through ACIS GridData (NOAA Regional Climate Centers) with gridMET's other variables; POWER daily API; all direct | NASA POWER for gridMET and for PRISM's other variables |
| Atmospheric CO₂ (APSIM files) | NOAA GML Mauna Loa annual means | built in (1959–2025; +2.5 ppm/yr after, the 1959 value before) | — |

Each state's file, `data/states/XX.json` (`tools/build_states.py`), holds its outline, the airports within about 150 km of it (with NOAA GHCNh ids; 2,478 airports in all) and, where built, its statewide overlays; `data/states.js` lists every state with its box and standard time. Days and months are in the location's state's standard time (no daylight saving): Eastern, Central, Mountain or Pacific, the zone most of the state keeps.

### Other wind networks

Calibration uses airports. Other networks were checked in October 2026 (details in `docs/METHODS.md` §3):

- **West Texas Mesonet** (Texas Tech, 189 towers at 10 m) is the one network with 10 m wind that a web page can read without a key or licence. Some towers read like the airports (Reese Center vs Lubbock airport: 0.99 of the mean wind and 1.00–1.03 times the hours ≥ 8 m/s in 2020 and 2025), but in a 2024 survey 7 of 16 towers recorded 24–85% fewer erosive hours than a nearby airport, relative to the model: probably sheltered. Its [data policy](https://www.mesonet.ttu.edu/disclaimer) forbids public use without the mesonet's permission (mesonet@ttu.edu), so it is **switched off**. The code is in place: set `ENABLE_WTM = true` in `js/wind.js` once the mesonet agrees. For a local test, run the app as above and open <http://localhost:8765/?wtm=1>; the public site ignores `?wtm=1`.
  - When on, a tower ranks ahead of an airport when its distance plus 20 km is less than the airport's (an AWOS airport counts 100 km extra). Such a tower refines the calibration about a minute after the airport result appears, if it records at least 0.85 times the airport's erosive hours relative to the model; otherwise the app checks one more tower, then keeps the airport. A tower is used unchecked only when no airport was found.
  - A tower needs 5 complete years in the archive (132 of 189 in 2026) and trains on them. Gusts stay with the airport.
- **Not usable:** TexMesonet (TWDB) and the West Texas Mesonet website refuse other websites; RAWS and NRCS SCAN read 20–50% low even after height correction at the 2 RAWS and 3 SCAN sites tested; USCRN is at 1.5 m; Synoptic needs a paid key; the Oklahoma Mesonet and TexasET need a licence.

## Visitor statistics

Off. `js/stats.js` can count visits with **Umami Cloud**'s free Hobby plan (umami.is: up to 100,000 events a month for one site, no cookies; country, region and city, approximately, from the IP address, which it does not keep as a field; 6 months of data), but its website ID is empty, so nothing is loaded or counted.

To turn it on: add the site in Umami Cloud (Add website, domain `barsa1ly.github.io`), copy the Website ID from its tracking code (`data-website-id`) into `UMAMI_WEBSITE_ID` in `js/stats.js`, and publish. Only the published site is counted, never a local test, and only the page's path is sent (`data-exclude-search`), never the query string, which holds the chosen location's coordinates. For a public dashboard, make a Share URL in Umami (the website's Edit, Share URL, Add) and put it in `UMAMI_SHARE_URL`: a **Visitor statistics** link then appears at the start of the map's bottom bar.

## How the data flows

[`docs/SoilGuard_Data_Flow.docx`](docs/SoilGuard_Data_Flow.docx) has these diagrams and tables showing where each dataset comes from, where it is calculated, and how each result reaches the screen. Rebuild it with `python tools/build_flow_doc.py`. The diagrams are vector drawings, sharp at any zoom: click one to open it on its own. 600 dpi PNG copies are next to them in `docs/img/`.

[![Data flow: sources, calculations in the browser, results](docs/img/flow_overview.svg)](docs/img/flow_overview.svg)

### The wind, soil and area pipelines

**Wind and climate: three sources to monthly risk**

[![Wind and moisture pipeline with every fallback](docs/img/flow_wind.svg)](docs/img/flow_wind.svg)

**Soil survey to erosion risk**

[![Soil and erosion-risk pipeline](docs/img/flow_soil.svg)](docs/img/flow_soil.svg)

**Field or area analysis, and the map-click check**

[![Field or area analysis and the map-click check](docs/img/flow_area.svg)](docs/img/flow_area.svg)

**Model files, with your own weather and soil files**: gridMET, PRISM (through ACIS), NASA POWER or your uploaded daily file; the survey's soil or your uploaded or typed profile; the area grid.

[![Model files from the data sheet, with your own files, and the area grid](docs/img/flow_models.svg)](docs/img/flow_models.svg)

**Drought and Soil maps themes**: the Drought Monitor's live and past weeks, CPC's drought outlooks, the Drought tab's week-by-week record and drought indices, the Drought Monitor downloads, and the Soil maps theme and tab with their sources.

[![Drought and Soil maps: live layers, tabs and downloads](docs/img/flow_drought.svg)](docs/img/flow_drought.svg)

## Rebuilding the statewide layers

`tools/` contains the scripts that produced `data/` (Python 3.11 with numpy, rasterio, shapely, pyproj, scipy, Pillow, requests):

```bash
python tools/fetch_power_grid.py
python tools/fetch_county_c.py
python tools/build_layers.py all
python tools/build_states.py
```

`fetch_power_grid.py` and `fetch_county_c.py` read the NASA POWER climatology and the official county C for the 48 contiguous states and DC. `build_layers.py all` (or `build_layers.py KS OK`) writes each state's overlay images and their description (bounds, legends, statistics, spring-wind arrows, each county's C, `overlays.json`) to `data/states/XX/`; `build_states.py` then writes every state's file and the state list. The raw downloads (SoilWeb rasters, Census boundaries, the Iowa Environmental Mesonet station lists) go in `tools/raw/`.

`python tools/build_soilmaps.py all` (or `TX OK`), run after `build_layers.py`, writes each state's salinity and sodicity images for the Soil maps theme (`data/states/XX/layer_soil_ec.png`, `layer_soil_sar.png`) from UC Davis SoilWeb's `ec_025.tif` and `sar.tif`; `build_soilmaps.py legend` writes `data/soilchem_legend.json`, the USGS DS-801 map classes.

## Method notes and limits

- The bare-soil potential is WEQ E3 with K = 1: a bare, smooth, wide, unsheltered field. It ranks inherent susceptibility. It does not predict actual loss under current management.
- Gridded winds are averaged over a 9–50 km cell and miss many gusty hours. At Lubbock the raw reanalysis caught only 35% of the airport's erosive hours over 2016–2025, and it shifted the peak months earlier (Jan–Apr instead of Feb–May). The app therefore calibrates speeds month by month to the nearest airport station by default. Directions agree well either way. After calibration the default NASA MERRA-2 and the optional ECMWF give 1,295 and 1,291 erosive h/yr at Lubbock, both Feb–Apr from the WSW.
- "High-risk" months are those with at least 10% of the year's erosive wind energy (Σu²(u−uₜ) above the threshold) weighted by dryness (1 − P/ET₀). They are ranked only for a period that covers all 12 months.
- The recommendations are planning guidance drawn from NRCS standards: in Texas from Texas research (`docs/RESEARCH.md` holds the full evidence report), in the other states from each state's NRCS technical guide (`data/practices/`, §6 of `docs/METHODS.md`). `docs/METHODS.md` lists every formula and threshold the app uses. Confirm designs and seeding rates with the local NRCS field office.
- The default lookup uses no Open-Meteo calls. If you pick ECMWF, a 10-year lookup counts as about 130 Open-Meteo calls against the free limit of 10,000 per day per IP, roughly 75 new locations a day; if Open-Meteo refuses, the app switches to NASA MERRA-2.
