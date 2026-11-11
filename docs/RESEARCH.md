# West Texas wind-erosion control: knowledge base for recommendation rules

**Scope:** Southern High Plains/Llano Estacado, Panhandle, Rolling Plains, Permian Basin/Monahans sandhills, Trans-Pecos/Chihuahuan Desert, and the western edge of the Edwards Plateau.

**How to read this.**
- Unmarked statements come from source documents I read in full text. These include the current Texas NRCS standards and implementation-requirement sheets pulled from the Texas eFOTG, the TxDOT Item 164 seed tables, the University Lands seed list, the AgriLife Beltwide papers and others listed in section 12.
- **(abstract)** means the item rests on a search abstract or snippet, not the full text.
- **(unverified)** means I could not confirm it. It is my synthesis or comes from outside Texas. Treat it as a default to check before shipping.
- NRCS design numbers are ultimately set per field with WEPS (the current NRCS wind erosion prediction tool). The numbers here are the hard limits and defaults that the Texas standards themselves state.

---

## 1. General facts (apply to all land uses)

### 1.1 Erosive season and wind direction
- **Big Spring (USDA-ARS network site, Howard Co.)** has two erosive periods:
  - Late November to February: high-velocity **north** winds behind cold fronts.
  - Late February to late April: frequent **southwest and west** winds.
  - Erosion happens when fields are fallow. Rain averages 475 mm (about 18.7 in), peaking late April–early June and late August–early October. Annual evaporation is over 1,800 mm. ([NWERN Big Spring](https://jornada-wind.nmsu.edu/network-sites/big-spring-ars))
- **Lubbock:** relative humidity, which affects threshold wind speed, is lowest in **March–April**, when W/SW winds are common. Bare winter-spring fields are the main dust source. ([Lee et al. 1994, TTU](https://scholars.ttu.edu/en/publications/environmental-controls-on-blowing-dust-direction-at-lubbock-texas-6))
- **Rule default:** high-risk window **Feb–May**, peak **Mar–Apr**, with a secondary risk window **Dec–Jan** (north-wind events). Protective cover should be in place by about **Dec 1** and kept until the crop canopy closes (about mid-June). Use your monthly erosive-wind data to override this per location.

### 1.2 Threshold wind speed
- NRCS (Texas FOTG wind erosion reference, which reproduces National Agronomy Manual Part 502): winds are erosive at **13 mph at 1 ft** above ground, or about **18 mph at 30 ft** (Lyles & Krauss 1971). ([TX FOTG Wind_Erosion.pdf](https://efotg.sc.egov.usda.gov/references/public/TX/Wind_Erosion.pdf))
- How the soil moves:
  - **Saltation** (particles 0.1–0.5 mm): 50–80% of transport, mostly within 12 in of the surface.
  - **Suspension** (<0.1 mm): 20 to over 60%.
  - **Creep:** 7–25%.
- The measured threshold varies with field history, from about 13 to 30 mph at 1 ft. On highly erodible fields, soil can move at about 6 mph at 1 ft. ([NebGuide G1537](https://extensionpubs.unl.edu/publication/g1537/na/html/view))
- Above threshold, the soil transport rate scales roughly with wind speed cubed.

### 1.3 Cover and residue versus erosion

**Flat cover → erosion reduction compared with bare soil** (NebGuide G1537; the effect is independent of residue type):

| % surface cover | 10 | 20 | 30 | 50 | 70 | 90 |
|---|---|---|---|---|---|---|
| Soil-loss reduction | 35% | 60% | 70% | 85% | 93% | 98% |

- **Equation:** SLR = exp(−0.0438 × % soil cover) (Bilbro & Fryrear 1994, *Agron. J.* 86:550; r² = 0.94). About 60% cover reduces erosion to near zero. ([NMSU slides citing it](https://nmsare.nmsu.edu/documents/Roswell%202014%20Remembering%20Soil%20Conservation.pdf)) (abstract; coefficient not checked against the original paper)
- **Standing residue beats flat residue:**
  - About **5% vertical silhouette area** of standing residue gives adequate control in low and moderate wind regimes.
  - On highly erodible sands, **30–60% flat cover** is needed.
  - Flat residue raises the threshold; standing residue lowers surface friction velocity and traps saltating grains.
  - Source: USDA-ARS, "Crop residue effects on aerodynamic processes and wind erosion." (abstract) ([ARS pdf](https://infosys.ars.usda.gov/WindErosion/publications/pdf/Crop%20residue%20effects%20on%20aerodynamic%20processes%20and%20wind%20erosi.pdf))

**Small-grain equivalent (SGe, the WEQ vegetative factor): lb/ac of flat small grain equivalent to 1,000 lb/ac of each residue** (NebGuide G1537, Table III):

| Residue | SGe per 1,000 lb/ac |
|---|---|
| Standing winter wheat stubble, 10 in, rows across the wind | 3,500 |
| Growing small grain | 2,000 |
| Standing millet stubble | 1,700 |
| Flat wheat stubble | 1,600 |
| Standing grain sorghum | 1,300 |
| Dry bean / soybean, flat | 600 |
| Flat grain sorghum stalks | 350 |
| Flat corn stalks | 200 |

- **Cotton:** no SGe value was retrieved. Cotton stalks are light and protect less than sorghum. On the Southern High Plains they are usually shredded and incorporated soon after harvest. (abstract, [Farm Progress](https://www.farmprogress.com/management/conservation-tillage-born-from-dust-bowl); [Beltwide K042](https://www.cotton.org/beltwide/proceedings/2004/abstracts/K042.cfm))
- Wind-tunnel ranking: standing wheat was the most protective residue tested, ahead of cotton and forage sorghum. ([Lyles & Allison, ARS 80-193-J](https://infosys.ars.usda.gov/WindErosion/publications/Andrew_pdf/80-193-J.pdf))

**Flat SGe needed for WEG 1 soils, by climatic factor C** (ARS paper; kg/ha converted to lb/ac):

| C factor | 20 | 40 | 70 | 100 | 150 |
|---|---|---|---|---|---|
| lb/ac SGe | ~1,000 | ~1,500 | ~2,100 | ~2,500 | ~2,950 |

Source: ([ARS 1606-A](https://infosys.ars.usda.gov/WindErosion/publications/Andrew_pdf/1606-A.pdf)) (abstract). I did not find C values for individual West Texas counties; they are in Texas FOTG Section I (unverified).

### 1.4 Wind Erodibility Group (WEG): soil erodibility factor I
NAM Table 502-2 (in the Texas FOTG reference) gives I in t/ac/yr:

| WEG | 1 | 2 | 3 | 4 | 4L | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|---|
| I (t/ac/yr) | 160–310 | 134 | 86 | 86 | 86 | 56 | 48 | 38 | 0 |

- An older Kansas table uses different values (220/104/56…). Use the NAM values.
- WEG 1 = sands and fine sands; NRCS says these are generally unsuited to crops and hard to vegetate.
- WEG 2 = loamy sands. WEG 3 = sandy loams. 4L = calcareous loams. 8 = not erodible (rock fragments or wetness).
- NRCS Practice 609 notes that crusted **loamy fine sands, sandy loams and some calcareous loams (4L)** shed loose sand-size grains that abrade crusts quickly. Do not treat a crust as protection on these soils.

### 1.5 Crop tolerance to blowing soil (NAM Table 502-4)

| Tolerance class | Crops |
|---|---|
| Tolerant (up to T) | Grain sorghum, wheat, rye, millet |
| Low tolerance (1 t/ac) | Peanuts |
| Low tolerance (1 t/ac, per TX 603) | Small cotton plants |

When protecting seedlings, design the system so loss stays at or below 1 t/ac. ([TX 603 CPS](https://efotg.sc.egov.usda.gov/api/CPSFile/44131/603_TX_CPS_Herbaceous_Wind_Barriers_2023))

### 1.6 Sub-region keys
These rainfall figures are approximate (unverified) except Big Spring. Key on the ESD precipitation zone where you have it; ESD names carry it (for example, "Sand Hills 16–21" PZ").

| Sub-region | Typical MLRA (verify against SSURGO) | Approx. annual rain | Wind-erosion character |
|---|---|---|---|
| Panhandle | 77A/77B | 18–22 in | Clay loams (WEG 4L–6); wheat, sorghum, corn; winter wheat grazing |
| Southern High Plains | 77C | 16–20 in | Fine sandy loams to loamy fine sands (WEG 2–3); cotton and peanuts; worst cropland blowing |
| Rolling Plains | 78B/78C | 20–28 in | More rain, so cover crops are more feasible; sandy terraces |
| Permian Basin / Monahans | 77D/42 | 12–15 in | Deep sands, shinnery, mesquite coppice dunes; oil and gas disturbance |
| Trans-Pecos | 42 | 8–16 in (summer monsoon) | Gravelly soils (often WEG 8), alkali flats, dunes |
| W. Edwards Plateau | 81 | 14–20 in | Shallow limy soils with rock fragments; water erosion usually dominates |

### 1.7 Hard design limits from Texas and national NRCS standards

| Practice | Rule |
|---|---|
| **603 Herbaceous wind barrier (TX 2023)** | Height ≥ **1.5 ft** and **40–50% porosity** during the critical period. Orient perpendicular to the prevailing erosive wind. **Spacing ≤ 10H** (±10% to fit equipment). One or more rows; **within-row spacing ≤ 36 in**. Annual barriers re-established each year. Fill gaps of **10–15 ft** promptly. Relocate when filled with sediment. |
| **380 Windbreak (TX 2023)** | Protected zone **10H leeward and 2H windward**, where H is the tallest row's height at **age 20**. Interval set by WEPS, not to exceed T (soil loss tolerance). Use species taller than the crop. No invasive species. Plan other practices until the windbreak is functional. |
| **589C Cross-wind trap strips (national, 2014)** | Minimum **15 ft** wide when the vegetation is ≥ 1 ft tall during the erosion period, measured along the wind. Width of the cropped strip between trap strips set by WEPS. Locate at the windward field edge, immediately upwind of sensitive areas, or alternating with crop strips. ([NRCS 589C](https://www.nrcs.usda.gov/sites/default/files/2022-09/Cross_Wind_Trap_Strips_589_CPS.pdf)) An ARS design paper uses a 12-ft minimum at a 5 t/ac/yr tolerance. ([ARS 1341](https://infosys.ars.usda.gov/WindErosion/publications/Andrew_pdf/1341.pdf)) (abstract) |
| **588 Cross-wind ridges** | Ridge spacing ≤ **4× ridge height**. Orientation ≤ **45° from perpendicular** to the erosive wind. ([NRCS 588](https://www.Nrcs.Usda.Gov/sites/default/files/2022-09/Cross_Wind_Ridges_588_CPS_Oct_2017.pdf)) |
| **609 Surface roughening** | Produce random roughness that cuts potential erosion ≥ **25%** (WEPS). Emergency backstop only. Start on the **windward edge**. Ridges perpendicular to the damaging wind. |
| **329 No-till / strip-till (TX)** | No full-width tillage from harvest to planting. Annual **STIR ≤ 20**. Strip-till strips ≤ **30% of row width**. No residue burning; no baling or grazing that defeats the purpose. Soil Conditioning Index (SCI) > 0. ([TX 329 IR](https://efotg.sc.egov.usda.gov/api/CPSFile/44530/329_TX_IR_Residue_and_Tillage_Management_No-Till_10-30-2023)) |
| **345 Reduced till (TX)** | Mulch-till **STIR ≤ 45**. ([TX 345 IR](https://efotg.sc.egov.usda.gov/api/CPSFile/44536/345_TX_IR_Residue_and_Tillage_Management_Reduced_Till_10-30-2023)) |
| **340 Cover crop (TX, Dec 2024)** | Use the TX Cover Crop Calculator "plant by / plant after" dates; may deviate by ±10 days with justification. Species not in the calculator ≤ 10% of the mix. In dry areas, terminate early enough to conserve moisture. Leave residue on the surface. No haying. If grazed, remove ≤ 50% per cycle. At least one high-residue crop or high-biomass cover must be in the rotation. ([TX 340 CPS](https://efotg.sc.egov.usda.gov/api/CPSFile/48860/340_TX_CPS_Cover_Crop_2025)) Broadcast rate = 150% of drilled rate. Mixes 10–25 seeds/ft². ([TX 340 guidance](https://efotg.sc.egov.usda.gov/api/CPSFile/48861/340_TX_GD_Cover_Crop_2025)) |

---

## 2. Cropland: dryland (cotton, sorghum, wheat, peanuts) and irrigated (center pivot)

Texas NRCS classes **cotton, peanuts, sunflowers, and corn or wheat silage as low-residue crops**. High-residue crops are grain sorghum, wheat, corn grain, millets, sudangrass hybrids, and winter or summer cover crops. (TX 340 guidance, Table 2)

### (a) Prioritized practices
1. **340 Cover crop (small-grain winter cover).** The main fix for bare cotton and peanut fields through spring. Small-grain covers cut soil loss by **2–3 orders of magnitude** at all seeding densities tested in the Southern High Plains. ([Van Pelt & Zobeck, ISCO 2004](https://topsoil.nserl.purdue.edu/isco/isco13/PAPERS%20R-Z/VAN%20PELT.pdf)) (abstract)
2. **329 No-till / strip-till** into standing residue or terminated cover. Keeps standing stalks, which are worth 2–10× flat residue.
3. **328 Rotation with sorghum or wheat.** Adds high-residue years. In Lubbock dryland trials, no-till wheat–cotton gave the highest cotton yield. ([White, Lewis & Keeling 2022](https://www.cotton.org/beltwide/proceedings/2005-2022/data/conferences/2022/paper/21366.pdf))
4. **603 Herbaceous wind barriers** or **589C trap strips.** Shorten the unsheltered distance and protect seedlings.
5. **585 Stripcropping.** Alternate protected and erodible strips across the wind.
6. **380 Field windbreaks.** Long-term; limited by water and growth rate on the Southern High Plains.
7. **609 / 588 Emergency roughening and listing.** Backstop only, when cover fails.

### (b) Quantitative criteria

**Cover crops (AgriLife, Lamesa and Lubbock)**
- AG-CARES near Lamesa, 2017–2019 ([White, Lewis & Keeling 2020](https://www.cotton.org/beltwide/proceedings/2005-2022/data/conferences/2020/paper/19810.pdf)):
  - Rye (*Secale cereale*) or wheat (*Triticum aestivum*) at **30 vs 60 lb/ac**, no-till, compared with conventional tillage.
  - Biomass was 3,000–7,000 lb/ac in 2017 and 1,000–2,000 lb/ac in 2019. The 60 lb rate produced no more biomass than 30 lb.
  - **30 lb/ac terminated 6–8 weeks before cotton planting** gave yields equal to conventional tillage every year. More biomass tended to lower lint yield.
  - A 4-year update held the same result. The peer-reviewed version is [Agronomy 2024, 14(7):1524](https://www.mdpi.com/2073-4395/14/7/1524), which notes reduced sand damage to cotton seedlings. (abstract)
- Lubbock dryland, 2018–2021 ([White, Lewis & Keeling 2022](https://www.cotton.org/beltwide/proceedings/2005-2022/data/conferences/2022/paper/21366.pdf)):
  - Wheat, rye, and triticale at 34 kg/ha (**about 30 lb/ac**), terminated **6, 4, or 2 weeks** before planting.
  - Biomass 600–2,000 lb/ac; rye produced the most.
  - No yield penalty; late-terminated rye was highest. Cotton stands were better under cover.
- Rolling Plains (DeLaune, Vernon/Chillicothe) ([AgriLife Today 2017](https://agrilifetoday.tamu.edu/2017/09/04/more-mature-cover-crops-help-maintain-residue-longer)):
  - Let wheat reach about **50% heading**, then plant cotton **4–6 weeks after termination**. More mature wheat leaves residue that lasts longer.
  - Soil water used by the cover recharges quickly if it rains between termination and planting.
  - Terminated wheat **doubled to tripled infiltration**.
- South Plains practice ([Trostle, AgriLife 2018](https://agrilife.org/texasrowcrops/?p=1487)):
  - **More than 1 million acres a year**, mostly irrigated, use terminated wheat or rye to protect seedling cotton.
  - Wheat is drilled on the **bed shoulders**; cotton goes on the bed top between the two wheat rows.
  - Seed **10–20 lb/ac** rye or wheat for a biomass cover.
  - Fall planting window: **mid-August to Thanksgiving**.
  - Rye often beats wheat on dryland.
- Texas Tech (Baxter and West): rye cover did not reduce soil water for the following summer crop. No-till reduced soil water loss. ([SARE](https://southern.sare.org/news/in-drought-stricken-texas-researchers-are-finding-water-conservation-solutions-in-cover-crops/))

**NRCS/RMA termination zones (crop insurance)** ([NRCS guidelines](https://secure.in.gov/isda/files/Termination_Guidelines_Designed_6.28_10.24am_002.pdf); [RMA](https://www.rma.usda.gov/sites/default/files/2024-04/202002-NRCSRMA-CoverCrop-Brochure-Letter.pdf))
- Zone 1 (arid West): terminate **≥ 35 days** before planting.
- Zone 2: terminate **≥ 15 days** before planting.
- Irrigated fields are not restricted to a zone. Under no-till, termination may be up to 7 days later than the zone guideline, but before crop emergence.
- Which West Texas counties fall in Zone 1 versus Zone 2 is unverified; check the map.

**Residue targets**
- Aim for **≥ 30% flat cover** (about 70% reduction) as a minimum.
- On WEG 1–2, aim for **≥ 50–60% cover**, or the SGe shown in the §1.3 table for the local C factor (about 1,500–2,500 lb/ac SGe on WEG 1).
- Keep stalks **standing**. Do not shred-and-disk cotton stalks in fall.

**Herbaceous barriers (603)**
- At least 1.5 ft tall; spacing ≤ 10H. Examples: a 3-ft barrier allows ≤ 30 ft between barriers; a 6-ft forage sorghum barrier allows ≤ 60 ft.
- A Central Texas peanut study used **2- and 4-row** grain sorghum or sudangrass barriers **15–20 ft apart** on sand. ([ARS "Annual crops as wind barriers"](https://infosys.ars.usda.gov/WindErosion/publications/pdf/Annual%20Crops%20as%20Wind%20Barriers.pdf)) (abstract)
- Candidate species: forage sorghum or sorghum-sudan (*Sorghum bicolor*), pearl millet (*Cenchrus americanus*), and winter small-grain strips. Tall wheatgrass (*Thinopyrum ponticum*) and switchgrass are perennial options, but I found no Texas trial for either (unverified).

**Trap strips and stripcropping**
- Trap strips: ≥ 15 ft wide (vegetation ≥ 1 ft tall).
- Stripcropping: the current 585 standard sets width with WEPS, in multiples of implement width. A historical ARS table gave about **1.2 rods (about 20 ft)** for erosion-susceptible strips on **sand**, widening on finer textures. The other textures could not be read reliably (unverified).

**Emergency tillage (609 / 588)**
- Clay or fine soils: narrow **2-in chisel points on 24–54 in spacing, 3–6 in deep**. Loams: 4-in shovels. ([K-State](https://eupdate.agronomy.ksu.edu/article/emergency-tillage-for-wind-erosion-concerns-491))
- Sandy soils: wide shovels or **lister bottoms 40–50 in apart, 4–12 in deep**, deeper when dry or sandy. ([UNL CropWatch](https://cropwatch.unl.edu/2022/using-emergency-tillage-control-wind-erosion))
- ARS lister options: a 14-in lister on 40–50 in spacing, or an 8-in lister on 20–24 in spacing. Make the first pass **≤ 4–5 in deep** and go deeper on repeat passes. (abstract)
- Use narrower spacing on bare ground and wider spacing where some cover exists. Ridge spacing ≤ 4× height; orientation ≤ 45° off perpendicular.
- NRCS 609 says roughening on high-I sands works only with **deep tillage when the soil is moist enough** to form stable clods and bring finer material up.

**Seedling protection target:** ≤ **1 t/ac** loss while cotton or peanuts are small.

### (c) Timing (dryland cotton planted about mid-May to early June; date unverified)
- Drill the cover **right after harvest, by about Thanksgiving**.
- Dryland: terminate with herbicide **6–8 weeks before planting**, roughly late March to mid-April. The standing dead stubble then covers the March–April peak.
- Irrigated: terminate **2–4 weeks before planting** or later. Water use can be replaced, and the zone rule does not apply.
- Keep standing residue through May. Plant no-till or strip-till into it.
- Barriers: sow forage sorghum or millet strips in **July–August** so they reach ≥ 1.5–3 ft before frost, and leave them standing through April. A specific Texas date was not found (unverified).

### (d) Modifiers by WEG and sub-region

| Soil | Recommendation |
|---|---|
| **WEG 1 (sands)** | Flag as unsuited to annual cropping; recommend conversion to permanent cover (§7). If it must stay cropped, require cover crop + no-till + barriers or trap strips at ≤ 10H, and aim for ≥ 60% cover. Emergency tillage is unreliable because stable clods are hard to form in sand. |
| **WEG 2 (loamy sands; peanut and cotton belt)** | Cover crop is mandatory. Use bed-shoulder wheat strips or a full-width cover. Add barriers or trap strips. Lister-type emergency tillage only, and only when moist. |
| **WEG 3 (sandy loams)** | Cover crop or standing sorghum/wheat stubble. Chisel or lister roughening works. |
| **WEG 4/4L** | Residue plus roughness. Watch crust abrasion on 4L. |
| **WEG 5–7** | Residue management and chisel roughening are usually adequate; trap strips are optional. |

- **By sub-region:**
  - Rolling Plains and irrigated fields: higher-biomass covers and later termination are acceptable.
  - Southern High Plains and Permian dryland: keep to 30 lb/ac and early termination.
  - Panhandle: winter wheat (grazed or terminated) and sorghum residue are the main tools.

**Peanuts.** Digging inverts the soil and leaves almost no residue, and peanuts have low tolerance to blowing soil. Drill rye or wheat immediately after harvest. In a Vernon trial, peanuts were dug Oct 8, harvested Oct 20, and rye was planted in November. In that tilled, furrow-irrigated system, the rye cover did not affect peanut stand or yield, but little residue was retained. ([AgriLife Vernon 2021](https://varietytesting.tamu.edu/wp-content/uploads/sites/17/legacy-files/peanuts/2021/Cover-crop-2021.pdf)) On WEG 1–2, add sorghum or small-grain barrier strips.

### (e) Key citations
TX 603, 380, 340, 329 and 345 standards (URLs in §1.7); [TX FOTG wind erosion reference](https://efotg.sc.egov.usda.gov/references/public/TX/Wind_Erosion.pdf); [NRCS 609](https://www.nrcs.usda.gov/sites/default/files/2022-10/Surface_Roughening_609_CPS.pdf); the Beltwide papers, Trostle, DeLaune and Van Pelt sources above; [Missouri G4271 (sandfighter, barriers)](https://extension.missouri.edu/publications/g4271).

---

## 3. Fallow or bare cropland after harvest: month-by-month plan (cotton or peanuts to cotton)

| Month | Action |
|---|---|
| Sep–Oct | Harvest. **Do not shred or disk stalks.** Spread residue evenly. For peanuts, plan to drill the cover within days of harvest. |
| Oct–Nov (by about Thanksgiving) | No-till drill rye or wheat: **30 lb/ac** dryland, up to 60 lb/ac irrigated or Rolling Plains, or **bed-shoulder strips**. Orient drill rows **perpendicular to the dominant Feb–Apr erosive wind** from your wind data (often SW/W, so rows run NW–SE or N–S). If it is too dry to establish a cover, plan barrier strips from the previous summer, or emergency listing. |
| Dec–Jan | North-wind events. Check cover. If cover is **< 20–30%** and soil is moving, list or chisel (609) on the **windward edge first**, perpendicular to the current wind, only when the soil is moist. |
| Feb | High-risk window begins. Keep the cover growing. Repeat roughening where blowing starts. |
| Mar–Apr | **Peak.** Dryland: terminate the cover with herbicide (no tillage) **6–8 weeks before the planned cotton date**, leaving it standing. Irrigated: terminate 2–4 weeks before planting. Keep barriers standing. |
| May | Plant no-till or strip-till (STIR ≤ 20) into standing residue. Seedling-protection target ≤ 1 t/ac. Sandfighter or rotary hoe only as a last resort. |
| Jun | Crop canopy develops; erosion risk falls. Plan next season's barrier strips (sow Jul–Aug). |

Rule hint: if forecast or observed cover on Feb 1 is below the target for the WEG (§1.3), escalate to emergency roughening plus a barrier recommendation.

---

## 4. Rangeland (native grassland)

### (a) Prioritized practices
1. **528 Prescribed grazing.** Keeping cover is the main wind control on rangeland.
2. **Drought contingency planning** (required in TX 528).
3. **550 Range planting.** Only where desirable species are scarce (AgriLife: under 10% of the vegetation).
4. **315 Herbaceous weed treatment** and **314 brush management.** Covered in §5.

### (b) Quantitative criteria

**Grazing**
- Stock for **25% harvest efficiency**. "Take half, leave half" does **not** mean livestock may eat half: of the half "taken," about half is lost to trampling, insects, wildlife, and senescence. Base the stocking rate on median-rainfall forage production. ([AgriLife harvest efficiency](https://agrilifeextension.tamu.edu/wp-content/uploads/2026/03/Rangeland-Risk-Management-for-Texans-Using-Forage-Harvest-Efficiency-to-Determine-Stocking-Rate.pdf); [AgriLife common mistakes](https://cibolo.tamu.edu/wp-content/uploads/sites/10/2025/06/rangeland-risk-management-for-texans-common-grazing-management-mistakes-1.pdf))
- Lesser prairie-chicken range: utilization **≤ 33%** under the WAFWA conservation agreement (CCAA). ([WAFWA](https://wafwa.org/wp-content/uploads/2024/03/WAFWA-Chemical-Brush-Mgmt-Sand-Sagebrush-03.14.2024.pdf))
- **Minimum stubble heights:**

| Grass | Do not graze below | Source |
|---|---|---|
| Sideoats grama ('Premier') | 6 in | [Knox City PMC](https://nrcs.usda.gov/plantmaterials/txpmcrb15090.pdf) |
| Indiangrass ('Lometa') | 6–8 in | [Knox City PMC](https://www.nrcs.usda.gov/plantmaterials/txpmcrb11182.pdf) |
| Little bluestem (newly seeded Knox City release) | 6–8 in, after about 12 months' deferment | (abstract) |
| Blue grama | about 1.5 in | NM guidance (abstract) |

  Defaults for grasses not listed (unverified): sand bluestem or giant sandreed 8–10 in; buffalograss 2 in.

**Drought checkpoints in the TX 528 sheet** ([TX 528 IR](https://efotg.sc.egov.usda.gov/api/CPSFile/49615/528_TX_IR_Prescribed_Grazing-FY25_Update_2019)). The planner fills in residue heights per site.

| Date | Check |
|---|---|
| Apr 1 | Residue height and lb/ac target |
| Jun 15 | Estimate annual production and adjust numbers |
| Jul 15 | Begin estimating end-of-season residue |
| Aug 15 | Calculate available forage; rest to frost benefits warm-season grasses |
| Nov 1 | End of growing season. **Less than 80% of average annual rain signals drought** for the next season. |

**Range planting (550)**
- Rates on a PLS basis.
- Drill with double-disk openers and depth bands, **rows ≤ 12 in apart**, followed by press wheels or a cultipacker.
- Seedbed firm and weed-free. A **"dead litter cover" seedbed** is allowed where needed to control wind erosion during establishment.
- **Defer grazing for at least one full growing season**, planting to killing frost.
- Sources: [TX 550 CPS](https://efotg.sc.egov.usda.gov/api/CPSFile/44127/550_TX_CPS_Range_Planting_2023); [TX 550 IR](https://efotg.sc.egov.usda.gov/api/CPSFile/49617/550_TX_IR_Range_Planting-2025_Update_2023)
- AgriLife guidance ([Texnat](https://texnat.tamu.edu/about/ranchers-reference-guide/seeding-rangeland)):
  - Seed native species collected within **200 mi north–south and 100 mi east–west** of the site.
  - Plant **1/4–1/2 in deep, never deeper than 3/4 in**.
  - No herbicide until seedlings have 4–5 leaves.

**Single-species full drill rates (lb PLS/ac)** (AgriLife; reduce each species to its percentage of the mix):

| Species | Rate | Species | Rate |
|---|---|---|---|
| Sand bluestem | 6.0 | Little bluestem | 3.4 |
| Sand lovegrass | 1.5 | Switchgrass | 3.5 ('Alamo' 2.0) |
| Indiangrass | 4.5 ('Lometa' full rate 5.0) | Plains bristlegrass | 3.0 |
| Sideoats grama | 4.5 | Western wheatgrass | 7.0 |
| Black grama | 1.5 | Alkali sacaton | 1.0 |
| Sand dropseed | 1.0 | Green sprangletop | 1.7 |

**Species by ecological-site group.** Releases marked * are named in TxDOT or University Lands West Texas specifications.

- **Deep sand, Sand Hills, Sandy (WEG 1–2).**
  - Grasses: sand bluestem (*Andropogon hallii*), little bluestem (*Schizachyrium scoparium*; 'Pastura'*, 'OK Select'*), sand lovegrass (*Eragrostis trichodes*; 'Mason'*), giant sandreed (*Calamovilfa gigantea*), switchgrass (*Panicum virgatum*), Indiangrass (*Sorghastrum nutans*; 'Lometa', needs ≥ 22 in or run-in water).
  - Also: plains bristlegrass (*Setaria vulpiseta*; 'Catarina Blend'*), sand dropseed (*Sporobolus cryptandrus*; 'Taylor'*), giant dropseed (*S. giganteus*), Havard panicum (*Panicum havardii*), hooded windmillgrass (*Chloris cucullata*; 'Burnet'*).
  - Reference community for Sand Hills 16–21" PZ: tallgrasses 50–60%, shrubs 35–45%, forbs 10–15%; 1,400–2,000 lb/ac. Shrubs are sand sagebrush (*Artemisia filifolia*), Havard (shinnery) oak (*Quercus havardii*), and fragrant sumac. ([ESD R077CY034TX](https://edit.sc.egov.usda.gov/catalogs/esd/077C/R077CY034TX); [R077BY020TX](https://edit.jornada.nmsu.edu/catalogs/esd/077B/R077BY020TX))
- **Loamy, clay loam, hardland (WEG 3–6).** Sideoats grama (*Bouteloua curtipendula*; 'Haskell'* for the Rolling Plains and High Plains, 'Brewster Germplasm'* for the Permian and Trans-Pecos), blue grama (*B. gracilis*; 'Hachita'*), buffalograss (*B. dactyloides*; 'Texoka'*), western wheatgrass (*Pascopyrum smithii*; 'Barton'*, Panhandle and northern Rolling Plains), vine mesquite (*Hopia obtusa*, draws), silver bluestem (*Bothriochloa laguroides*; 'Santiago'*), white tridens ('Guadalupe'*), Canada wildrye ('Lavaca'*).
- **Shallow, limy, gravelly (often WEG 4L or 8).** Sideoats, black grama (*B. eriopoda*; 'Nogal'), hairy grama (*B. hirsuta*; 'Chaparral'*), cane bluestem (*Bothriochloa barbinodis*), little bluestem, whiplash pappusgrass (*Pappophorum vaginatum*; 'Permian Germplasm'*).
- **Saline or alkali.** Alkali sacaton (*Sporobolus airoides*; **'Saltalk'**, a Knox City release for saline sites), fourwing saltbush (*Atriplex canescens*; no Texas release was confirmed), vine mesquite, western wheatgrass.
- **Trans-Pecos desert grassland.** Black grama, bush muhly (*Muhlenbergia porteri*; no commercial release found), Arizona cottontop (*Digitaria californica*; 'La Salle'*, a South Texas source; West Texas collections are under way), plains bristlegrass, cane bluestem, green sprangletop (*Leptochloa dubia*; **'Van Horn'**, collected near Van Horn, Knox City release), sideoats 'Brewster', galleta (*Pleuraphis jamesii*; 'Viva'*), alkali sacaton, blue grama 'Hachita'.

**TxDOT 2024 Item 164 permanent rural mixes (lb PLS/ac, drill; broadcast +25%)**

| District | Clay soils | Sandy soils |
|---|---|---|
| **Lubbock** | Sideoats 'Haskell' 1.5, blue grama 0.6, silver bluestem 0.6, buffalograss 1.5, white tridens 0.2, green sprangletop 0.4, hooded windmillgrass 0.1, galleta 0.3, western wheatgrass 3.0, Canada wildrye 1.0 | Green sprangletop 0.6, blue grama 0.6, sideoats 1.0, little bluestem 0.7, hooded windmillgrass 0.2, sand dropseed 0.2, silver bluestem 0.4, Arizona cottontop 0.4, sand lovegrass 0.3 |
| **Odessa** | Whiplash pappusgrass 0.9, green sprangletop 0.4, silver bluestem 0.6, sideoats 'Brewster' 1.0, sand dropseed 0.2, alkali sacaton 'Saltalk' 0.2, Arizona cottontop 0.4, blue grama 0.4, galleta 0.6 | Sand dropseed 0.3, green sprangletop 0.4, sideoats 'Brewster' 1.5, whiplash pappusgrass 0.6, hooded windmillgrass 0.2, blue grama 0.4, hairy grama 0.4, sand lovegrass 0.3, little bluestem 'Pastura' 0.5, galleta 0.3 |
| **El Paso** | Green sprangletop 0.4, sideoats 'Brewster' 1.0, whiplash 0.6, silver bluestem 0.4, blue grama 0.4, galleta 0.6, alkali sacaton 0.2, Arizona cottontop 0.4, plains bristlegrass 'Catarina' 0.4, false Rhodes 'Kinney' 0.2 | Sand dropseed 0.4, sideoats 1.5, green sprangletop 0.6, hooded windmillgrass 0.2, blue grama 0.4, hairy grama 0.2, spike dropseed 'Potter' 0.1, little bluestem 'Pastura' 0.5, galleta 0.6 |

Amarillo, Childress, San Angelo and Abilene have their own mixes in the same table. ([TxDOT s164](https://ftp.dot.state.tx.us/pub/txdot-info/cmd/cserve/specs/2024/standard/s164.pdf))

**Seeding windows**
- TxDOT permanent seeding: Odessa, El Paso, San Angelo, Abilene and Childress **Feb 1–May 15**; Amarillo and Lubbock **Feb 15–May 15**.
- AgriLife: warm-season grasses late winter to early spring across most of Texas; **Trans-Pecos best in mid-summer** (monsoon onset). Cool-season grasses late summer or fall.

**Introduced grasses to avoid on native rangeland**
- Old World bluestems (*Bothriochloa ischaemum* including KR bluestem, *B. bladhii*) escape plantings and invade native grassland, including properly managed range. They reduce native diversity and forbs (and so insects and wildlife) and are very hard to control. ([OK Farm & Ranch / Noble](https://okfronline.com/2017/12/grazing-oklahoma-old-world-bluestems/); ["A Sea of the Wrong Grasses"](https://muse.jhu.edu/article/382373))
- Lehmann lovegrass (*Eragrostis lehmanniana*) was introduced for erosion control and forage, takes over landscapes, and forms near-monocultures; native biomass and richness decline as it dominates. ([BRI Desert Tracks](https://bri.sulross.edu/wp-content/uploads/2026/04/v17_2_Desert_Tracks_draft_6_PRINT.pdf)) (abstract)
- TX 550 requires species compatible with the ecological site description.

### (c) Timing
- Have **end-of-season residue in place by Nov 1** and protected through **Apr 1** (the TX 528 checkpoint).
- On sandy sites, avoid heavy winter or early-spring grazing that removes standing cover before the Mar–Apr peak.

### (d) Modifiers
- **WEG 1–2:** keep more residue (taller stubble, utilization ≤ 25–33%). Keep shrubs. Seeding is risky ("reseeding on this site is difficult and not usually successful," Sand Hills ESD), so favor deferment and rest.
- **WEG 3–6:** standard 25% harvest efficiency.
- **Rainfall:** below about 12 in (Permian and Trans-Pecos), success depends on monsoon timing; avoid tallgrass mixes unless the soil is deep sand or receives run-on water.

---

## 5. Shrubland (mesquite, creosotebush, shinnery oak, juniper, sand sagebrush)

### (a) Practices
1. **528 Grazing deferment and prescribed grazing** before and after any treatment.
2. **314 Brush management**, aimed at **suppression, not eradication**, on sands.
3. **315 Weed treatment** where annual weeds dominate after treatment.
4. **550 Understory seeding** only where the ESD shows grassland potential and a seed source or rainfall is adequate.

### (b) Criteria
- **Shinnery oak and sand sagebrush on deep sands:**
  - Oak control is "controversial because it can open sandy soils to wind erosion" and conflicts with wildlife habitat. ([Peterson & Boyd, USFS RMRS-GTR-16](https://research.fs.usda.gov/treesearch/6048)) (abstract)
  - Sand Hills ESD: use brush management for **reduction or suppression**; **"avoid treating the tops of dunes and areas of poor cover."**
- **WAFWA rules** (lesser prairie-chicken range, an encodable template):
  - Tebuthiuron **0.3 lb ai/ac**, applied aerially.
  - Treat **≤ 50%** of the property in any 2-year period.
  - **No treatment within 150 ft (45 m) of Sand Hills sites (dunes or blowouts)**; 500 m in dunes sagebrush lizard range.
  - **Defer grazing at least 2 years** after treatment; no disturbance for 2 years.
  - Then 1–2 years of dormant-season grazing (Nov–Mar) at ≤ 33% utilization. No repeat treatments.
- **NRCS New Mexico reduced rates** (adjacent Southern High Plains): tebuthiuron **0.3–0.75 lb ai/ac** for partial control of shinnery oak, creosotebush and tarbush, **only on medium to dense stands having grassland potential**. Kill may take 2 or more growing seasons. ([NM 314 spec](https://efotg.sc.egov.usda.gov/api/CPSFile/9555/___))
- **Lesser prairie-chicken:** densities were similar on treated and untreated shinnery, but the authors recommend keeping some untreated areas. ([JRM 1991](https://repository.arizona.edu/handle/10150/644740))
- **Mesquite and creosote (Chihuahuan Desert):** removing grass cover raised aeolian sediment flux and increased mesquite cover downwind. Losing grass is the trigger for nonlinear jumps in erosion. ([Alvarez et al. 2012](https://pmc.ncbi.nlm.nih.gov/articles/PMC3399202))
  - Rule: **never recommend brush removal on WEG 1–2 or coppice dunes unless perennial grass cover is adequate or will be seeded and protected.**
- **Redberry juniper (*Juniperus pinchotii*) and Ashe juniper (*J. ashei*)** on limy or shallow sites (WEG 4L/8): wind risk is low. Treatment is for forage and water, but defer grazing at least one growing season afterward (unverified default).

### (c) Timing
- Herbicide before the growing-season rains (NM).
- Avoid mechanical disturbance on sands from **Dec to May**.
- Defer grazing for **2 growing seasons** on sands, 1 season elsewhere.

### (d) Modifiers

| Situation | Recommendation |
|---|---|
| WEG 1–2, dune tops, poor grass cover | Retain shrubs; treat in a mosaic or strips (≤ 50%); no mechanical or root-plow methods |
| WEG 3–6 with grass understory | Brush management acceptable, with deferment |
| Trans-Pecos creosote flats where creosote is the ESD reference state | Do not recommend conversion |

---

## 6. Pasture and hayland (introduced or native, dryland or irrigated)

### (a) Practices
512 Pasture and hay planting; 511 Forage harvest management; 528 Prescribed grazing; 340 or annual forages to cover gaps.

### (b) Criteria

**Species**
- **WW-B.Dahl Old World bluestem (*B. bladhii*):** Texas Tech's choice for low-water pastures. It is productive with **9 in or less of irrigation a year** and survives without it. Water-use efficiency is about 20.4 kg/ha/mm. ([SARE GS02-012](https://projects.sare.org/project-reports/gs02-012/); [Texas Farm Bureau](https://texasfarmbureau.org/texas-tech-researches-grazing-for-cattle-while-saving-water/)) **Keep it on fenced pasture only, never next to or on native range** (invasive, §4).
- **Weeping lovegrass (*Eragrostis curvula*; 'Ermelo', 'Morpa'):** adapted to West Texas sands. Plowed seedbeds beat disked ones on shinnery range. It becomes unpalatable without fertilization and frequent, short grazing periods. ([JRM](https://repository.arizona.edu/handle/10150/644710); [USDA factsheet](https://plants.sc.egov.usda.gov/DocumentLibrary/factsheet/pdf/fs_ercu2.pdf))
- **Kleingrass (*Panicum coloratum*):** 1.5 lb PLS/ac drilled (AgriLife).
- **Bermudagrass (*Cynodon dactylon*):** irrigated only.
- **Teff (*Eragrostis tef*):** summer annual; Texas Tech system.
- **Sorghum-sudan:** summer annual.

**Minimum hay cutting heights** (Oklahoma NRCS 511, adjacent Southern Plains) ([OK 511](https://efotg.sc.egov.usda.gov/api/CPSFile/16161/511_OK_PS_Forage_Harvest_Management_2020)):

| Forage | Minimum stubble |
|---|---|
| Bermudagrass | 2–3 in |
| Old World bluestems | 3–4 in |
| Weeping lovegrass | 3–4 in |
| Big or sand bluestem | 4–6 in |
| Indiangrass | 4–6 in |
| Eastern gamagrass | 6–8 in |
| Sudan, millet, sorghum-sudan | 6–10 in |
| Wheat or barley | 2–4 in |

**Grazing**
- Bermudagrass: about 3–4 in or more. (abstract; Florida/NC)
- Sorghum-sudan: start grazing at **18–24 in** (prussic acid); leave **6–8 in** of stubble. ([K-State](https://eupdate.agronomy.ksu.edu/article/managing-the-prussic-acid-hazard-in-sorghum-503-1); [UNL](https://newsroom.unl.edu/announce/beef/8038/46324))
- Old World bluestem: taller residual gives better animal gains. (abstract)
- New plantings: **defer at least one full growing season** (TX 512 IR). ([TX 512 IR](https://efotg.sc.egov.usda.gov/api/CPSFile/49614/512_TX_IR_Pasture_and_Hay_Planting-FY25_Update_2022))

### (c) Timing
- Make the **last cutting or grazing early enough for regrowth before frost** so that standing stubble of at least 4–6 in carries through **Feb–May**. On sandy pasture, avoid fall cuts that leave about 2 in of stubble going into winter.
- For annual pastures (sorghum-sudan, teff), follow with a winter small grain or leave stubble standing at least 8 in (unverified default).

### (d) Modifiers
- **WEG 1–2:** perennial cover is preferred (weeping lovegrass or native mixes). Avoid clean-tilled annual forage. If an annual is used, no-till it.
- **Dryland below about 18 in:** avoid bermudagrass and kleingrass.

---

## 7. CRP, conservation cover, go-back (abandoned) cropland

### (a) Practices
327 Conservation cover or 550 range planting (establishment); 528 (if grazed after the contract); on conversion, 329, 328, 589C/603 strips, and 340.

### (b) Criteria and facts
- **Establishment** ([TX 342](https://efotg.sc.egov.usda.gov/api/CPSFile/49486/342_TX_IR_Critical_Area_Planting-FY25_Update_2018), 550 and 589 IRs):
  - On WEG 1–3, use a **dead-litter cover**: forage sorghum or haygrazer the previous summer, killed or left standing. Drill natives into it the next spring with a grass drill (rows ≤ 12 in).
  - Colorado State: the sorghum cover must be dead before seeding; mow or hay to leave **8–10 in of stubble**; drill grass **1/2–3/4 in deep**; use sterile seed. ([CSU](https://extension.colostate.edu/resource/cover-crops-help-in-dryland-grass-establishment))
  - Mixes: use the native lists in §4. Avoid Old World bluestems and weeping lovegrass where the land may revert to native range.
- **Expiring CRP converted to crops** ([AgriLife/NRCS EAG-006](https://agecoext.tamu.edu/wp-content/uploads/2013/08/CRP.pdf)):
  - Conversion for a fall crop can start no sooner than 90 days before expiration (usually July 2).
  - Burn or bale, then let the grass regrow **6–8 weeks** before glyphosate in July (1.5 lb ae/ac).
  - The original conservation plan, including **terraces or wind strips**, may be required again.
  - Leave **wide grass buffers** around playas and drainages.
  - Clean tillage leaves little residue and exposes land to wind erosion.
  - Wheat or grain sorghum fits first; fallow over winter if dry.
  - The publication says no-till is "not very effective" during conversion because of compaction and roughness, but works afterward. **Conflict for rules:** on WEG 1–3, recommend chemical kill plus no-till seeding of sorghum into standing sod residue first. Retain trap or barrier strips of the old CRP grass (≥ 15 ft wide, ≤ 10H spacing) and convert in strips. This is my wind-erosion synthesis (unverified as an AgriLife recommendation).
  - Burn caution: the Panhandle in late winter is high-wind and low-humidity.
- **Keep it in grass:** grazing conversion with 25% harvest efficiency (§4).
- Blowing-dust days around Lubbock declined after CRP was introduced (Bernier 1995). (abstract)

### (c) Timing
Kill in July, then sorghum the following May–June with no-till. Never leave converted ground bare **Dec–May**.

### (d) Modifiers
WEG 1: recommend **not converting** (re-enroll or graze). WEG 2: strip conversion plus permanent trap strips. WEG 3+: conversion with no-till and a high-residue first crop.

---

## 8. Disturbed land (oil and gas pads, pipeline ROWs, caliche roads, construction; Permian Basin)

### (a) Practices
342 Critical area planting; 484 Mulching; topsoil salvage and replacement; 654 Road/trail/landing closure and treatment; 528 deferment.

### (b) Criteria
- **University Lands (Permian) approved mix, 3.79 lb PLS/ac total, same for every listed county** ([UL Aug 2026](https://universitylands.utsystem.edu/Content/Documents/Operations/SeedMixturesByCounties.pdf)):

| Species | lb PLS/ac |
|---|---|
| Sideoats 'El Reno' | 0.68 |
| Blue grama | 0.23 |
| Plains bristlegrass | 0.45 |
| Sand dropseed | 0.20 |
| Green sprangletop 'Van Horn' | 0.34 |
| Pearl millet (nurse crop) | 1.00 |
| Maximilian sunflower | 0.09 |
| Engelmann daisy 'Eldorado' | 0.60 |
| Purple prairie clover 'Kaneb' | 0.12 |
| Mexican hat | 0.08 |

  - Seedbed: **leave it somewhat rough but firm** (pack before and after seeding).
  - **On sandy soils, mulch or litter (hay, cotton burs) may be required.**
- **TxDOT Item 164** (§4 table for district mixes):
  - Temporary seeding: cool-season mix (oats and wheat as main components, Table 3) **Sep 1–Jan 31**; warm-season Brownton millet **20 lb/ac, Feb 1–Aug 30**.
  - Mulch: straw **2–2.5 t/ac**, hay **1.5–2 t/ac**, tacked. Hydromulch on sandy soils **2,500 lb/ac** (slopes ≤ 3:1) or **3,000 lb/ac** (steeper).
  - Drill **1/4–1/3 in deep**.
- **Mulch cover target:** about **70% ground cover**. In New Mexico 484 that is about **2,150 lb/ac small-grain straw, anchored** by coulter or crimper. ([NM 484 (2005), via search](https://corpora.tika.apache.org/base/docs/govdocs1/260/260109.pdf)) (abstract) The Texas 484 standard was not retrieved.
- **Topsoil:** salvage separately; never salvage when wet or frozen; keep stockpiles low and seeded; remove gravel, caliche and pads at reclamation. ([COGCC presentation](https://cogcc.state.co.us/documents/reg/OpGuidance/Reclamation%20Technical%20Presentation_12_8_2016.pdf)) This is Colorado guidance; Texas-specific topsoil rules were not found.
  - Default (unverified): rip compacted caliche or subsoil 12–18 in, respread 4–6 in of topsoil, then seed and mulch.
- **Pipeline ROWs:** Texas Native Seeds mixes were used on about **8,000 ac** of the Shin Oak NGL pipeline (west of Midland toward Houston), across six ecoregions. ([TNS](https://ckwri.tamuk.edu/node/899)) In the Eagle Ford, drill, broadcast, and hydroseeding were equally effective, reaching **≥ 0.5 seeded plants/ft² by 6 months**. ([CKWRI](https://www.ckwri.tamuk.edu/sites/default/files/evaluation_of_pipeline_restoration_techniques_in_the_eagle_ford_shale.pdf))
- **Railroad Commission:** former 16 TAC §3.8 required reserve and mud pits to be backfilled within **1 year** of drilling ending. Rules moved to new Chapter 4 in 2024, and proposals had shorter deadlines. Current deadlines are unverified. ([RRC SWR8](https://www.rrc.texas.gov/oil-and-gas/publications-and-notices/manuals/surface-waste-management-manual/swr8-summary)) I could not verify any §3.14 surface-restoration deadline, nor TPWD general reclamation guidance beyond project letters recommending native revegetation.

### (c) Timing
- Seed permanent mixes Feb 1/15–May 15, or with the July–Aug monsoon in the Trans-Pecos.
- If disturbance ends Sep–Jan, put in a temporary cool-season cover plus mulch immediately so the site does not go into Feb–May bare.

### (d) Modifiers
- **Sandy (WEG 1–2):** mulch is mandatory. Add pearl millet or sorghum nurse or barrier rows. Use the sandy-soil mix.
- **Caliche or clay (WEG 4L–6):** rip plus the clay mix.
- **Trans-Pecos:** use the El Paso mix and monsoon timing.

---

## 9. Barren land, active dunes, blowouts

### (a) Practices
Grazing exclusion (382 fence and 528); 484 mulch or brush slash; 342 seeding or sprigging; 603-type sorghum barrier rows; WAFWA buffers.

### (b) Criteria
- **Inland Texas dunes** (Coastal Sand Plain): with **grazing excluded**, mulch with native prairie hay alone stopped sand movement and allowed vegetation to establish. Seeding, fertilizing, and transplanting were unnecessary. ([Fulbright et al. 2006, REM 59:5](https://bioone.org/journals/Rangeland-Ecology-and-Management/volume-59/issue-5/06-025R1.1/Establishing-Vegetation-on-Migrating-Inland-Sand-Dunes-in-Texas/10.2111/06-025R1.1.full)) (abstract)
- **Texas High Plains:** cotton-bur mulch improved soil moisture for sand bluestem, but **heavy rates blocked seedling emergence**. ([Stubbendieck & McCully 1972](https://journals.uair.arizona.edu/index.php/jrm/article/download/6100/5710)) (abstract; rates not retrieved)
- **Nebraska blowout guidance:** organic mulch at **1–1.5 tons per half-acre (2–3 t/ac)**. Native mix at **≥ 60 PLS/ft² drilled, 120 PLS/ft² broadcast**. Fence until established. Blowouts smaller than about 1/4 ac are preferred. ([Nebraska DEE](https://dee.nebraska.gov/sites/default/files/publications/06-197%20Use%20of%20Waste%20Tires%20for%20Blowout%20Stabilization.pdf)) This is out-of-state guidance.
- **Monahans:** dunes are partly stabilized by shinnery oak roots; some are active. Wind-sand-oak feedbacks maintain the landform, so active dunes may not be practically restorable; protect their stabilized margins instead. ([BEG UT](https://beg.utexas.edu/texas-through-time/monahans-sandhills.html))
- Species: giant sandreed, sand bluestem, giant dropseed, Havard panicum, sand lovegrass, plus retained shinnery and sand sagebrush.

### (c) Timing
- Fence and mulch **before Feb**.
- Seed into the mulch at the regional window (Feb–May, or the monsoon in the Trans-Pecos).
- Defer grazing at least 2 growing seasons (WAFWA analog).

### (d) Rule
Classify a site as dune or blowout when it is WEG 1, the ESD is Sand Hills or dune, and bare ground is high. Then do not recommend tillage or brush control, and require a 150-ft no-treatment buffer for adjacent brush work.

---

## 10. Thresholds to encode (summary)

| Parameter | Value | Source class |
|---|---|---|
| Erosive threshold wind | 13 mph at 1 ft; 18 mph at 30 ft | NRCS |
| High-risk months | Feb–May (peak Mar–Apr); secondary Dec–Jan (N winds) | ARS, TTU |
| Minimum residue cover | ≥ 30% (WEG 5–7); ≥ 50–60% (WEG 1–2) | ARS, NebGuide |
| Seedling tolerance | ≤ 1 t/ac (cotton, peanuts) | NRCS |
| Cover crop rate (dryland) | 30 lb/ac rye or wheat | AgriLife |
| Cover termination (dryland) | 6–8 weeks before planting (minimum ≥ 35 or ≥ 15 days by zone; irrigated exempt) | AgriLife, NRCS/RMA |
| Herbaceous barrier | ≥ 1.5 ft tall, 40–50% porosity, spacing ≤ 10H, within-row ≤ 36 in | TX 603 |
| Windbreak protection | 10H leeward, 2H windward (H at age 20) | TX 380 |
| Trap strip width | ≥ 15 ft | NRCS 589C |
| Ridges | Spacing ≤ 4× height; ≤ 45° off perpendicular | NRCS 588 |
| Emergency chisel | 2-in points, 24–54 in spacing, 3–6 in deep (fine soils); listers 40–50 in, 4–12 in (sands) | K-State, UNL |
| No-till STIR | ≤ 20; reduced till ≤ 45 | TX NRCS |
| Range harvest efficiency | 25% (≤ 33% in prairie-chicken range) | AgriLife, WAFWA |
| New-seeding deferment | ≥ 1 full growing season (2 seasons on treated sands) | TX NRCS, WAFWA |
| Drill row spacing (range) | ≤ 12 in | TX NRCS |
| Broadcast adjustment | +25% (TxDOT) to +50% (TX 340) | TxDOT, NRCS |
| Mulch | Straw 2–2.5 t/ac or hay 1.5–2 t/ac, tacked; about 70% cover | TxDOT, NM NRCS |
| Shinnery tebuthiuron | 0.3 lb ai/ac, ≤ 50% of area per 2 yr, 150-ft dune buffer | WAFWA |

---

## 11. Not verified, or gaps to fill before shipping
1. **Stripcropping (585) strip widths by WEG.** Only the historical "sand ≈ 20 ft" value was readable; the Texas 585 standard was not found. Use WEPS or the Texas FOTG.
2. **Texas 609, 585 and 484 standards** were not on the eFOTG ID ranges I scanned. National 609/589C (2014) and New Mexico 484 were used instead.
3. **SGe value for cotton stalks** was not found.
4. **County C factors** for West Texas were not found.
5. **Which West Texas counties are in termination Zone 1 versus Zone 2.**
6. **Texas range-planting specification tables** (NRCS species rates and planting dates by MLRA) are referenced in the IR sheets but were not retrieved. I used AgriLife and TxDOT rates instead.
7. **Sand bluestem, giant sandreed and switchgrass cultivar suitability** for West Texas, **bush muhly** and **fourwing saltbush** releases, and a **full list of Knox City releases** (the highlights page timed out).
8. **Pasture grazing heights** for kleingrass and weeping lovegrass in Texas; the hay heights above are Oklahoma NRCS.
9. **Railroad Commission §3.14 restoration deadlines, current Chapter 4 pit-closure timelines, TPWD reclamation guidance,** and Texas topsoil handling rules.
10. **Texas A&M Forest Service windbreak species-by-site list.**
    - Confirmed as grown at the West Texas Nursery (Idalou): Afghan pine, bur oak, cedar elm, lilac chastetree, cottonwood. ([Canadian Record](https://www.canadianrecord.com/node/13356))
    - Avoid Siberian elm, Russian olive and saltcedar, which are on TFS's West Texas invasive list. ([TFS](https://tfsweb.tamu.edu/?p=9723))
    - Eastern redcedar is used in windbreaks but invades rangeland.
11. **Approximate rainfall by sub-region and cotton planting dates** (only Big Spring is sourced).
12. The Bilbro & Fryrear coefficient and the ARS WEG 1 residue table rest on abstracts or slides, not the original papers.

---

## 12. Additional sources
- Texas eFOTG implementation-requirement sheets:
  - [327 Conservation cover](https://efotg.sc.egov.usda.gov/api/CPSFile/49481/327_TX_IR_Conservation_Cover-2025_Update_2014)
  - [589 Cross wind trap strips](https://efotg.sc.egov.usda.gov/api/CPSFile/49490/589_TX_IR_Cross_Wind_Trap_Strips-FY25_Update_2017)
  - [314 Brush management](https://efotg.sc.egov.usda.gov/api/CPSFile/49601/314_TX_IR_Brush_Management-FY25_Update_2021)
  - [511 Forage harvest management (CPS)](https://efotg.sc.egov.usda.gov/api/CPSFile/44119/511_TX_CPS_Forage_Harvest_Management_2023)
- [USDA-ARS Lubbock Wind Erosion and Water Conservation unit](https://www.ars.usda.gov/plains-area/lubbock-tx/cropping-systems-research-laboratory/wind-erosion-and-water-conservation-research/)
- Plant releases:
  - ['Haskell' sideoats grama](https://www.nrcs.usda.gov/plantmaterials/txpmcrn14591.pdf)
  - ['Saltalk' alkali sacaton](https://nrcs.usda.gov/plantmaterials/txpmcrn14248.pdf)
  - ['Van Horn' green sprangletop](https://ckwri.tamuk.edu/sites/default/files/plants/brochures/2022/txpmcpg6521.pdf)
  - ['Taylor' sand dropseed (2022, TNS/Knox City/AgriLife)](https://nrcs.usda.gov/plantmaterials/txpmcrn14213.pdf)
  - [Knox City PMC highlights](https://www.nrcs.usda.gov/plant-materials/txpmc/highlights)
  - [Los Lunas PMC report (maintains 'Hachita', 'Nogal', 'Pastura')](https://www.nrcs.usda.gov/plantmaterials/nmpmcra15014.pdf)
  - [West Texas Native Seeds 2019 progress](https://ckwri.tamuk.edu/sites/default/files/publication/pdfs/2019/west_texas_native_seed_project-ip.pdf): 'Brewster' sideoats, 'Permian' whiplash pappusgrass and 'Santiago' silver bluestem are licensed to growers. Black grama, blue grama, Hall's panicum and sand dropseed are in seed increase; a hooded windmillgrass release is planned.
- [Texas Native Seeds Pipeline Prairies](https://www.ckwri.tamuk.edu/sites/default/files/publication/pdfs/2019/texas_native_seeds_pipeline_prairies_initiative-ip.pdf)