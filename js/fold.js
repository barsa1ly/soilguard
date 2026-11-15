/* The long notes of the panel's cards, folded as the legend's are (js/app.js foldNotes): the paragraphs that say how a
   value is worked out, where it comes from and what it leaves out wait under one small "More about this card" button per
   card, so each card shows its results first. A note is folded when it is a p.fine of 200 characters or more inside a
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
  const MIN = 200, STORE = "fg.cardnotes";
  // the words of a note that must stay in view (an error, a read in progress, a gap at this point); a method note that
  // happens to use one stays open too, the safe side
  const KEEP = /could not|couldn['’]t|cannot|can['’]t be|failed|failure|\berror\b|unavailable|not available|try again|\bbusy\b|did(?: not|n['’]t) answer|timed? out|\bdown (?:just now|for)\b|\bre(?:load|try)\b|\b(?:has|gives|gave) no\b|\bnone in\b|\b(?:reading|loading|measuring|waiting)\b|no .{0,80}?\b(?:here|at this point|for this (?:point|place|location|site))\b|outside (?:the|this|your)|not mapped/i;
  // results written as a note: the point's watershed with its HUC and area (Basin), a period's days and dates (Soil moisture)
  const RESULT = /\bHUC \d{8,12}\b|^\d+ days?, /;
  let open;
  try { open = new Set(JSON.parse(localStorage.getItem(STORE) || "[]")); } catch (e) { open = new Set(); }
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify([...open].slice(-200))); } catch (e) { /* storage off: for this visit */ } };
  // a card by its tab and heading, its numbers left out (a heading that names a value or a year keeps its choice)
  const keyOf = card => { const tab = card.closest("section.tab[id]"), h = card.querySelector("h3, h4"); return `${tab ? tab.id : ""}|${(h ? h.textContent : "").replace(/\d[\d.,]*/g, "#").replace(/\s+/g, " ").trim().slice(0, 80)}`; };
  // a note with a colour key in it (a chart's swatches) is that chart's legend: it stays in view too
  const fits = p => { const t = (p.textContent || "").replace(/\s+/g, " ").trim();
    return !p.hidden && t.length >= MIN && !p.querySelector("button, input, select, textarea, .skeleton, .sw, [style*='background'], svg") && !p.closest("[data-nofold], .cta, #tab-download") && !KEEP.test(t) && !RESULT.test(t); };
  const SAY = on => (on ? "Less ▴" : "More about this card ▾");
  function scan() {
    const cards = new Map();
    body.querySelectorAll(".card p.fine").forEach(p => {
      const card = p.closest(".card"), on = !!card && fits(p);
      if (on !== p.classList.contains("fold-p")) p.classList.toggle("fold-p", on);
      if (!on) { p.classList.remove("fold-show"); return; }
      if (!cards.has(card)) cards.set(card, []);
      cards.get(card).push(p);
    });
    // a button left in a card with no folded note (a note now short, or saying something failed) goes
    body.querySelectorAll(".fold-tg").forEach(b => { if (!cards.has(b.closest(".card"))) b.remove(); });
    cards.forEach((ps, card) => {
      const on = open.has(keyOf(card)), tgs = [...card.querySelectorAll(".fold-tg")].filter(b => b.closest(".card") === card);
      ps.forEach(p => { if (p.classList.contains("fold-show") !== on) p.classList.toggle("fold-show", on); });
      tgs.slice(1).forEach(b => b.remove());
      let b = tgs[0];
      if (!b) { b = document.createElement("button"); b.type = "button"; b.className = "fold-tg"; }
      // just before the card's first folded note, where the text comes out
      if (b.nextElementSibling !== ps[0]) ps[0].before(b);
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
    const b = e.target.closest && e.target.closest(".fold-tg"), card = b && b.closest(".card");
    if (!card) return;
    const k = keyOf(card);
    if (open.has(k)) open.delete(k); else open.add(k);
    save();
    scan();
  });
  scan();
  WG.fold = { scan };
})();
