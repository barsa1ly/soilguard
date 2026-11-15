/* The long notes of the panel's cards, folded as the legend's are (js/app.js foldNotes): the paragraphs that say how a
   value is worked out, where it comes from and what it leaves out wait under one small "More" button at the lower right of each
   card and Overview tile, so each card shows its results first. A note is folded when it is a p.fine of 200 characters or more inside a
   .card, with no button, box, choice or colour key in it (used, or read with a chart), not a card's lead into another
   tab (.cta), not in the Download tab (its notes go with its choices) and not marked data-nofold. Never folded either:
   a note that says something is being read, has failed, is missing here or is outside the states (KEEP below), and the
   few results written as notes (RESULT); a Reload button keeps its note in view by the rule above. Values, tables,
   charts and warning boxes are not p.fine and stay as they are. A card's open or shut is its own and is kept on
   this device under its tab and heading, so a card drawn again (a new point, other units, a Reload) keeps it. The cards
   are drawn by many files at any time: a MutationObserver on the panel's body looks again before the next frame, so a
   long note does not show first and then jump away. Loaded after app.js. */
(function () {
  const body = document.getElementById("panelBody");
  if (!body) return;
  const MIN = 140, STORE = "fg.cardnotes";
  // the words of a note that must stay in view (an error, a read in progress, a gap at this point); a method note that
  // happens to use one stays open too, the safe side
  const KEEP = /could not|couldn['’]t|cannot|can['’]t be|failed|failure|\berror\b|unavailable|not available|try again|\bbusy\b|did(?: not|n['’]t) answer|timed? out|\bdown (?:just now|for)\b|\bre(?:load|try)\b|\b(?:has|gives|gave) no\b|\bnone in\b|\b(?:reading|loading|measuring|waiting)\b|no .{0,80}?\b(?:here|at this point|for this (?:point|place|location|site))\b|outside (?:the|this|your)|not mapped/i;
  // results written as a note: the point's watershed with its HUC and area (Basin), a period's days and dates (Soil moisture)
  const RESULT = /^\d+ days?, /;
  let open;
  try { open = new Set(JSON.parse(localStorage.getItem(STORE) || "[]")); } catch (e) { open = new Set(); }
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify([...open].slice(-200))); } catch (e) { /* storage off: for this visit */ } };
  // a card by its tab and heading, its numbers left out (a heading that names a value or a year keeps its choice)
  const keyOf = card => { const tab = card.closest("section.tab[id]"), h = card.querySelector("h3, h4"); return `${tab ? tab.id : ""}|${(h ? h.textContent : "").replace(/\d[\d.,]*/g, "#").replace(/\s+/g, " ").trim().slice(0, 80)}`; };
  // a note with a colour key in it (a chart's swatches) is that chart's legend: it stays in view too
  const fits = p => { const t = (p.textContent || "").replace(/\s+/g, " ").trim();
    return !p.hidden && t.length >= MIN && !p.querySelector("button, input, select, textarea, .skeleton, .sw, [style*='background'], svg") && !p.closest("[data-nofold], .cta, #tab-download") && !KEEP.test(t) && !RESULT.test(t); };
  const SAY = on => (on ? "Less ▴" : "More ▾");
  const TFAIL = /^\s*(could not|reading|looking|loading|no )/i;
  // a note is a leaf: text and inline marks only, none of the parts that are results, choices or tables
  const INLINE = "b, i, em, strong, a, span, small, sup, sub, code, br, abbr";
  const SKIP = "table, .wx-kv, .facts, .kv, .stat, .chips, .chip, .card-h, .card-tools, .month-strip, label, .seg, .legend, .chart-legend, .sm-chip-note, .bs-leg, .bs-warn, .warn, .err, .fail, .cta, [role=alert], [data-nofold], #tab-download";
  const leaf = el => !el.querySelector(":scope > :not(" + INLINE + ")") && !el.querySelector("button, input, select, textarea, .skeleton, .sw, svg, .wx-retry");
  const scopeOf = el => el.closest(".stat") || el.closest(".card");
  const keyOf2 = sc => { const card = sc.closest(".card") || sc; let k = keyOf(card);
    if (sc.classList.contains("stat")) { const h = sc.querySelector(".k"); k += "|" + (h ? h.textContent : "").replace(/\d[\d.,]*/g, "#").replace(/\s+/g, " ").trim().slice(0, 40); }
    return k; };
  function scan() {
    const scopes = new Map(), add = el => { const sc = scopeOf(el); if (!sc) return; if (!scopes.has(sc)) scopes.set(sc, []); scopes.get(sc).push(el); };
    // 1 notes: p.fine and other long leaf paragraphs or divs of a card
    body.querySelectorAll(".card p, .card div").forEach(p => {
      const on = !p.closest(SKIP) && !p.closest(".stat") && (p.matches("p.fine") ? fits(p) : (p.tagName === "P" || !p.className || /\b(fine|bs-help|note|sm-note)\b/.test(p.className)) && leaf(p) && fits(p));
      if (on !== p.classList.contains("fold-p")) p.classList.toggle("fold-p", on);
      if (!on) { p.classList.remove("fold-show"); return; }
      add(p);
    });
    // 2 tile sub-lines
    body.querySelectorAll(".stat .s").forEach(s => {
      if (!s.querySelector(":scope > .tf-more")) {
        const t = (s.textContent || "").replace(/\s+/g, " ").trim();
        if (t.length < 45 || TFAIL.test(t) || KEEP.test(t) || s.querySelector(".wx-retry, .skeleton, button")) return;
        const nodes = [...s.childNodes], lead = nodes[0] && nodes[0].nodeName === "B" ? nodes[0] : null, rest = nodes.slice(lead ? 1 : 0);
        if (rest.map(n => n.textContent).join("").trim().length < 20) return;
        const more = document.createElement("span"); more.className = "tf-more";
        rest.forEach(n => more.appendChild(n));
        s.append(more);
      }
      add(s.querySelector(":scope > .tf-more"));
    });
    // 3 long notes of the facts rows
    body.querySelectorAll(".facts .n").forEach(n => {
      const v = n.previousElementSibling, t = (n.textContent || "").trim();
      if (!n.classList.contains("tf-nh")) {
        if (!v || !v.classList.contains("v") || t.length <= 70 || TFAIL.test(t) || KEEP.test(t) || n.querySelector(".wx-retry, button")) return;
        n.classList.add("tf-nh");
      }
      add(n);
    });
    // 4 long hints under inputs
    body.querySelectorAll(".form-grid label > small, .bs-ctl label > small").forEach(sm => {
      const t = (sm.textContent || "").trim();
      if (!sm.classList.contains("tf-hint")) {
        if (t.length <= 70 || sm.matches(".bs-warn, [data-bs-cnote], [data-bs-pnote], [role=alert], [data-nofold]") || KEEP.test(t)) return;
        sm.classList.add("tf-hint");
      }
      add(sm);
    });
    // a button left where nothing is folded any more goes
    body.querySelectorAll(".fold-tg").forEach(b => { if (!scopes.has(b.parentElement)) b.remove(); });
    scopes.forEach((els, sc) => {
      const on = open.has(keyOf2(sc)), tgs = [...sc.children].filter(b => b.classList.contains("fold-tg"));
      els.forEach(e => { if (e.classList.contains("fold-show") !== on) e.classList.toggle("fold-show", on); });
      tgs.slice(1).forEach(b => b.remove());
      let b = tgs[0];
      if (!b) { b = document.createElement("button"); b.type = "button"; b.className = "fold-tg"; }
      // the last thing of the card or tile, at its lower right
      if (sc.lastElementChild !== b) sc.append(b);
      if (b.textContent !== SAY(on)) b.textContent = SAY(on);
      if (b.getAttribute("aria-expanded") !== String(on)) b.setAttribute("aria-expanded", String(on));
    });
  }
  // before the next frame, or within 100 ms where frames wait (a page in the background); a scan's own button wakes it
  // once more and finds nothing to change
  let due = false;
  const soon = () => {
    if (due) return;
    due = true;
    const go = () => { if (due) { due = false; scan(); } };
    requestAnimationFrame(go);
    setTimeout(go, 100);
  };
  new MutationObserver(soon).observe(body, { childList: true, subtree: true, characterData: true });
  body.addEventListener("click", e => {
    const b = e.target.closest && e.target.closest(".fold-tg"), sc = b && b.parentElement;
    if (!sc) return;
    e.preventDefault();
    const k = keyOf2(sc);
    if (open.has(k)) open.delete(k); else open.add(k);
    save();
    scan();
  });
  scan();
  WG.fold = { scan };
})();
