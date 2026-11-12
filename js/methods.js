/* Methods sheet: where each value came from for the current site, the data-source catalog, and every equation the app uses. */
WG.methods = (function () {
  const { $, $$, esc } = WG.util;
  const A = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
  const SIX = window.WG_STATES || {}, N_AIRPORTS = SIX.airports || 0, TOWER_Y = SIX.towerYears || [], N_TOWERS = TOWER_Y.length; // from tools/build_states.py
  const N_USABLE = TOWER_Y.filter(y => y <= WG.wind.yearsFor(WG.wind.TOWER_YEARS).start).length; // with the 5 complete years a tower trains on
  const WTM_STATE = WG.wind.wtmEnabled ? "It is used here with the mesonet's permission"
    : `Its data policy forbids public use without the mesonet's permission, so it is off on this site${WG.wind.wtmTrial ? " (switched on for this local test)" : ""}`;
  const WTM = A("https://www.mesonet.ttu.edu/", "West Texas Mesonet");
  const USED = '<span class="badge used">used</span>', CHECK = '<span class="badge check">cross-check</span>',
    REF = '<span class="badge ref">reference only</span>', FALLBACK = '<span class="badge ref">fallback</span>';

  /* [data, producer, how the app reads it, resolution · period, if it fails] */
  const SOURCES = [
    ["Hourly 10 m wind speed and direction (default)", "NASA GMAO MERRA-2 reanalysis",
      `<b>Direct:</b> ${A("https://power.larc.nasa.gov/docs/services/api/temporal/hourly/", "NASA POWER")} hourly API (about 1–3 s for 10–20 years)`,
      "0.5° × 0.625° (~50 km) hourly, 2001 on", "ECMWF via Open-Meteo, if NASA POWER errors or has not answered within 20 s"],
    ["Hourly 10 m wind speed and direction (backup, or when chosen)", "ECMWF: IFS operational analysis; ERA5 reanalysis by Copernicus C3S",
      `${A("https://open-meteo.com/en/docs/historical-weather-api", "Open-Meteo")} archive, a re-hosted copy. Copernicus's own data store needs each user's personal key and a queued job that takes minutes.`,
      "9 km hourly (2017 on); 0.25° (~28 km) hourly (before 2017)", "NASA MERRA-2"],
    ["Daily maximum gust (model)", "ECMWF IFS / ERA5 only", "Open-Meteo, with the ECMWF hourly wind", "as above",
      "MERRA-2 has no gust variable: calibration maps its daily max wind to airport gusts"],
    ["Airport wind observations (ASOS/AWOS)", `NWS/FAA stations, archived by NOAA NCEI in ${A("https://www.ncei.noaa.gov/products/global-historical-climatology-network-hourly", "GHCNh")} (successor to ISD, which stopped in Aug 2025)`,
      `<b>Direct:</b> ${A("https://www.ncei.noaa.gov/access/services/data/v1", "NCEI Access Data Service")}, wind columns only, one request per year`, "station, routine hourly METAR, decades",
      `${A("https://mesonet.agron.iastate.edu/request/download.phtml", "Iowa Environmental Mesonet")} ASOS archive (NWS METAR feed)`],
    ...(WG.wind.wtmOn ? [[`Mesonet tower wind (${WG.wind.wtmEnabled ? "used with the mesonet's permission" : "local test"})`, `${WTM}, Texas Tech University: 10 m towers, relayed hourly by NWS Lubbock as SHEF reports`,
      `${A("https://mesonet.agron.iastate.edu/request/dcp/fe.phtml", "Iowa Environmental Mesonet")} DCP archive, one request per year, one at a time (about 11 s each)`,
      `tower, hourly value at :00 in whole mph, Dec 2010 on; the latest ${WG.wind.TOWER_YEARS} complete years`, "the airport calibration stays"]] : []),
    ["Daily precipitation, grass reference ET₀, max/min temperature", `${A("https://www.climatologylab.org/gridmet.html", "gridMET")}, University of Idaho (Abatzoglou 2013): PRISM-based precipitation, NLDAS-2 meteorology, ASCE Penman–Monteith ET₀`,
      `<b>Direct:</b> ${A("https://thredds.northwestknowledge.net/thredds/reacch_climate_MET_aggregated_catalog.html", "THREDDS")} OPeNDAP, one cell, scale and offset read from the file; when THREDDS does not answer, gridMET's yearly NetCDF-4 files on the University's file server, read in place by byte ranges (only the chunks that hold the cell, about 50 MB a year for all nine variables)`, "4 km (1/24°) daily, 1979 on", "NASA POWER daily, direct (Penman–Monteith ET₀ computed in the app), then ECMWF daily via Open-Meteo"],
    ["Daily weather for model files", "gridMET (default), PRISM or NASA POWER; or your own daily file",
      `<b>Direct:</b> gridMET THREDDS, 9 variables for the chosen dates; ${A("https://power.larc.nasa.gov/docs/services/api/temporal/daily/", "NASA POWER")} daily API; your CSV, text or Excel file read in the browser`,
      "gridMET 4 km, 1979 on (about 2 days behind); PRISM 4 km, 1981 on, through ACIS (rain and temperature; the rest from gridMET); POWER 0.5°, 1981 on (solar 1984)", "NASA POWER; gaps in your file can be filled from gridMET"],
    ["Atmospheric CO₂ (APSIM files)", "NOAA Global Monitoring Laboratory, Mauna Loa", `Annual means 1979–2025 built into the app (${A("https://gml.noaa.gov/ccgg/trends/", "NOAA GML")})`, "yearly", "+2.5 ppm a year after 2025"],
    ["Soil profile, WEG, I, T, MLRA, climatic factor C", "USDA-NRCS Soil Survey Geographic Database (SSURGO)",
      `<b>Direct:</b> ${A("https://sdmdataaccess.nrcs.usda.gov/", "Soil Data Access")} REST queries`, "map units, 1:12,000–1:24,000", "none: enter a soil test on the Soil tab"],
    ["Elevation, slope, aspect", "USGS 3D Elevation Program (3DEP)", `<b>Direct:</b> ${A("https://apps.nationalmap.gov/epqs/", "Elevation Point Query Service")}, 5 points`, "1–10 m lidar/DEM", "Copernicus GLO-90 via Open-Meteo"],
    ["Land cover", "USGS / MRLC National Land Cover Database 2021", `<b>Direct:</b> ${A("https://www.mrlc.gov/", "MRLC")} WMS feature query (MRLC currently refuses browser requests)`, "30 m",
      `Sentinel-2 10 m land cover, latest year (${A("https://livingatlas.arcgis.com/landcover/", "Impact Observatory, Microsoft, Esri")}), direct`],
    ["Land cover legend (% of area)", "USGS / MRLC National Land Cover Database 2021", `<b>Direct:</b> ${A("https://www.mrlc.gov/", "MRLC")} WCS GeoTIFF: counted inside your boundary live, and in advance for each state (data/states/landcover.json)`, "30 m (states 30–270 m samples; large boundaries coarser)", "the state's shares"],
    ["Soil polygons inside a drawn or uploaded area", "USDA-NRCS SSURGO", `<b>Direct:</b> ${A("https://sdmdataaccess.nrcs.usda.gov/", "Soil Data Access")} spatial query: map-unit polygons clipped to the boundary, with component WEG, I and %`, "map units, 1:12,000–1:24,000", "none"],
    ["Building footprints (area tool; map clicks refused)", "FEMA / Oak Ridge National Laboratory USA Structures", `<b>Direct:</b> ${A("https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/USA_Structures_View/FeatureServer/0", "USA Structures")} feature service`, "footprint polygons", "buildings not removed (the panel says so)"],
    ["Roads (area tool; map clicks refused)", "U.S. Census Bureau TIGER/Line", `<b>Direct:</b> ${A("https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer", "TIGERweb")} primary, secondary and local roads, widened by road class`, "road centrelines", "roads not removed (the panel says so)"],
    ["Water bodies (area tool; map clicks refused)", "USGS National Hydrography Dataset (NHD): lakes and ponds, reservoirs, swamps and marshes, estuaries (playas stay in)", `<b>Direct:</b> ${A("https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer", "NHD map service")}; SSURGO “Water” map units are always left out too`, "1:24,000 water-body polygons", `Esri's copy of NHD (${A("https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Detailed_Water_Bodies/FeatureServer/0", "USA Detailed Water Bodies")}): taken if NHD has not answered within 5 s (3 s for a click)`],
    ["Boundary files", "Your shapefile, KML/KMZ or GeoJSON", "Read in the browser with the open-source shpjs (with .prj reprojection), togeojson and JSZip libraries; nothing is uploaded to a server", "as drawn", "—"],
    ["Statewide susceptibility and WEG maps", "SSURGO, gridded by UC Davis SoilWeb (800 m WEI, WEG) × county or survey-area C (NRCS; estimated where SSURGO gives a county no usable value)",
      "Pre-built 1 km PNGs (tools/build_layers.py)", "1 km", "direct alternative: gNATSGO rasters (multi-GB)"],
    ["Statewide windy-season map; C where SSURGO gives a county no usable value", "NASA MERRA-2 climatology", "Pre-built from NASA POWER (tools/fetch_power_grid.py)", "0.5° × 0.625°, 2001–2025", "—"],
    ["Station list and NOAA station ids", "IEM station networks; NOAA ISD history and GHCNh station list; West Texas Mesonet site list", "Pre-built in each state's file, data/states/XX.json (tools/build_states.py)",
      `${N_AIRPORTS} airports in the 48 contiguous states and DC; a state's file holds those within about 150 km of it; ${N_TOWERS} West Texas Mesonet towers, ${N_USABLE} with 5 complete years (used only when the mesonet is switched on)`, "—"],
    ["U.S. Drought Monitor (Drought map and tab)", "National Drought Mitigation Center (UNL), USDA, NOAA, NASA", `<b>Direct:</b> ${A("https://droughtmonitor.unl.edu/DmData/GISData.aspx", "NDMC")} WMS usdm_current, and usdm_YYYYMMDD for the same week 1 and 5 years before or any week chosen on the map since 4 January 2000; this week's class at the point by WMS GetFeatureInfo (±0.0001°) on the dated map the capabilities name, and the fallback for the week-by-week history; WMS GetMap PNGs read by colour for the area grid's dm_* columns (dated maps kept in the browser for 15 days). Free with credit (${A("https://droughtmonitor.unl.edu/About/Permission.aspx", "terms")})`, "weekly maps (Tuesday's), 2000 on", "the Drought tab says it could not be read"],
    ["Drought Monitor week by week at the point (Drought tab, data sheet)", `${A("https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/US_Drought_Intensity_v1/FeatureServer", "Esri Living Atlas")}, U.S. Drought Intensity (US_Drought_Intensity_v1), a copy of the Drought Monitor's weekly maps`,
      "<b>Direct:</b> FeatureServer layer 2, point query sorted by date (pages of 260); weeks it lacks, or all weeks if it fails, from NDMC's dated maps (4 at a time). Weeks read are kept in this browser under the point rounded to 0.0001° (last 60 locations)", "weekly, 4 January 2000 on", "NDMC GetFeatureInfo on each week's map"],
    ["Drought outlooks (Drought map and tab)", "NOAA Climate Prediction Center", `<b>Direct:</b> NWS map services outlooks/cpc_drought_outlk: WMS layers 5 (monthly) and 2 (seasonal); at the point, REST query of layers 1 and 4`, "monthly; seasonal (third Thursday)", "—"],
    ["Drought indices since 1980 (Drought tab)", `${A("https://www.climatologylab.org/gridmet.html", "gridMET Drought")}, University of Idaho (Abatzoglou 2013)`, `<b>Direct:</b> THREDDS OPeNDAP, one cell: agg_met_spi*, agg_met_spei* and agg_met_pdsi_1979_CurrentYear_CONUS; scale and offset read from the file`, "4 km, every 5 days, 1980 on, about a week behind", `when THREDDS has not answered in 8 s: the same NetCDF-4 files on the University of Idaho's ${A("https://www.northwestknowledge.net/metdata/data/", "file server")} (6–7.5 GB each), read in place by byte ranges, only the chunks that hold the cell (a series about 6–7 MB, PDSI 20 MB; this week's values about 1 MB); else the tab says why`],
    ["Soil maps: pH, CEC (pH 7), organic matter", "USDA Forest Service gNATSGO 2022 (the soil survey rasterized), CC0", "<b>Direct:</b> imagery.geoplatform.gov image services: exportImage for the map, getSamples at the point; 0–5, 5–25, 25–50, 50–100 cm", "30 m", "the layer or value is left blank"],
    ["Soil maps: salinity EC (0–25 cm), sodicity SAR (profile maximum)", "UC Davis SoilWeb grids from SSURGO (Walkinshaw, O'Geen and Beaudette; citation requested)", "Pre-built per-state PNGs, data/states/XX/layer_soil_ec.png and layer_soil_sar.png (tools/build_soilmaps.py)", "800 m", "—"],
    ["Soil maps: total P, K, Ca, Mg, S, Zn, Fe, Mn, Cu, Na", `USGS ${A("https://doi.org/10.3133/ds801", "DS-801")} (Smith et al. 2013), public domain: total, not plant-available`, "<b>Direct:</b> USGS mrdata WMS for the map (classes in data/soilchem_legend.json); WFS and site JSON for the 3 nearest sites; top 5 cm, A and C horizons", "about one site per 1,600 km²", "the tab says it could not be read"],
    ["Soil maps: total nitrogen", `ISRIC ${A("https://soilgrids.org/", "SoilGrids 2.0")} (Poggio et al. 2021), model, CC BY 4.0`, "<b>Direct:</b> WMS for the map; REST at the point (mean and 5–95% range, 6 depths to 200 cm)", "250 m", "no value at built-up land and water"],
    ["Soil maps tab: chemistry by depth and horizon", "USDA-NRCS SSURGO, public domain", `<b>Direct:</b> ${A("https://sdmdataaccess.nrcs.usda.gov/", "Soil Data Access")}: pH, EC, SAR, ESP, CEC, base saturation, OM, CaCO₃ and gypsum of the major components`, "map units", "the tab says it could not be read"],
    ["Soil maps tab: nearby lab pedons", "USDA-NRCS Kellogg Soil Survey Laboratory (KSSL), public domain", "<b>Direct:</b> Soil Data Access lab tables: the 8 nearest pedons' surface layer (NH₄OAc K, Ca, Mg, Na; Bray-1, Olsen and Mehlich-3 P; total N and S)", "points, often old", "—"],
    ["Soil maps: watershed boundaries and streams", "USGS Watershed Boundary Dataset; USGS NHDPlus High Resolution; public domain", `<b>Direct:</b> ${A("https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer", "WBD")} and ${A("https://hydro.nationalmap.gov/arcgis/rest/services/NHDPlus_HR/MapServer", "NHDPlus HR")} MapServer export tiles with the app's own symbols`, "HU8 to HU12; 1:24,000 flowlines from zoom 12", "—"],
    ["Soil maps tab: basin and mean annual runoff", "NHDPlus HR, EROM step A (McCabe-Wolock water balance, 1971–2000): a model", `<b>Direct:</b> the HU12 at the point (WBD layer 6); its flowlines and sinks by its polygon; their catchments by id (layer 10, 500 a request); the whole upstream basin from ${A("https://api.water.usgs.gov/nldi/", "USGS NLDI")}`, "HR catchments; HU12 40–250 km²", "the card says it could not be read"],
    ["Soil maps tab: design-storm runoff", "NOAA Atlas 14 Vols. 1, 2, 6, 8–12 (every state but OR and WA); MRLC NLCD 2021; SSURGO hydrologic groups", "Pre-built data/states/XX/atlas14.json (tools/build_basins.py); MRLC WCS counted in the HU12; Soil Data Access intersected with the HU12", "0.05° cells; 30 m; map units", "a typed 24-hour depth in OR and WA, which no Atlas 14 volume covers (link to NOAA PFDS)"],
    ["Soil maps tab: soil loss (RUSLE)", "USGS RF7100 R (Wieczorek &amp; LaMotte 2010); SSURGO K, slope, slope length, T; NLCD 2021", "Pre-built data/states/XX/rfactor.json (tools/build_basins.py), the point's COMID from USGS NLDI; DC from the MD and VA files", "NHDPlus V2 catchment; R kept to 1%", "a typed R"],
    ["Soil maps: soil moisture maps", "NASA SMAP L4 (GMAO); NOAA National Water Model 3.0; NASA SPoRT-LIS and GRACE-DA: models and satellite analyses", `<b>Direct:</b> ${A("https://gibs.earthdata.nasa.gov/", "NASA GIBS")} WMTS (any day since 31 March 2015); NOAA map services WMS (latest hour); NOAA NIDIS drought.gov tiles (latest day or week)`, "9 km daily; 1 km hourly; 3 km daily; 0.125° weekly", "—"],
    ["Soil maps tab: soil moisture by depth at the point", "ERA5-Land, ECMWF IFS (models); SMAP L4 (satellite + model); National Water Model (model)", `${A("https://open-meteo.com/", "Open-Meteo")} archive and forecast, a re-hosted copy (CC BY 4.0; Copernicus's and ECMWF's own services need a personal key), one retry; <b>Direct:</b> USDA NASS Crop-CASMA WPS; NWM NetCDF on AWS read in place by byte ranges, on request`, "0.1°; 9 km; 9 km; 1 km", "the card names a source that did not answer"],
    ["Soil maps tab: soil moisture stations", "USDA NRCS SCAN and SNOTEL; NOAA USCRN: measured, public domain", "Station list pre-built (tools/build_moisture.py); readings from the AWDB REST API and NCEI USCRN daily and hourly files", "sensors 2–40 in or 5–100 cm, hourly; the 3 nearest within 400 km", "the station's block says it could not be read"],
    ["Imagery, labels, roads, rivers", "Esri World Imagery and Reference; USGS The National Map", "Map tiles, direct", "to ~0.5 m", "—"],
    ["Visitor counts", "Umami Cloud, free Hobby plan", "Off in this copy until a SoilGuard website ID is put in js/stats.js (README, Visitor statistics). Then js/stats.js loads Umami's script on the published site only. Only the page's path is sent (data-exclude-search), never the query string with the chosen coordinates. No cookies. Its public Share URL, once made, is linked as Visitor statistics at the start of the map's bottom bar.", "6 months kept; country, region (state or province), city, from IP geolocation, approximate", "—"],
    ["Soil map-unit lines", "USDA-NRCS SSURGO", "Soil Data Access WMS, direct (zoom 13+)", "—", "—"],
    ["Place suggestions while typing", "U.S. Census Bureau 2020 Gazetteer; 2024 city and town population estimates", "Pre-built list, data/places.txt (tools/build_places.py)", "—", "—"],
    ["Place search and names", "OpenStreetMap contributors", "Nominatim, direct", "—", "—"],
    ["Practice recommendations", "Texas: NRCS Texas FOTG standards, Texas A&M AgriLife, TxDOT, WAFWA, published trials. Other states: the state's NRCS FOTG standards and guidance (Kansas and a few western states also extension and other official public pages)", "Texas encoded in js/practices.js from docs/RESEARCH.md; other states in data/practices/XX.json (tools/fetch_efotg.py, tools/build_practices.py)", "48 contiguous states and DC; every statement cited", "—"],
  ];

  /* [quantity, equation, terms and units, where the app uses it, source, status] */
  const EROD = [
    ["Bare-field potential soil loss (WEQ step E3)", "E = I × K × C / 100,&nbsp; K = 1",
      "E: t/ac/yr; I: soil erodibility index (t/ac/yr); K: ridge-roughness factor (1 = smooth); C: climatic factor (%). Wide, bare, unsheltered field.",
      "Overview risk card; statewide susceptibility map", "Woodruff &amp; Siddoway 1965; NRCS National Agronomy Manual Part 502", USED],
    ["Climatic factor", "C = 34.483 · v³ / PE²",
      "v: mean annual wind speed at 30 ft (mph); PE: Thornthwaite index. Garden City, KS = 100.",
      "Site C is NRCS's published value for the map unit. A county SSURGO gives no usable value (none, 0, or Michigan's Upper Peninsula 100) takes this equation with NASA POWER, times 1.64 (the median ratio of official to formula C over the 1,518 rated counties), on the map and at its points; it runs low in the mountain West", "Chepil, Siddoway &amp; Armbrust 1962", USED],
    ["Thornthwaite precipitation-effectiveness index", "PE = Σ<sub>12 months</sub> 115 [ P / (T − 10) ]<sup>10/9</sup>",
      "P: monthly precipitation (in, minimum 0.5); T: monthly mean temperature (°F, minimum 28.4).", "C where SSURGO gives a county no usable value", "Thornthwaite 1931; NAM Part 502", USED],
    ["Erodibility index (highly erodible land, wind)", "EI = C · I / T&nbsp; (C as a fraction)",
      "T: tolerable soil loss from SSURGO (t/ac/yr). EI ≥ 8 meets the wind criterion for highly erodible land.", "Overview risk card", "7 CFR 12.21; NRCS NFSAM", USED],
    ["Wind Erodibility Group and I from the surface layer", "WEG = f(texture, CaCO₃, coarse fragments) → I",
      "Texture guide: WEG 1 sands (I 160–310) · 2 loamy sands (134) · 3 sandy loams (86) · 4 clays (86) · 4L calcareous loams (86) · 5 noncalcareous loams (56) · 6 noncalcareous clayey loams (48) · 7 noncalcareous silts (38) · 8 rock-covered or wet (0); full definitions under Classes and scales. Not applied: iron-rich mineralogy, andic material, wetness, Folists. Calcareous = CaCO₃ ≥ 5% (app proxy for strong effervescence). Coarse fragments (% by volume: SSURGO's fragment volume, else its sieve weight % converted with the bulk density, at least the class of a modifier such as STV) 15–35% → one group less erodible (the next lower I, 86 → 56), 35–60% → two, > 60% → I = 0; sands and loamy sands move less.",
      "Soil tab, when an edit to the surface layer changes what these rules give (otherwise SSURGO's own WEG and I are kept)", "NRCS National Soil Survey Handbook, Part 618, §618.93 (2024)", USED],
    ["Texture class", "USDA texture triangle (sand, silt, clay %)", "Sand-size modifier (e.g. fine sandy loam) kept from the survey when the family is unchanged.",
      "Soil tab", "Soil Survey Manual (USDA Handbook 18, 2017)", USED],
    ["Risk classes", "E &lt; 10 Low · 10–40 Moderate · 40–80 High · 80–150 Very high · ≥ 150 Extreme",
      "t/ac/yr; roughly 2, 8, 16 and 30 times T = 5. The exact E is classed, in every display unit; where rounding to whole numbers would carry it across an edge it is shown with one decimal (39.6, Moderate, not 40).", "Overview risk card; area analysis; Practices", "App convention, not NRCS classes", USED],
    ["Area share of a WEG or risk class", "share<sub>k</sub> = Σ<sub>points</sub> Σ<sub>components</sub> (pct / 100) · [class = k] &nbsp;/&nbsp; Σ<sub>points</sub> Σ<sub>components</sub> (pct / 100)",
      "About 20,000 stratified random points inside the boundary (up to 70,000 on areas over 500 km²; seeded, so the same area gives the same answer). Points on a building, a road (within its class half-width) or water, outside the chosen states, or without soil data are left out; each map unit is split by its component percentages; components without a WEG are reported separately. Acres = share × analysed acres; mean I and E are weighted the same way, with E = I × C / 100; C is the county estimate where SSURGO gives the county no usable value, else the map unit's NRCS climatic-factor C, else the county's or survey area's.",
      "Field or area analysis", "App", USED],
    ["Area grid", "cells from 20 cm up: square, turned, hexagonal or your own;&nbsp; a cell's value = what lies at its centre, or weighted over 25 points in it",
      "Soil from the map units' components on chosen layers (a layer below the end of a profile is blank), weather as the means of the 4 km or coarser cell around it. Finer cells line up with other grids; they add no detail. GeoTIFF, shapefile, GeoJSON, CSV. Laid out in UTM (WGS 84 or NAD83), CONUS Albers or Web Mercator; shapefile and CSV in that, WGS 84 or NAD83 longitude and latitude, Web Mercator or a pasted proj4 definition, with an ESRI .prj; GeoJSON always WGS 84. The data sheet's model files, written once for each soil (a map unit's main soil, or its soils weighted by their %), weather cell and run, linked to the cells by soil_id, wx_id and run_id.", "Field or area analysis", "App; Karney 2011; Snyder 1987", USED],
    ["Road half-widths", "S1100 15 m · S1200 9 m · S1400 5 m · S1630 6 m · S1640 4 m · S1730/S1740/S1750 3 m · S1500 2 m · paths 1.5 m · other 4 m",
      "Census TIGER road class (MTFCC): pavement plus shoulders, measured from the centreline. A point closer than this to a road is “on the road”.", "Area analysis; map-click check", "App", USED],
    ["RWEQ erodible fraction", "EF = (29.09 + 0.31 Sa + 0.17 Si + 0.33 Sa/Cl − 2.59 OM − 0.95 CaCO₃) / 100",
      "Sa, Si, Cl: sand, silt, clay (%); OM, CaCO₃ (%). EF: fraction of dry aggregates &lt; 0.84 mm. Fitted on soils with Sa 5.5–93.6, Si 0.5–69.5, Cl 5–39.3, Sa/Cl 1.2–53, OM 0.18–4.79, CaCO₃ 0–25.2.",
      "Soil tab, as an independent check on WEG", "Fryrear et al. 1994; Fryrear et al. 1998 (RWEQ)", CHECK],
    ["RWEQ soil crust factor", "SCF = 1 / (1 + 0.0066 Cl² + 0.021 OM²)", "Cl: clay (%); OM (%). Lower SCF = stronger crust, less erosion.",
      "Soil tab", "Fryrear et al. 1998 (RWEQ)", CHECK],
    ["Flat cover and erosion", "SLR = e<sup>−0.0438 · SC</sup>",
      "SC: % of soil surface covered; SLR: soil-loss ratio vs bare. The app uses the extension table: 10% cover → 35% less erosion, 30% → 70%, 50% → 85%, 70% → 93%.",
      "Practices tab cover targets (≥ 60% on WEG 1–2, ≥ 40% on WEG 3–4L, ≥ 30% otherwise)", "Fryrear 1985; NebGuide G1537", USED],
    ["Residue needed for a target loss", "residue = E-table ratio × (site E / table E)",
      "NAM Exhibit 502-1 ratios for I 86, C 100, wide field, scaled to the site's E. Approximate.", "Practices tab residue table", "NRCS NAM Exhibit 502-1", USED],
    ["Barrier and ridge spacing", "barrier spacing ≤ 10 H · windbreak protects 10 H leeward + 2 H windward · ridge spacing ≤ 4 × ridge height",
      "H: barrier height. Barriers ≥ 1.5 ft tall, 40–50% porous; trap strips ≥ 15 ft wide.", "Practices tab", "NRCS Texas standards 603, 380, 588, 589C", USED],
    ["RWEQ weather factor", "WF = Wf · (ρ / g) · SW · SD,&nbsp; Wf = Σ U₂ (U₂ − Uₜ)² · N<sub>d</sub> / N",
      "U₂: wind at 2 m (m/s); Uₜ = 5 m/s; ρ: air density; g = 9.81 m/s²; SW: soil wetness; SD: snow-free fraction; N<sub>d</sub>: days in period; N: observations.",
      "Not computed. The app's monthly risk index uses the same idea: wind energy above threshold × dryness.", "Fryrear et al. 1998 (RWEQ)", REF],
    ["RWEQ transport capacity and field length", "Q<sub>max</sub> = 109.8 (WF · EF · SCF · K′ · COG) · s = 150.71 (WF · EF · SCF · K′ · COG)<sup>−0.3711</sup> · Q(x) = Q<sub>max</sub> [1 − e<sup>−(x/s)²</sup>]",
      "Q: kg/m; s: critical field length (m); K′: roughness; COG: crop and residue factors; x: distance downwind (m).",
      "Not computed: needs field length, roughness and cover. NRCS designs fields with WEPS.", "Fryrear et al. 1998 (RWEQ)", REF],
  ];

  const WIND = [
    ["Erosive threshold", "uₜ = 8 m/s at 10 m", "≈ 13 mph at 1 ft ≈ 18 mph at 30 ft. Adjustable 5–12 m/s on the Wind tab.", "All erosive-wind metrics", "Lyles &amp; Krauss 1971; NAM Part 502", USED],
    ["Erosive hours", "N<sub>m</sub> = (n<sub>u ≥ uₜ</sub> / n) × 24 × days<sub>m</sub>", "n: hours with data in month m (normalizes station gaps).", "Overview, Wind tab", "App", USED],
    ["Erosive wind energy", "E<sub>m</sub> = Σ u² (u − uₜ), scaled to a full month", "u: hourly 10 m wind (m/s).", "Risk index, rose, prevailing direction", "After Bagnold 1941 (cubic transport); app", USED],
    ["Dryness", "D = clamp( (ET₀ − P) / ET₀, 0, 1 )", "P: precipitation; ET₀: grass reference ET (mm/month), gridMET.", "Risk index", "App, after FAO 1979", USED],
    ["Monthly risk index and red months", "R<sub>m</sub> = E<sub>m</sub> × D<sub>m</sub>,&nbsp; share<sub>m</sub> = R<sub>m</sub> / Σ R", "Red: share ≥ 10% (8.3% if even); amber ≥ 6.7%. Only for a period covering all 12 months: with fewer, the shares are of the months covered and no month is ranked.", "Month strip, seasonal chart, Practices calendar", "App convention", USED],
    ["Gust days", "daily max gust ≥ 17.9 m/s (40 mph)", "Blowing-dust days.", "Wind tab", "App", USED],
    ["Period", "last 10 complete calendar years, or your own dates (30 days or more inside the model's record, 20 or more of them in one calendar month)", "MERRA-2 from 2001, ECMWF from 1979, both up to a few days ago; days run midnight to midnight in the location's state's standard time (no daylight saving; Texas: CST, UTC−6). Monthly values need 480 hours or more; yearly totals need all 12 months; the trend needs 5 complete years. The page address keeps the period and the model. If the chosen model fails, the other one is used for the same dates, or for as many of them as its record holds.", "Wind tab, Overview", "App", USED],
    ["Log-law height conversion", "u₂ = u<sub>z</sub> · 4.87 / ln(67.8 z − 5.42) → u₂ = 0.748 u₁₀", "z: measurement height (m).", "FAO climatic index", "Allen et al. 1998, FAO-56 Eq. 47", USED],
    ["FAO wind-erosion climatic index", "C<sub>FAO</sub> = (1/100) Σ<sub>months</sub> u₂³ · (ET₀ − P)/ET₀ · d", "u₂: mean monthly wind at 2 m (m/s); d: days. Months with P &gt; ET₀ count as 0.", "Wind tab", "FAO 1979", USED],
    ["Sand drift potential", "DP = Σ V² (V − Vₜ) / N,&nbsp; Vₜ = 12 kt", "V: hourly wind at 10 m (knots); N: all hours. RDP: length of the vector sum; RDD: its direction. DP &lt; 200 low, 200–399 intermediate, ≥ 400 high (VU).",
      "Wind tab", "Fryberger &amp; Dean 1979", USED],
    ["Prevailing erosive direction", "sector k with max 0.5 E<sub>k−1</sub> + E<sub>k</sub> + 0.5 E<sub>k+1</sub>", "16 sectors of 22.5°. Barrier and strip rows run at that direction + 90°. None when no hour reaches the threshold.", "Wind tab, Practices", "App", USED],
    ["Resultant transport direction", "atan2( Σ E sin(θ + 180°), Σ E cos(θ + 180°) )", "θ: direction the wind blows from.", "Wind tab", "App", USED],
    ["Trend", "b = Σ(x − x̄)(y − ȳ) / Σ(x − x̄)²,&nbsp; t = b / SE(b)", "y: erosive hours per year; x: year. Significant if |t| &gt; t<sub>0.975, n−2</sub>.", "Wind tab", "Ordinary least squares", USED],
    ["Calibration to the nearest station (quantile mapping)", "u′ = F<sup>−1</sup><sub>obs, m</sub>( F<sub>model, m</sub>(u) )",
      "F: empirical distribution for calendar month m, 101 quantiles 0.1–99.9%, trained on the model at the station's cell vs the station, same hours; beyond the ends u′ = u · q<sub>obs</sub>/q<sub>model</sub>. Applied to the model at the site. Gusts mapped the same way, always to an airport. A mesonet tower, when switched on, trains on its latest complete years only.",
      "Wind tab default", "Panofsky &amp; Brier 1968; Themeßl et al. 2011", USED],
    ["Station hourly series and QC", "report nearest each whole hour (routine METAR, FM-15)", "Dropped: u &gt; 40 m/s, gust &gt; 55 m/s or below u, NCEI quality codes 2, 3, 6, 7. Mesonet towers (when on): the :00 value; runs of 6+ hours at one non-zero speed or 3+ calm hours dropped; skipped when they record &lt; 0.85 times the airport's hours ≥ 8 m/s, each relative to the model.", "Calibration, station-only option", "App", USED],
    ["Model vs station statistics", "bias = mean(u<sub>model</sub> − u<sub>obs</sub>) · RMSE = √mean((u<sub>model</sub> − u<sub>obs</sub>)²) · Pearson r", "Same hours at the station.", "Comparison card", "Standard", USED],
    ["Grass reference ET₀ (computed by gridMET)", "ET₀ = [0.408 Δ (R<sub>n</sub> − G) + γ (900 / (T + 273)) u₂ (e<sub>s</sub> − e<sub>a</sub>)] / [Δ + γ (1 + 0.34 u₂)]",
      "ASCE standardized Penman–Monteith, daily, short grass: Δ slope of vapor-pressure curve, R<sub>n</sub> net radiation, G soil heat flux, γ psychrometric constant, e<sub>s</sub> − e<sub>a</sub> vapor-pressure deficit.",
      "Dryness factor, moisture chart", "ASCE-EWRI 2005; Abatzoglou 2013", USED],
    ["Grass reference ET₀ from NASA POWER (computed in the app)", "same Penman–Monteith form, daily: R<sub>n</sub> = 0.77 R<sub>s</sub> − R<sub>nl</sub>; e<sub>a</sub> from dew point; γ from elevation",
      "FAO-56 Eqs. 6–21 and 37–40 with POWER T<sub>max</sub>, T<sub>min</sub>, dew point, 2 m wind and all-sky solar radiation R<sub>s</sub> (MJ m⁻² d⁻¹). At Lubbock it runs 5% above gridMET (1,984 vs 1,886 mm/yr) with the same monthly pattern.",
      "When gridMET fails", "Allen et al. 1998 (FAO-56)", FALLBACK],
    ["Hargreaves ET₀", "ET₀ = 0.0023 (R<sub>a</sub> / 2.45)(T + 17.8) √(T<sub>max</sub> − T<sub>min</sub>)", "R<sub>a</sub>: extraterrestrial radiation, FAO-56 Eq. 21; T in °C.",
      "Only for days of NASA POWER or your weather file missing radiation, dew point or wind", "Hargreaves &amp; Samani 1985", FALLBACK],
  ];

  const SOIL = [
    ["Wilting point (Saxton &amp; Rawls)", "θ₁₅₀₀ₜ = −0.024S + 0.487C + 0.006OM + 0.005 S·OM − 0.013 C·OM + 0.068 S·C + 0.031;&nbsp; θ₁₅₀₀ = θ₁₅₀₀ₜ + (0.14 θ₁₅₀₀ₜ − 0.02)",
      "S, C: sand and clay fractions (scaled to 1 together if above); OM: % (capped at 8). Kept physical: θ₁₅₀₀ ≥ 0.01, θ₃₃ ≥ θ₁₅₀₀ + 0.01, θ<sub>S</sub> ≥ θ₃₃ + 0.01, with ρ<sub>B</sub> and K<sub>s</sub> from these.", "Edited surface layer; blanks in your own soil", "Saxton &amp; Rawls 2006", USED],
    ["Field capacity", "θ₃₃ₜ = −0.251S + 0.195C + 0.011OM + 0.006 S·OM − 0.027 C·OM + 0.452 S·C + 0.299;&nbsp; θ₃₃ = θ₃₃ₜ + (1.283 θ₃₃ₜ² − 0.374 θ₃₃ₜ − 0.015)", "", "Edited surface layer", "Saxton &amp; Rawls 2006", USED],
    ["Saturation", "θ<sub>S−33t</sub> = 0.278S + 0.034C + 0.022OM − 0.018 S·OM − 0.027 C·OM − 0.584 S·C + 0.078;&nbsp; θ<sub>S−33</sub> = θ<sub>S−33t</sub> + (0.636 θ<sub>S−33t</sub> − 0.107);&nbsp; θ<sub>S</sub> = θ₃₃ + θ<sub>S−33</sub> − 0.097S + 0.043", "", "Edited surface layer", "Saxton &amp; Rawls 2006", USED],
    ["Bulk density", "ρ<sub>B</sub> = (1 − θ<sub>S</sub>) × 2.65", "g/cm³.", "Edited surface layer", "Saxton &amp; Rawls 2006", USED],
    ["Saturated conductivity", "B = (ln 1500 − ln 33) / (ln θ₃₃ − ln θ₁₅₀₀);&nbsp; K<sub>s</sub> = 1930 (θ<sub>S</sub> − θ₃₃)<sup>3 − 1/B</sup>", "K<sub>s</sub> in mm/h.", "Edited surface layer", "Saxton &amp; Rawls 2006", USED],
    ["Plant-available water", "AWC = DUL − LL", "cm³/cm³; shown in the AWC unit of the units table.", "Soil profile tab", "—", USED],
    ["Organic carbon; total N", "OC = OM / 1.724;&nbsp; N ≈ OC / 10, at most 0.5%", "%.", "Soil profile, .SOL export", "Van Bemmelen factor; DSSAT convention", USED],
    ["Saturation check", "SAT = <code>wsatiated_r</code>/100, else Saxton–Rawls, else 1 − ρ<sub>B</sub>/2.65;&nbsp; SAT ≥ DUL + 0.01", "", "Soil profile", "DSSAT convention", USED],
    ["Unit conversions", "K<sub>sat</sub> (cm/h) = µm/s × 0.36 · coarse fragments = 100 − % passing #10 sieve", "", "Soil profile", "—", USED],
    ["Root growth factor", "SRGF = 1 (layer ending ≤ 15 cm), else exp(−0.02 × mid-depth); 0 below a restrictive layer", "Depth in cm.", "Soil profile, .SOL export", "DSSAT convention", USED],
    ["Stage-1 evaporation limit", "U = 4 for sand and loamy sand · 8 for clay, silty clay and sandy clay · 6 for the other classes", "U in mm, by the surface texture class.", "DSSAT, APSIM files", "HC27 generic soils (Han et al. 2019); CSM default 6", USED],
    ["Drainage rate", "very poorly 0.01 · poorly 0.05 · somewhat poorly 0.25 · moderately well 0.40 · well 0.60 · somewhat excessively 0.75 · excessively 0.85", "Fraction per day.", ".SOL export", "DSSAT convention", USED],
    ["Runoff curve number", "A 61/64/68/71 · B 73/76/80/83 · C 81/84/88/91 · D 84/87/91/94", "By hydrologic group (second letter of dual groups) and slope 0–2, 2–5, 5–10, &gt; 10%.", ".SOL export", "NRCS NEH Part 630; DSSAT", USED],
    ["Slope and aspect from the DEM", "slope = 100 √(g<sub>x</sub>² + g<sub>y</sub>²),&nbsp; g<sub>x</sub> = (z<sub>E</sub> − z<sub>W</sub>) / 2Δx,&nbsp; aspect = atan2(−g<sub>x</sub>, −g<sub>y</sub>)", "Elevations 100 m N, S, E and W of the point.", "Header, soil profile", "Finite differences", USED],
  ];

  /* model files from the data sheet: [quantity, equation, terms, used for, source, status] */
  const FILES = [
    ["Daily weather (gridMET)", "T = K − 273.15;&nbsp; R<sub>s</sub> (MJ/m²/d) = W/m² × 0.0864;&nbsp; e<sub>a</sub> = q p / (0.622 + 0.378 q);&nbsp; u₂ = 0.748 u₁₀",
      "q: specific humidity; p: air pressure from elevation (FAO-56 Eq. 7). ET₀ = gridMET's grass reference (ASCE standardized).", "All model files", "Abatzoglou 2013; Allen et al. 1998", USED],
    ["Daily weather (PRISM)", "rain, T<sub>max</sub>, T<sub>min</sub> of calendar day D = PRISM's date D + 1;&nbsp; R<sub>s</sub>, humidity, wind from gridMET;&nbsp; ET₀ by FAO-56 Penman–Monteith",
      "PRISM's day ends at 1200 UTC on its date, so it is mostly the day before: in 2023 T<sub>max</sub> against 7 airports has r 0.993–0.998 shifted, 0.88–0.96 as labelled. So files differ by a day from PRISM's own. Read through ACIS GridData, grid 21; its last six months are provisional.", "All model files", "PRISM Group, Oregon State University; NOAA RCC ACIS", USED],
    ["Daily weather (NASA POWER or your file)", "ET₀ by FAO-56 Penman–Monteith; Hargreaves (Eq. 52) on days without radiation, dew point or wind",
      "Your file: °C/°F, mm/in, MJ/W/kW/langley/kWh, m/s/mph/km/h/kn; wind at any height moved to 10 and 2 m with the log law (z₀ = 0.03 m). A column's name can state its unit and a wind column its height, as the template the sheet makes does (tmax (F), wind at 3 m (mph)); the choices in the sheet apply to the others. Excel is read as stored values; blank or text cells and codes of −99 or below are missing; “T” rain is 0; columns are found by name and the sheet lists them; a Campbell TOA5 daily record stamped at midnight is the day before; rows through the day are summarised, rain as amounts, a daily value repeated on each row, a running daily total, a running total that resets at another hour, or a season total, as its rows and name show, with a note. ET₀ is the file's own grass-reference column where it has one (never ETr, pan evaporation or PET), else FAO-56 from its columns after any gap filling, with R<sub>s</sub> from the temperature range (Eq. 50) on days without it and Hargreaves on days without humidity or wind; the README counts the days. gridMET's ET₀ is not copied in.", "All model files", "Allen et al. 1998", USED],
    ["Dates", "the chosen dates, cut to the source's record", "gridMET 1979 to about 2 days ago; PRISM 1981 to about 3 days ago; NASA POWER 1981 to about 8 days ago; your file its own days, unless gaps are filled from gridMET. The status line and README say when dates were left out.", "All model files", "App", USED],
    ["Humidity from relative humidity", "e<sub>a</sub> = [e°(T<sub>min</sub>) RH<sub>max</sub> + e°(T<sub>max</sub>) RH<sub>min</sub>] / 200, else e<sub>a</sub> = RH<sub>mean</sub>/100 × [e°(T<sub>max</sub>) + e°(T<sub>min</sub>)] / 2",
      "e°(T) = 0.6108 exp(17.27 T / (T + 237.3)) kPa; dew point from e<sub>a</sub>.", "Your weather file", "FAO-56 Eqs. 11, 17, 19", USED],
    ["Values taken as missing", "rain, R<sub>s</sub>, humidity, vapour pressure or wind &lt; 0;&nbsp; R<sub>s</sub> &lt; 0.1 or &gt; 50 MJ/m²;&nbsp; T outside −60…60 °C;&nbsp; T<sub>max</sub> = T<sub>min</sub> = 0, with all zeros on that row",
      "Your file: −99 and below, 999, 9999 and 6999 are gaps on reading, unless the column's unit can hold them; the reader's notes and each README count them.", "All model files", "App", USED],
    ["CENTURY weather .wth", "prec (cm/month) = Σ valid days' rain / 10 × days in month / valid days;&nbsp; tmin, tmax = means of the days with both;&nbsp; −99.99 under 20 valid days",
      "format(a4,6x,12f7.0), whole calendar years. The model fills flagged temperature from TMN2M, TMX2M, and draws flagged rain from PRECIP, PRCSTD, PRCSKW.", "CENTURY .wth", "Century 4.0 weathr.f, wthini.f", USED],
    ["CENTURY climate lines", "mean;&nbsp; var = Σx²/n − mean²;&nbsp; skew = (Σx³/n − 3 mean var − mean³) / var<sup>1.5</sup>",
      "On monthly values: population variance. From the chosen dates with 10 years in each month, else 10 complete years read for them.", "CENTURY and DayCent .100", "FILE100 f_wthr.c", USED],
    ["CENTURY soil", "SAND, SILT, CLAY, BULKD, PH: top 20 cm of mineral soil;&nbsp; AWILT, AFIEL per ADEP layer, AFIEL ≥ AWILT + 0.01;&nbsp; b = Σ (OM/1.724) BD Δz × 100 g C/m², split .03, .44, .53",
      "Thickness-weighted (our choice; no source gives one). Layers assume ADEP 15, 15, 15, 15, 30, 30, 30, 30 cm; NLAYER is the nearest boundary to the soil's thickness, at most 8. Without OM: IVAUTO 1 (Burke), floored at 500 g C/m². Plant and nutrient lines are NREL's Colorado shortgrass sample. Not run in the model.", "CENTURY .100", "CENTURY Workbook; Century 4.0 sitein.f, prelim.f, h2olos.f", USED],
    ["DayCent weather .wth", "rain (cm) = mm / 10;&nbsp; R<sub>s</sub> (langley/day) = MJ/m² × 23.9006;&nbsp; u₂ (mph) = m/s × 2.23694;&nbsp; −99.99 on days outside the dates",
      "One row a day, 1 January to 31 December, as the model checks month and day of the year. Solar radiation, humidity and wind only when every row has them (usexdrvrs 1). Flagged temperature takes TMX2M, TMN2M; flagged rain is 0.", "DayCent .wth", "DailyDayCent Dec 2016 getwth.f", USED],
    ["DayCent soils.in", "row = Σ w<sub>i</sub> x<sub>i</sub> / Σ w<sub>i</sub>;&nbsp; K<sub>sat</sub> (cm/s) = harmonic mean (mm/h) / 36,000;&nbsp; deltamin ≤ 0.8 WP;&nbsp; site file SAND … AFIEL = width-weighted means of the rows",
      "Rows of NREL's examples (2, 5, 10, 20, 30, 45 … 210 cm) or your layers split at 2, 5 cm and ADEP 10, 20, 15, 15, 30 … cm; whole cm, at most 20 rows and 9 CENTURY layers (210 cm). Roots and deltamin from NREL's Wooster file. Not run in the model.", "DayCent soils.in, .100", "DailyDayCent Dec 2016 initlyrs.c, setlyrs.c, sitein.f; DayCent manual App. 1.16", USED],
    ["DayCent bottom soil temperature", "tbotmn, tbotmx = T̄ ± ½ ΔT exp(−(z + 5)/d);&nbsp; d = √(2κ/ω) = 147 cm",
      "T̄, ΔT: mean and yearly range of the climate lines' monthly air temperature; z: profile depth (cm); κ = 0.00215 cm²/s, the model's diffusivity. An estimate: no source gives a rule.", "DayCent sitepar.in", "Heat conduction; DailyDayCent soiltemp.c", USED],
    ["Gaps (DSSAT, APSIM, AquaCrop)", "T<sub>max</sub>, T<sub>min</sub>, wind: linear between neighbouring days;&nbsp; R<sub>s</sub> = 0.16 √(T<sub>max</sub> − T<sub>min</sub>) R<sub>a</sub>;&nbsp; rain 0;&nbsp; ET₀ by FAO-56",
      "These models stop on a missing value. Their files run from the first to the last day with both T<sub>max</sub> and T<sub>min</sub>; linear filling reaches 3 days past the data, and a longer run of wind at either end takes that calendar month's mean over the days written (the overall mean if the month has none). Each folder's README counts the filled days. SWAT+, EPIC and APEX get their missing-value code and generate those days.", "DSSAT, APSIM, AquaCrop files", "FAO-56 Eqs. 21, 50", USED],
    ["TAV and AMP", "monthly means of (T<sub>max</sub> + T<sub>min</sub>)/2;&nbsp; TAV = mean of the 12;&nbsp; AMP = warmest − coldest month",
      "DSSAT pools all years (as CSM and its official files do); APSIM averages complete calendar years. When the dates do not cover every month, 10 complete years are read for these and for the generator statistics; if that read fails, they come from the months the dates have, marked approximate.", "DSSAT .WTH, APSIM .met", "DSSAT-CSM 4.8; APSIM tav_amp", USED],
    ["Weather-generator statistics", "per month: mean and SD of T<sub>max</sub>, T<sub>min</sub>; rain mean, SD, skew; P(W|D), P(W|W); wet days; mean solar, humidity, wind",
      "EPIC/APEX: wet day &gt; 0 mm, as WXPM3020 (matches its output within 0.001). SWAT+: wet day ≥ 0.1 mm; max half-hour rain = a third of each month's largest daily rain. Each group comes from the chosen dates when every month has 20+ days of it, else from 10 complete years with 20+, else from the dates with 10+, else from the 10 years with 10+ (these last two with a note); otherwise the files are not written rather than written with zeros. Rain totals and wet days are per whole month.", ".WP1, weather-wgn.cli", "WXPM3020; SWAT+ IO", USED],
    ["Wind height", "DSSAT, APSIM: u₂ (2 m);&nbsp; SWAT+: u<sub>1.7</sub> = u₁₀ × 0.17<sup>0.2</sup> = 0.70 u₁₀;&nbsp; EPIC, APEX: u₁₀",
      "DSSAT WIND in km/day (m/s × 86.4).", "All weather files", "FAO-56; SWAT theory 1:1.4", USED],
    ["CO₂ (APSIM)", "NOAA Mauna Loa annual mean, 1959–2025; +2.5 ppm a year after, the 1959 value before", "APSIM Next Gen assumes 350 ppm without it. DSSAT and AquaCrop use their own Mauna Loa files.", "APSIM .met", "NOAA GML", USED],
    ["Soil layers", "custom layer = Σ w<sub>i</sub> x<sub>i</sub> / Σ w<sub>i</sub>;&nbsp; K<sub>sat</sub> = Σ w<sub>i</sub> / Σ (w<sub>i</sub> / K<sub>i</sub>)",
      "w<sub>i</sub>: overlap (cm) with horizon i. Usual layers: DSSAT splits the horizons at 5, 15, 30, 45, 60, 90, 120, 150, 180, 210 cm; APSIM 150, 150, 300 … mm. In any layering, DSSAT ≤ 20, EPIC ≤ 15, APEX and the SWAT+ user table ≤ 10, AquaCrop ≤ 5 (thinnest neighbours merged). Organic matter, carbon, CaCO₃ and N take w<sub>i</sub> × BD<sub>i</sub>, as fractions by mass. The profile ends at the first horizon without water retention or bulk density; a profile that simply stops is extended with its deepest horizon.", "All soil files", "App", USED],
    ["DSSAT soil ID", "WG + 8-digit component key (unedited survey soil, usual layers);&nbsp; else WG + 8 characters from the written soil table",
      "DSSAT runs the first profile in WG.SOL with a matching ID, so other layers or values always get another ID.", "DSSAT WG.SOL", "App", USED],
    ["APSIM soil limits", "SAT ≤ 1 − BD/2.65 − 0.001;&nbsp; AirDry = 0.5 LL15 (top layer);&nbsp; KS = K<sub>sat</sub> × 24 mm/day", "Crop KL 0.06 down to 0.01 with depth, XF 1 (0 below a restrictive layer); initial water at DUL.", "APSIM .apsimx", "ApsimX Soil.Check; apsimx R package", USED],
    ["AquaCrop soil", "CN: A 46 · B 61 · C 72 · D 77;&nbsp; REW = round(10 (FC − WP/2) × 0.04), 0–15;&nbsp; CRa, CRb from the soil class", "FC, WP, SAT in vol %; K<sub>sat</sub> mm/day; gravel 0 (survey water contents are whole-soil).", "AquaCrop .SOL", "AquaCrop 7.3 manual, Tables 2.14d, 2.24s", USED],
    ["USLE K for your own soil (SWAT+)", "K = f<sub>csand</sub> f<sub>cl-si</sub> f<sub>orgc</sub> f<sub>hisand</sub>", "Used when a layer has no survey K; sand, silt, clay %, organic C %.", "SWAT+ soils.sol", "Williams 1995; SWAT theory 4:1.1", USED],
    ["Preview", "the data the files are written from, drawn: rain and ET₀ as sums per step of the days with data, the rest as means",
      "Weather by day, month or year; each model's soil layers; the wind series and summaries; the files' first lines. Nothing is saved until Download, which reads nothing twice.", "Data sheet", "App", USED],
    ["Figure files", "pixels = inches × DPI, rounded to a whole pixel on each axis;&nbsp; PNG pHYs, JPEG JFIF density and TIFF resolution tags carry the DPI", "Fonts in points (1 pt = DPI/72 pixels). TIFF: baseline RGB, PackBits.", "Figure downloads", "PNG 3rd ed.; JFIF 1.02; TIFF 6.0", USED],
  ];

  /* [number on screen, its scale, what it means]: so no value reads as a score out of 100. */
  function scaleRows() {
    const site = WG.region && WG.region.site(), ov = site && site.overlays, st = (ov && ov.stats) || {}, where = site ? site.name : ""; // the location's state, where its statewide maps are built
    const tx = st.E_pct_by_class, c = st.C_range;
    const pct = v => Math.round(v);
    return [
      ["<b>Bare-soil potential E</b> (risk card, area tool)", "0 and up, t/ac/yr: &lt; 10 Low · 10–40 Moderate · 40–80 High · 80–150 Very high · ≥ 150 Extreme",
        `Tons of soil per acre per year a wide, bare, smooth, unsheltered field could lose: E = I × C / 100. An amount, not a score. The classes are this app's, not NRCS's${tx ? `; across ${where}, ${pct(tx[0])}% of the rated land is Low, ${pct(tx[1])}% Moderate, ${pct(tx[2])}% High, ${pct(tx[3])}% Very high and ${pct(tx[4])}% Extreme` : ""}.`],
      ["<b>Wind Erodibility Group</b> (WEG)", "1, 2, 3, 4, 4L, 5, 6, 7, 8",
        "NRCS groups surface soils by how easily they blow: 1 is the most erodible, 8 is not erodible. Groups 3, 4 and 4L share I = 86; 4L holds calcareous (limy) loamy soils. Texture guide in the table below."],
      ["<b>Wind erodibility index I</b>", "0–310 t/ac/yr",
        "Set by the WEG: the yearly loss from a wide, bare, smooth field in the climate of Garden City, Kansas (C = 100)."],
      ["<b>Climatic factor C</b>", `percent of Garden City, KS (= 100)${c ? `; ${where} ${(WG.fmtC || Math.round)(c[0])}–${(WG.fmtC || Math.round)(c[1])}` : ""}`,
        "How strongly wind speed and dryness drive erosion: C = 34.483 v³ / PE². Higher is windier or drier."],
      ["<b>Tolerable soil loss T</b>", "1–5 t/ac/yr", "The most a soil can lose each year without losing productivity (SSURGO); deep soils are 5."],
      ["<b>Erodibility index EI</b> = C·I/T", "0 and up; 8 or more = highly erodible land", "The USDA wind criterion for highly erodible land (7 CFR 12.21), with C as a fraction."],
      ["<b>Erosive wind hours</b>", "0–8,760 h/yr", `Hours a year with 10 m wind at or above the erosive threshold (${WG.units.fmt("wind", 8, ["m/s", "kn"].includes(WG.units.sym("wind")) ? 1 : 0)} by default, adjustable on the Wind tab).`],
      ["<b>Month strip</b> (Overview)", "share of the year's risk: red ≥ 10%, amber ≥ 6.7%", "Erosive wind energy × dryness in each month, as a share of the year's total. A period that does not cover all 12 months is not ranked: its months are gray."],
      ["<b>Sand drift potential DP</b> (Wind tab)", "vector units: &lt; 200 low · 200–399 intermediate · ≥ 400 high", "Fryberger &amp; Dean 1979; RDP/DP below 0.3 multidirectional, 0.3–0.8 intermediate, above 0.8 one direction."],
    ];
  }
  const wegRows = () => WG.soil.WEG_INFO.map(w => [`<b>${w.g}</b>`, `<b>${esc(w.name)}</b>: ${esc(w.def)}`, w.I]);

  function table(cols, rows, cls) {
    return `<div class="mtable-wrap"><table class="mtable ${cls || ""}"><thead><tr>${cols.map(c => `<th>${c}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(r => `<tr>${r.map((v, i) => `<td data-label="${esc(cols[i])}">${v}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  const eqRows = rows => rows.map(([q, eq, terms, use, src, st]) => [`<b>${q}</b> ${st}`, `<span class="eq">${eq}</span>`, terms, use, src]);
  /* the Drought theme and tab (js/weather.js) */
  const LIVE = [
    ["Drought Monitor week of a date", "the Tuesday on or before day d: d − ((d − 4 Jan 2000) mod 7)", "Kept between 4 January 2000, the first map, and this week's. A month shows its last week.", "Drought map, Drought tab", "U.S. Drought Monitor", USED],
    ["Drought classes (SPI, SPEI)", "D0 ≤ −0.5 · D1 ≤ −0.8 · D2 ≤ −1.3 · D3 ≤ −1.6 · D4 ≤ −2.0", "The Drought Monitor's ranges for SPI and SPEI. It gives none for PDSI, so PDSI is shown as values (below 0 drier).", "Drought tab", A("https://droughtmonitor.unl.edu/About/AbouttheData/DroughtClassification.aspx", "U.S. Drought Monitor, Drought Classification"), USED],
    ["Index value", "x = raw × scale_factor + add_offset", "gridMET Drought's packed integers (SPI, SPEI: 0.01 and −5; PDSI: 0.01 and −15), read from each file.", "Drought tab", "gridMET Drought", USED],
    ["Share of a year in drought", "100 × (5-day values in D1–D4) / (5-day values that year)", "Years with 70 or more values. Driest and wettest year: lowest and highest mean of the index.", "Drought tab", "App", USED],
    ["Year against year", "each year's 5-day values placed by day of the year, in 73 steps of 5 days", "", "Drought tab", "App", USED],
    ["Drought class of a grid cell", "the nearest of D0 (255,255,0), D1 (255,211,127), D2 (255,170,0), D3 (230,0,0), D4 (115,0,0); alpha &lt; 128 = none", "Each week's map read as a PNG at about 0.001° a pixel. Centre: the pixel under the cell centre; area: the majority of 25 points (shares: their mean). 99.98–99.995% of pixels agree with NDMC's polygons.", "Area grid (dm_*)", "U.S. Drought Monitor", USED],
    ["Shares of weeks and longest run", "dm_dNp = 100 × (weeks in DN or worse) / (weeks read); dm_run = longest run of D1+ weeks", "Cumulative classes, as the Drought Monitor's statistics count them. A week that cannot be read is left out and does not end a run.", "Area grid", "App", USED],
  ];
  /* the Soil maps theme and tab (js/soilmaps.js) */
  const SOILMAPS = [
    ["Value over a depth", "Σ(value × thickness) / Σ thickness, over 0–15 and 0–30 cm", "Horizons with a value only; the map unit's value is weighted by component share. gNATSGO is weighted the same way over each depth.", "Soil maps tab, map", "SSURGO; USFS gNATSGO", USED],
    ["Soil reaction class", "&lt; 3.5 ultra acid … &gt; 9.0 very strongly alkaline", "pH 1:1 in water (CaCl₂ when that is all the survey gives); limits halfway between the 0.1 steps.", "Soil maps tab, map legend", "Soil Survey Manual", USED],
    ["Overview pH group", "≤ 5.5 strongly acid · 5.6–6.5 acid · 6.6–7.3 neutral · 7.4–8.4 alkaline · &gt; 8.4 strongly alkaline", "The reaction classes in five groups, for the survey's dominant component at 0–15 cm; they colour the Overview's headline.", "Soil maps Overview", "Soil Survey Manual (2017); app", USED],
    ["Salinity class", "EC &lt; 2 non-saline · 2–4 very slightly · 4–8 slightly · 8–16 moderately · ≥ 16 strongly saline", "EC of the saturated paste, dS/m.", "Soil maps tab, map legend", "Soil Survey Manual", USED],
    ["Sodic and saline", "sodic: SAR ≥ 13 or ESP ≥ 15 · saline: EC ≥ 4 · saline-sodic: both", "", "Soil maps tab", "U.S. Salinity Laboratory, Handbook 60", USED],
    ["Base saturation", "BS = sum of bases / CEC₇ × 100", "CEC by NH₄OAc at pH 7 (ECEC when that is all the survey gives).", "Soil maps tab", "SSURGO", USED],
    ["Total nitrogen", "g/kg = SoilGrids cg/kg ÷ 100", "Mean and 5–95% range at 250 m. Overview tile class, g/kg: very low &lt; 1, low 1–2, medium 2–5, high 5–10, very high &gt; 10.", "Soil maps tab, map, Overview", "ISRIC SoilGrids 2.0; Landon 1991", USED],
  ];
  /* basins in the Soil maps theme and tab (js/basins.js) */
  const BASINS = [
    ["Mean annual runoff (EROM)", "R = 893.6 × q<sub>incr</sub> / A;&nbsp; HU12: 893.6 Σq / ΣA", "q<sub>incr</sub>: qincrama (cfs) of the catchment; A: its area (km²); R in mm/yr; 1 cfs for a year = 893,600 m³. Stream catchments whose centroid is in the HU12; sinks have none.", "Soil maps tab, basin", "NHDPlus HR EROM step A (McCabe-Wolock); app", USED],
    ["Upstream catchments", "every flowline whose dnhydroseq or dnminorhyd leads to the point's hydroseq", "Inside the HU12 only; NLDI's basin for the whole drainage.", "Soil maps tab, basin", "NHDPlus HR VAA", USED],
    ["SCS runoff", "Q = (P − I<sub>a</sub>)² / (P − I<sub>a</sub> + S) for P &gt; I<sub>a</sub>;&nbsp; S = 25400/CN − 254 mm;&nbsp; I<sub>a</sub> = 0.2 S", "P: 24-hour depth (Atlas 14 or typed). Q for each NLCD class and soil group, averaged by their shares; CN from TR-55 Table 2-2, AMC II (wetlands 78, assumed).", "Soil maps tab, design storm", "NRCS TR-55 (1986)", USED],
    ["Area-weighted CN", "CN = Σ<sub>c</sub> a<sub>c</sub> Σ<sub>g</sub> h<sub>g</sub> CN<sub>c,g</sub>", "a<sub>c</sub>: share of land in class c; h<sub>g</sub>: share of hydrologic group g (dual groups as undrained); open water and ice left out.", "Soil maps tab, design storm", "TR-55; app", USED],
    ["Atlas 14 depth at the point", "the 0.05° cell = mean of its 6 × 6 30″ cells", "Or the nearest of its 8 neighbours with all three depths.", "Soil maps tab, design storm", "NOAA Atlas 14; app", USED],
    ["RUSLE", "A = R K LS C P;&nbsp; t/ha = 2.2417 × t/ac;&nbsp; R<sub>SI</sub> = 17.02 R;&nbsp; K<sub>SI</sub> = 0.1317 K", "R: RF7100 for the point's NHDPlus V2 catchment; K: surface Kw (Kf where blank); K × LS per component, weighted by map-unit area × comppct; C by NLCD class (cropland yours); P yours.", "Soil maps tab, soil loss", "Renard et al. 1997 (AH 703)", USED],
    ["Slope steepness S", "S = 10.8 sin θ + 0.03 (s &lt; 9%);&nbsp; 16.8 sin θ − 0.5 (s ≥ 9%)", "θ = atan(s/100), s the component's representative slope.", "Soil maps tab, soil loss", "McCool et al. 1987", USED],
    ["Slope length L", "L = (λ / 22.13)<sup>m</sup>;&nbsp; m = 0.2 (&lt; 1%), 0.3 (1–3.5%), 0.4 (3.5–5%), 0.5 (≥ 5%)", "λ: SSURGO USLE slope length (m).", "Soil maps tab, soil loss", "Wischmeier &amp; Smith 1978", USED],
    ["Soil moved each year", "tons = A × land km² × 247.105", "Short tons; × 0.90718 = t.", "Soil maps tab, soil loss", "App", USED],
  ];
  /* soil moisture in the Soil maps theme and tab (js/soilmoisture.js) */
  const MOISTURE = [
    ["Volumetric water content", "θ (m³/m³) = AWDB % ÷ 100;&nbsp; depth cm = in × 2.54", "USCRN reports m³/m³; NWM SOILSAT_TOP is a fraction of saturation, not θ.", "Soil maps tab, soil moisture", "NRCS AWDB; NOAA USCRN; NWM", USED],
    ["Daily means", "mean of the local day's hourly values (IFS); the providers' daily means (ERA5-Land, SMAP L4, AWDB SMV, USCRN)", "Today's IFS mean includes forecast hours.", "Soil maps tab, soil moisture", "Open-Meteo; Crop-CASMA; AWDB; USCRN", USED],
    ["NWM grid cell", "Lambert conformal conic, sphere 6,370 km, φ₁ 30°, φ₂ 60°, φ₀ 40° N, λ₀ 97° W;&nbsp; i = round((x − x₀)/Δx)", "x₀ and Δx from the file's x and y; 1 km.", "Soil maps tab, NWM on request", "NOAA OWP NWM 3.0", USED],
  ];
  const EQ_COLS = ["Quantity", "Equation", "Terms and units", "Used for", "Source"];

  function siteHTML() {
    const rows = WG.siteSources ? WG.siteSources() : [];
    if (!WG.state.site) return '<p class="fine">Tap a location on the map to see which source supplied each value there.</p>';
    if (!rows.length) return '<p class="fine">Still loading data for this location…</p>';
    return table(["Data", "Value used here", "Source"], rows, "site");
  }

  function render() {
    $("#methodsBody").innerHTML = `
      <p class="fine">“Direct” means the app downloads from the agency that produces the data. Every default source is direct, except the soil moisture models by depth on the Soil maps tab (ERA5-Land and ECMWF IFS), which only Open-Meteo's copy serves without a personal key. Otherwise Open-Meteo is only a backup: for hourly wind when NASA POWER errors or has not answered within 20 s, for daily weather when gridMET and NASA POWER both fail, and for elevation when USGS fails. You can still pick <b>ECMWF (Open-Meteo copy)</b> under Model on the Wind tab; Copernicus's own data store needs each user's personal key and a queued job that takes minutes. At Lubbock, ECMWF tracks the airport hour by hour slightly better (r = 0.80 against 0.71 for MERRA-2), and after calibration both give 1,291–1,295 erosive h/yr, Feb–Apr, from the WSW.</p>
      <section id="m-site"><h4>This location</h4>${siteHTML()}</section>
      <section id="m-scales"><h4>Classes and scales</h4>${table(["Number on screen", "Scale", "What it means"], scaleRows(), "scales")}
        <p class="fine">Every number follows the units table (the ruler button on the map). Classes keep the units they are defined in (E and I in t/ac/yr, NRCS practice specifications in US units) and are converted for display; model files always use each model's own units.</p>
        <h4>Wind Erodibility Groups</h4>${table(["WEG", "Texture guide", "I, t/ac/yr"], wegRows(), "weg")}
        <p class="fine">For a named soil, NRCS uses the group recorded in the soil survey; the texture guide is for soils that are not identified (${A("https://efotg.sc.egov.usda.gov/references/public/TX/Wind_Erosion.pdf", "National Agronomy Manual, Part 502")}). So a soil's group can differ from what its texture suggests: Pullman clay loam, for example, is WEG 7. The app shows the survey's group, and uses the guide only when you edit the surface layer. Texture guide: USDA-NRCS ${A("https://directives.nrcs.usda.gov/sites/default/files2/1725389517/Part%20618%20Subpart%20B%20%E2%80%93%20Exhibits.pdf", "National Soil Survey Handbook, Part 618 Subpart B")}, §618.93 (amended August 2024). Calcareous: strong or violent fizzing of the fine earth in cold dilute (1N) HCl. Rock fragments move a soil to a less erodible group, meaning the next lower I (86 → 56): one group at 15–35% by volume, two at 35–60%, I = 0 above 60% (sands and loamy sands move less).</p></section>
      <section id="m-sources"><h4>Data sources</h4>${table(["Data", "Producer", "How the app reads it", "Resolution · period", "If it fails"], SOURCES, "sources")}
        <h4>Other wind networks</h4>
        <p class="fine">Calibration uses airports: no other network gives a web page hourly 10 m wind for years without a key, at the airport standard, and for public use. Checked in October 2026:</p>
        <ul class="fine">
          <li>${WTM} (Texas Tech, ${N_TOWERS} towers at 10 m, ${N_USABLE} with 5 complete years): readable through the Iowa Environmental Mesonet's archive of NWS hourly reports since December 2010. Some towers match the airports (Reese Center: 0.99 of Lubbock airport's mean wind, 1.00–1.03 times its hours ≥ 8 m/s), but in a 2024 survey 7 of 16 towers recorded 24–85% fewer erosive hours than a nearby airport, relative to the model: probably sheltered. ${WTM_STATE}. Built in for when it is allowed: a tower ranks ahead of an airport when its distance plus 20 km is less than the airport's (an AWOS airport counts 100 km extra), and then calibrates the speeds if it records at least 0.85 times the airport's erosive hours, relative to the model; gusts stay with the airport.</li>
          <li>TexMesonet (Texas Water Development Board) and the West Texas Mesonet's own website do not let other websites read their data.</li>
          <li>RAWS fire-weather stations and NRCS SCAN read 20–50% below airports or 10 m mesonet towers at the same place, even after correcting for sensor height (tested at 2 RAWS and 3 SCAN sites).</li>
          <li>USCRN measures wind at 1.5 m; coastal NOAA stations measure over water.</li>
          <li>Synoptic Data needs a paid key; the Oklahoma Mesonet and TexasET need a licence or purchase; TCEQ's own pages give one site-day at a time, and EPA's copies of its air-quality sites need a personal key or come as national zip files a web page cannot use.</li>
        </ul></section>
      <section id="m-erod"><h4>Erodibility equations</h4>${table(EQ_COLS, eqRows(EROD), "eqs")}</section>
      <section id="m-wind"><h4>Wind and climate equations</h4>${table(EQ_COLS, eqRows(WIND), "eqs")}</section>
      <section id="m-soil"><h4>Soil water and profile equations</h4>${table(EQ_COLS, eqRows(SOIL), "eqs")}</section>
      <section id="m-states"><h4>States on the map</h4>
        <p class="fine">For now visitors can choose Texas only: js/config.js lists the states that can be chosen, and the others are shown as “(later)”. The code and the data keep every state, so more are added by listing them there. Each state's file (outline, airports within about 150 km, statewide erosion maps, each county's climatic factor) loads only when the state is chosen, and its statewide map images only as the map comes near it. Where SSURGO gives a county no usable C (none in 16 states, some counties in 19 more), C is estimated, and the legend says where. Days are in the location's state's standard time. While typing, the search box suggests towns, cities and counties from the app's own Census list (no server asked); Enter searches streets and addresses in OpenStreetMap Nominatim, at most one request a second, each answer kept for the visit (Nominatim's usage policy). A place looked at again within 15 days loads at once: the answers that stay the same for days (soil survey, elevation, land cover, past weather and station records, place search) are kept in this browser for 15 days; live layers and this week's Drought Monitor are always asked fresh. Practice plans: Texas from Texas sources; every other state from a profile of its own NRCS technical guide, each statement cited (docs/METHODS.md §6). Details: docs/METHODS.md §10.</p></section>
      <section id="m-live"><h4>Drought</h4>${table(EQ_COLS, eqRows(LIVE), "eqs")}
        <p class="fine">The map's themes (Wind erosion, Soil maps, Drought) choose its overlay and the panel's tabs. Live overlays are shown as their producers draw them, with the producers' own legends; none of their values is changed. The U.S. Drought Monitor's statistics service, which gives a county's weekly record, sends no header that lets a web page read it, so the between-years graphs use gridMET's drought indices at the point instead. Downloads: the data sheet's table drought_monitor_weekly.csv gives the class of every week the chosen dates touch (2000 on), and daily_weather.csv each day's class; the area grid's Drought Monitor columns give dm_now, the share of weeks in D0+ to D4 (dm_d0p–dm_d4p), the worst class (dm_max) and the longest run of D1+ weeks (dm_run), with each week's share of cells per class in drought/weeks.csv.</p></section>
      <section id="m-soilmaps"><h4>Soil maps</h4>${table(EQ_COLS, eqRows(SOILMAPS), "eqs")}
        <p class="fine">Survey and model values describe typical soil, not a soil test. USGS DS-801 values are total element contents after a near-total four-acid digest, not plant-available; its 10 map classes are the national deciles of its 4,857 sites. No map covers the US for soil-test (plant-available) N, P, K, Ca, Mg or S, or DTPA micronutrients; boron and phosphorus survey data is also limited for the US. KSSL pedons are sparse and often old, and their Ca is inflated in calcareous soils.</p>
        <h4>Basins</h4>${table(EQ_COLS, eqRows(BASINS), "eqs")}
        <h4>Soil moisture</h4>${table(EQ_COLS, eqRows(MOISTURE), "eqs")}
        <p class="fine">Basin runoff (EROM), the curve number and RUSLE are <b>models</b>; soil moisture is labelled <b>model</b> (ERA5-Land, IFS, the National Water Model, SPoRT-LIS), <b>satellite</b> (SMAP L4 and GRACE-DA, each merged into a model) or <b>station</b> (SCAN, SNOTEL, USCRN), in m³/m³. Compare soil moisture changes more than levels. Details: docs/METHODS.md §12 and §13.</p></section>
      <section id="m-files"><h4>Model files and downloads</h4>${table(EQ_COLS, eqRows(FILES), "eqs")}
        <p class="fine">The data sheet writes DSSAT 4.8, SWAT+ (and the SWAT2012 text format), EPIC 1102, APEX 1501, APSIM Next Gen / 7.10 and AquaCrop 7 files. Their layouts were checked against each model's manual, official example files and the reading code of its source; the files have not been run in the models here.</p></section>
      <p class="fine">Full derivations and references: docs/METHODS.md and docs/RESEARCH.md in the ${A("https://github.com/barsa1ly/soilguard", "project repository")}.</p>`;
  }

  function open(section) {
    render();
    $("#methodsSheet").hidden = false;
    $("#sheetBackdrop").hidden = false;
    const target = section && $("#" + section);
    setTimeout(() => { $("#methodsBody").scrollTop = target ? target.offsetTop : 0; }, 0); // after the sheet has laid out
    $$("#methodsNav button").forEach(b => b.classList.toggle("on", b.dataset.sec === (section || "m-site")));
  }
  function close() {
    $("#methodsSheet").hidden = true;
    $("#sheetBackdrop").hidden = true;
  }

  $("#methodsBtn").addEventListener("click", () => open());
  $("#methodsClose").addEventListener("click", close);
  $("#methodsNav").addEventListener("click", e => {
    const b = e.target.closest("button[data-sec]");
    if (!b) return;
    const t = $("#" + b.dataset.sec);
    $("#methodsBody").scrollTo({ top: t.offsetTop, behavior: "smooth" });
    $$("#methodsNav button").forEach(x => x.classList.toggle("on", x === b));
  });
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-methods]");
    if (b) { e.preventDefault(); open(b.dataset.methods); }
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#methodsSheet").hidden) close(); });

  return { open, close };
})();
