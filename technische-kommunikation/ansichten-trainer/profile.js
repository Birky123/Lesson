// Ansichten-Trainer – Profile
// Idee: „Freihandskizzen üben mit multiplen Prismen“ nach Ulrich Rapp (ulrich-rapp.de), Profile 1–8 auf 30 × 30 mm, 5-mm-Raster.
// Ein Körper entsteht aus zwei Profilen: Profil V liegt in der Vorderansicht (Prisma entlang y),
// Profil S liegt in der Seitenansicht von links (Prisma entlang x). Der Körper ist die Schnittmenge beider Prismen.
// Profilpunkte [a, b]: a = von links auf dem Blatt, b = nach oben (mm).
// Seitenansicht von links: links auf dem Blatt = hinten (y = 30). Deshalb y = 30 − a.
window.PROFILE = {
  1: { name: 'Quadrat',      p: [[0,0],[30,0],[30,30],[0,30]] },
  2: { name: 'L schmal',     p: [[0,0],[30,0],[30,10],[10,10],[10,30],[0,30]] },
  3: { name: 'Treppe',       p: [[0,0],[30,0],[30,10],[20,10],[20,20],[10,20],[10,30],[0,30]] },
  4: { name: 'L breit',      p: [[0,0],[30,0],[30,15],[15,15],[15,30],[0,30]] },
  5: { name: 'Haken',        p: [[0,0],[30,0],[30,10],[10,10],[10,20],[20,20],[20,30],[0,30]] },
  6: { name: 'Dreieck',      p: [[0,0],[30,0],[0,30]] },
  7: { name: 'Stufe schräg', p: [[0,0],[30,0],[20,10],[10,10],[10,20],[0,30]] },
  8: { name: 'Spitze',       p: [[0,0],[30,15],[0,30]] },
};
// Ergänzung zum Profil im Quadrat (1 mm Überstand nach außen) – wird vom anderen Prisma abgezogen.
window.REST = {
  1: [],
  2: [[[10,10],[31,10],[31,31],[10,31]]],
  3: [[[10,20],[20,20],[20,10],[31,10],[31,31],[10,31]]],
  4: [[[15,15],[31,15],[31,31],[15,31]]],
  5: [[[10,10],[31,10],[31,31],[20,31],[20,20],[10,20]]],
  6: [[[31,-1],[31,31],[-1,31]]],
  7: [[[-1,31],[0,30],[10,20],[10,10],[20,10],[30,0],[31,-1],[31,31]]],
  8: [[[-1,-0.5],[31,15.5],[31,-1],[-1,-1]], [[-1,30.5],[31,14.5],[31,31],[-1,31]]],
};
// Körper aus Profil v (Vorderansicht) und s (Seitenansicht v. links); spiegel = Seitenprofil seitenverkehrt
window.koerper = function (v, s, spiegel) {
  const el = [{ typ: 'prisma', ebene: 'xz', von: 0, bis: 30, profil: window.PROFILE[v].p }];
  for (const poly of window.REST[s]) {
    el.push({ typ: 'prisma', ebene: 'yz', von: -1, bis: 31, op: 'minus',
      profil: poly.map(([a, b]) => [spiegel ? a : 30 - a, b]) });
  }
  return { name: `Körper V${v} · S${s}${spiegel ? ' (gespiegelt)' : ''}`, nummer: `${v}|${s}`, elemente: el, v, s, spiegel: !!spiegel };
};
window.EXPLORER = {
  titel: 'Ansichten-Trainer',
  untertitel: '',
  startAnsicht: 'iso',
  verdeckteKanten: true,
  mittellinien: false,
  bauteile: [window.koerper(3, 2)],
};
