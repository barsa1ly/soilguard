/* Visitor statistics through Umami Cloud's free Hobby plan (umami.is: up to 100,000 events a month, one website,
   6 months of data kept, no cookies). Umami records each visit's country, region (state or province, ISO 3166-2) and
   city, approximately, from the IP address, which it does not keep as a field. Off until the site's owner adds the
   site in Umami Cloud and puts its website ID below; nothing is loaded or counted before that. Then:
   - the published site (only it, never a local test or a copy elsewhere) loads Umami's script, sending the page's path
     only (data-exclude-search), never the query string, which holds the chosen location's coordinates;
   - with the dashboard's Share URL below (made in Umami: the website's Edit, Share URL, Add), a "Visitor statistics"
     link at the start of the map's bottom bar opens it for anyone, without signing in.
   See README.md, "Visitor statistics", and docs/METHODS.md §9. */
(function () {
  const UMAMI_WEBSITE_ID = ""; // the Website ID from Umami Cloud's tracking code for this site (data-website-id)
  const UMAMI_SHARE_URL = ""; // the Share URL Umami makes for the dashboard, pasted as it is
  const SITE = "barsa1ly.github.io"; // the published site's host

  // the public dashboard, first in the map's bottom bar (an https link on Umami's own site only)
  const share = (() => { try { const u = new URL(UMAMI_SHARE_URL); return u.protocol === "https:" && /(^|\.)umami\.is$/.test(u.hostname) ? u.href : null; } catch (e) { return null; } })();
  const ctl = WG.map && WG.map.attributionControl;
  if (share && ctl) ctl.setPrefix(`<a class="stats-link" href="${share}" target="_blank" rel="noopener" title="How many people use SoilGuard, and from which countries, states and cities">Visitor statistics</a>${ctl.options.prefix ? ` | ${ctl.options.prefix}` : ""}`);

  if (!/^[0-9a-f-]{36}$/i.test(UMAMI_WEBSITE_ID) || location.hostname !== SITE) return;
  const s = document.createElement("script");
  s.defer = true;
  s.src = "https://cloud.umami.is/script.js";
  s.dataset.websiteId = UMAMI_WEBSITE_ID;
  s.dataset.excludeSearch = "true"; // Umami's documented switch: the query string is not collected
  s.dataset.domains = SITE; // Umami runs only on this host
  document.head.appendChild(s);
})();
