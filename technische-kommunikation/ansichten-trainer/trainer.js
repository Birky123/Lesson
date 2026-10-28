// Ansichten-Trainer – Aufgabenlogik
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const P = window.PROFILE, K = window.koerper;
  const ANSICHT_NAME = {
    vorne: 'Vorderansicht', oben: 'Draufsicht', links: 'Seitenansicht von links',
    rechts: 'Ansicht von rechts', hinten: 'Ansicht von hinten',
  };
  const BLICK_NAME = { vorne: 'von vorn', oben: 'von oben', links: 'von links', rechts: 'von rechts', hinten: 'von hinten' };
  const BILD = { w: 220, h: 220, radius: 19, farbe: 'weiss', pr: 2, dick: true };
  const SATZ = [
    'Ich erkenne das an …',
    'Von links sieht man …, weil …',
    'Die Strichlinie zeigt eine verdeckte Kante …',
    'Das kann nicht stimmen, weil …',
  ];
  const ROLLENWECHSEL = 5;

  let modus = 'entdecken', aufgabe = null, nr = 0, richtig = 0, rolleA = true;
  let wahlV = 3, wahlS = 2;

  const zufall = (n) => 1 + Math.floor(Math.random() * n);
  const mische = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const ex = () => window.explorer;
  const sig = (def, ans) => ex().signatur(def, ans);
  const gleich = (a, b) => ex().gleich(a, b);

  function profilSVG(nr, spiegel) {
    const pts = P[nr].p.map(([a, b]) => `${spiegel ? 30 - a : a},${30 - b}`).join(' ');
    return `<svg viewBox="-3 -3 36 36" aria-hidden="true"><polygon points="${pts}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  }

  // ---------------------------------------------------------------- Ansichten und Modi
  function setzeModus(m) {
    modus = m;
    document.querySelectorAll('.modi [data-modus]').forEach(b => b.classList.toggle('active', b.dataset.modus === m));
    document.body.dataset.modus = m;
    if (m === 'entdecken') { zeigeEntdecken(); return; }
    neueAufgabe();
  }

  function sperreAnsichten(an) { document.body.classList.toggle('gesperrt', an); }
  function zeigeViewer(an) { document.body.classList.toggle('viewer-aus', !an); }

  // ---------------------------------------------------------------- Entdecken
  function zeigeEntdecken() {
    aufgabe = null;
    sperreAnsichten(false); zeigeViewer(true);
    const reihe = (wer) => Object.keys(P).map(k => `<button class="profil ${((wer === 'v' ? wahlV : wahlS) == k) ? 'active' : ''}" data-wer="${wer}" data-p="${k}" title="Profil ${k}: ${P[k].name}">${profilSVG(k)}<span>${k}</span></button>`).join('');
    $('aufgabe').innerHTML = `
      <h2>Entdecken: Körper aus zwei Profilen</h2>
      <p class="auftrag">Wähle ein Profil für vorn und eines für links. Sage zuerst deinem Partner, wie der Körper aussieht. Prüfe dann im 3D-Modell.</p>
      <div class="wahl"><div class="wahl-titel"><b>Profil vorn</b> = Umriss der Vorderansicht</div><div class="profile">${reihe('v')}</div></div>
      <div class="wahl"><div class="wahl-titel"><b>Profil links</b> = Umriss der Seitenansicht von links</div><div class="profile">${reihe('s')}</div></div>
      <div class="zeile"><button class="knopf" id="zufallBtn">Zufälliger Körper</button></div>
      <p class="hinweis">Achtung: Das Profil ist nur der Umriss. In der echten Ansicht siehst du zusätzlich innere Kanten und verdeckte Kanten (Strichlinie).</p>`;
    $('aufgabe').querySelectorAll('.profil').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.wer === 'v') wahlV = +b.dataset.p; else wahlS = +b.dataset.p;
      zeigeEntdecken();
    }));
    $('zufallBtn').addEventListener('click', () => { wahlV = zufall(8); wahlS = zufall(8); zeigeEntdecken(); });
    ex().zeige(K(wahlV, wahlS), 'iso');
    $('nameLabel').textContent = `Profil vorn ${wahlV} · Profil links ${wahlS}`;
  }

  // ---------------------------------------------------------------- Aufgaben erzeugen
  function zufallsKoerper() {
    for (;;) {
      const v = zufall(8), s = zufall(8);
      if (v === 1 && s === 1) continue;          // Würfel: alle Ansichten gleich
      return { v, s };
    }
  }

  // ★ Fehlende Ansicht finden
  function aufgabeAnsicht() {
    for (let versuch = 0; versuch < 40; versuch++) {
      const { v, s } = zufallsKoerper();
      const def = K(v, s);
      const gefragt = Math.random() < 0.6 ? 'links' : 'vorne';
      const gegeben = gefragt === 'links' ? 'vorne' : 'links';
      const kand = [{ def, ans: gefragt, ok: true }];
      kand.push({ def, ans: gefragt === 'links' ? 'rechts' : 'hinten', falle: 'spiegel' });
      const andere = mische([1, 2, 3, 4, 5, 6, 7, 8].filter(k => k !== (gefragt === 'links' ? s : v)));
      for (const k of andere) kand.push({ def: gefragt === 'links' ? K(v, k) : K(k, s), ans: gefragt });
      const opt = waehleVerschiedene(kand, 4);
      if (!opt) continue;
      return { typ: 'ansicht', def, gefragt, gegeben, optionen: mische(opt) };
    }
  }

  // ★★ Blickrichtung zuordnen
  function aufgabeBlick() {
    for (let versuch = 0; versuch < 40; versuch++) {
      const { v, s } = zufallsKoerper();
      const def = K(v, s);
      const richt = ['vorne', 'oben', 'links', 'rechts'];
      const sigs = richt.map(r => sig(def, r));
      const gezeigt = ['vorne', 'oben', 'links'][Math.floor(Math.random() * 3)];
      const gi = richt.indexOf(gezeigt);
      if (sigs.some((x, i) => i !== gi && gleich(x, sigs[gi]))) continue;   // nicht eindeutig
      return { typ: 'blick', def, gezeigt, optionen: richt.map(r => ({ ans: r, ok: r === gezeigt })) };
    }
  }

  // ★★★ Körper zu zwei Ansichten finden
  function aufgabeKoerper() {
    for (let versuch = 0; versuch < 40; versuch++) {
      const { v, s } = zufallsKoerper();
      const def = K(v, s);
      const kand = [{ def, ok: true }];
      if (v !== s) kand.push({ def: K(s, v), falle: 'tausch' });
      kand.push({ def: K(v, s, true), falle: 'spiegel' });
      for (const k of mische([1, 2, 3, 4, 5, 6, 7, 8])) {
        if (k !== s) kand.push({ def: K(v, k) });
        if (k !== v) kand.push({ def: K(k, s) });
      }
      // verschieden = Paar aus Vorderansicht und Seitenansicht unterscheidet sich
      const paar = (d) => [sig(d, 'vorne'), sig(d, 'links')];
      const ref = paar(def), wahl = [kand[0]], gesehen = [ref];
      for (const c of kand.slice(1)) {
        if (wahl.length === 4) break;
        const p = paar(c.def);
        if (gesehen.some(g => gleich(g[0], p[0]) && gleich(g[1], p[1]))) continue;
        wahl.push(c); gesehen.push(p);
      }
      if (wahl.length < 4) continue;
      return { typ: 'koerper', def, optionen: mische(wahl) };
    }
  }

  function waehleVerschiedene(kand, n) {
    const wahl = [], sigs = [];
    for (const c of kand) {
      const x = sig(c.def, c.ans);
      if (sigs.some(y => gleich(x, y))) { if (c.ok) return null; continue; }
      wahl.push(c); sigs.push(x);
      if (wahl.length === n) break;
    }
    return wahl[0] && wahl[0].ok && wahl.length === n ? wahl : null;
  }

  // ---------------------------------------------------------------- Aufgabe anzeigen
  function neueAufgabe() {
    $('aufgabe').innerHTML = '<p class="hinweis">Aufgabe wird erstellt …</p>';
    setTimeout(() => {
      aufgabe = modus === 'ansicht' ? aufgabeAnsicht() : modus === 'blick' ? aufgabeBlick() : aufgabeKoerper();
      aufgabe.versuche = 0; aufgabe.geloest = false;
      nr++;
      zeigeAufgabe();
    }, 20);
  }

  function rolleHTML() {
    const loeser = rolleA ? 'A' : 'B', pruefer = rolleA ? 'B' : 'A';
    return `<div class="rolle"><span><b>Löser:</b> Partner ${loeser}</span><span><b>Prüfer:</b> Partner ${pruefer}</span><span class="zaehler">Aufgabe ${nr} · ${richtig} richtig</span></div>`;
  }

  function karte(url, titel, extra) {
    return `<figure class="ansicht-karte ${extra || ''}"><img src="${url}" alt="${titel}"><figcaption>${titel}</figcaption></figure>`;
  }

  function zeigeAufgabe() {
    const a = aufgabe;
    let html = rolleHTML();
    if (a.typ === 'ansicht') {
      sperreAnsichten(true); zeigeViewer(true);
      ex().zeige(a.def, 'iso');
      html += `<h2><span class="sterne">★</span> Fehlende Ansicht finden</h2>
        <p class="auftrag">Drehe den Körper. Wähle die <b>${ANSICHT_NAME[a.gefragt]}</b> (Blick ${BLICK_NAME[a.gefragt]}). Begründe deine Wahl laut.</p>
        <div class="gegeben">${karte(ex().bild(a.def, a.gegeben, BILD), 'gegeben: ' + ANSICHT_NAME[a.gegeben])}</div>
        <div class="optionen">${a.optionen.map((o, i) => `<button class="option" data-i="${i}"><img src="${ex().bild(o.def, o.ans, BILD)}" alt="Antwort ${'ABCD'[i]}"><span>${'ABCD'[i]}</span></button>`).join('')}</div>`;
    } else if (a.typ === 'blick') {
      sperreAnsichten(true); zeigeViewer(true);
      ex().zeige(a.def, 'iso');
      html += `<h2><span class="sterne">★★</span> Blickrichtung zuordnen</h2>
        <p class="auftrag">Aus welcher Richtung siehst du diese Ansicht? Wähle die Blickrichtung. Begründe mit einem Merkmal.</p>
        <div class="gegeben">${karte(ex().bild(a.def, a.gezeigt, BILD), 'Welche Ansicht ist das?')}</div>
        <div class="optionen text">${a.optionen.map((o, i) => `<button class="option" data-i="${i}"><b>Blick ${BLICK_NAME[o.ans]}</b><small>${ANSICHT_NAME[o.ans]}</small></button>`).join('')}</div>`;
    } else {
      sperreAnsichten(true); zeigeViewer(false);
      html += `<h2><span class="sterne">★★★</span> Körper finden</h2>
        <p class="auftrag">Zu welchem Körper gehören diese zwei Ansichten? Wähle den Körper. Begründe mit einem Merkmal und der Blickrichtung.</p>
        <div class="gegeben zwei">${karte(ex().bild(a.def, 'vorne', BILD), 'Vorderansicht')}${karte(ex().bild(a.def, 'links', BILD), 'Seitenansicht von links')}</div>
        <div class="optionen">${a.optionen.map((o, i) => `<button class="option" data-i="${i}"><img src="${ex().bild(o.def, 'iso', { w: 220, h: 220, radius: 26, pr: 2, dick: true })}" alt="Körper ${'ABCD'[i]}"><span>${'ABCD'[i]}</span></button>`).join('')}</div>`;
    }
    html += `<div class="rueckmeldung" id="rueck" hidden></div>
      <details class="satz"><summary>Satzanfänge zum Begründen</summary><ul>${SATZ.map(t => `<li>${t}</li>`).join('')}</ul></details>`;
    $('aufgabe').innerHTML = html;
    $('aufgabe').querySelectorAll('.option').forEach(b => b.addEventListener('click', () => antworte(+b.dataset.i, b)));
  }

  function antworte(i, btn) {
    const a = aufgabe;
    if (a.geloest) return;
    const o = a.optionen[i];
    a.versuche++;
    const rueck = $('rueck');
    rueck.hidden = false;
    if (o.ok) {
      a.geloest = true;
      if (a.versuche === 1) richtig++;
      btn.classList.add('richtig');
      $('aufgabe').querySelectorAll('.option').forEach(b => { if (b !== btn) b.disabled = true; });
      sperreAnsichten(false);
      let pruef = '', ziel = 'iso';
      if (a.typ === 'ansicht') { ziel = a.gefragt; pruef = `Prüfer: Drehe den Körper in die ${ANSICHT_NAME[a.gefragt]} und vergleicht.`; }
      if (a.typ === 'blick') { ziel = a.gezeigt; pruef = `Prüfer: Drehe den Körper so, dass du ${BLICK_NAME[a.gezeigt]} draufschaust.`; }
      if (a.typ === 'koerper') { zeigeViewer(true); ex().zeige(a.def, 'iso'); pruef = 'Prüfer: Drehe den Körper in Vorderansicht und Seitenansicht von links und vergleicht.'; }
      const wechsel = nr % ROLLENWECHSEL === 0;
      rueck.className = 'rueckmeldung ok';
      rueck.innerHTML = `<b>${a.versuche === 1 ? 'Richtig!' : 'Jetzt stimmt es.'}</b> Löser: Begründe deinem Partner deine Wahl. ${pruef}
        <div class="zeile"><button class="knopf" id="zeigBtn">${a.typ === 'koerper' ? 'Vorderansicht zeigen' : 'Ansicht im 3D-Modell zeigen'}</button>
        <button class="knopf primaer" id="weiterBtn">Nächste Aufgabe</button></div>
        ${wechsel ? '<p class="wechsel">Rollenwechsel! Der Prüfer wird jetzt Löser.</p>' : ''}`;
      $('zeigBtn').addEventListener('click', () => ex().fahre(a.typ === 'koerper' ? 'vorne' : ziel));
      $('weiterBtn').addEventListener('click', () => { if (wechsel) rolleA = !rolleA; neueAufgabe(); });
      $('aufgabe').querySelector('.zaehler').textContent = `Aufgabe ${nr} · ${richtig} richtig`;
    } else {
      btn.classList.add('falsch'); btn.disabled = true;
      rueck.className = 'rueckmeldung nein';
      rueck.innerHTML = `<b>Noch nicht.</b> ${tipp(a, o)}`;
    }
  }

  function tipp(a, o) {
    if (o.falle === 'spiegel') return 'Diese Ansicht ist seitenverkehrt. Bei der Seitenansicht von links liegt <b>hinten links</b> auf dem Blatt. Drehe den Körper und schau genau von links.';
    if (o.falle === 'tausch') return 'Hier sind vorn und links vertauscht. Welcher Umriss gehört zur Vorderansicht?';
    if (a.typ === 'blick') return 'Drehe den Körper langsam. Suche ein Merkmal (Absatz, Schräge, Strichlinie), das nur aus einer Richtung so aussieht.';
    return 'Vergleiche den Umriss und die Strichlinien. Strichlinien sind verdeckte Kanten: Die Kante liegt hinter einer Fläche.';
  }

  // ---------------------------------------------------------------- Start
  function start() {
    // warten, bis die Engine den Startkörper fertig berechnet hat (sonst überschreibt sie die erste Aufgabe)
    if (!window.explorer || !window.explorer.zeige || !window.explorer.status[0]) { setTimeout(start, 50); return; }
    document.querySelectorAll('.modi [data-modus]').forEach(b => b.addEventListener('click', () => setzeModus(b.dataset.modus)));
    const m = new URLSearchParams(location.search).get('modus');
    setzeModus(['entdecken', 'ansicht', 'blick', 'koerper'].includes(m) ? m : 'entdecken');
    window.TRAINER = { setzeModus, aufgabe: () => aufgabe };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 60));
  else setTimeout(start, 60);
})();
