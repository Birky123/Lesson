// Kabinett & Isometrie – Bauteile
// Koordinaten in mm: x nach rechts, y nach hinten, z nach oben. Ursprung: vordere linke untere Ecke.
window.EXPLORER = {
  titel: 'Kabinett & Isometrie',
  untertitel: 'Drehe das Bauteil. Vergleiche Vorderansicht, isometrische Projektion und Kabinettprojektion mit deiner Skizze.',
  namenVerstecken: false,
  startAnsicht: 'vorne',      // Einstieg: zuerst nur die Vorderansicht zeigen
  verdeckteKanten: false,     // in Skizzen lassen wir verdeckte Kanten weg; Knopf blendet sie ein
  bauteile: [
    {
      name: 'Winkelblech (t = 8)',
      nummer: 'A',
      elemente: [
        // Kontur aus der Zeichnung der Bemaßungsreihe: 70 × 70, Schenkel 20 breit, Fase 20 × 45°
        { typ: 'prisma', ebene: 'xz', von: 0, bis: 8, profil: [
          [0, 0], [20, 0], [20, 30], [40, 50], [70, 50], [70, 70], [0, 70],
        ] },
        // 3× Ø10: Abstand 10 vom Rand, Lochabstand 50
        { typ: 'bohrung', d: 10, pos: [10, 0, 10], richtung: 'y', tiefe: 'durch' },
        { typ: 'bohrung', d: 10, pos: [10, 0, 60], richtung: 'y', tiefe: 'durch' },
        { typ: 'bohrung', d: 10, pos: [60, 0, 60], richtung: 'y', tiefe: 'durch' },
      ],
    },
    {
      name: 'Winkel mit verstärktem Schenkel',
      nummer: 'B',
      elemente: [
        // gleiche Vorderansicht wie A ...
        { typ: 'prisma', ebene: 'xz', von: 0, bis: 8, profil: [
          [0, 0], [20, 0], [20, 30], [40, 50], [70, 50], [70, 70], [0, 70],
        ] },
        // ... aber der senkrechte Schenkel ist hinten auf 30 mm Tiefe verstärkt
        { typ: 'quader', pos: [0, 8, 0], mass: [20, 22, 70] },
        { typ: 'bohrung', d: 10, pos: [10, 0, 10], richtung: 'y', tiefe: 'durch' },
        { typ: 'bohrung', d: 10, pos: [10, 0, 60], richtung: 'y', tiefe: 'durch' },
        // rechte Bohrung nur durch das 8 mm Blech (sonst ragt die Mittellinie nach hinten)
        { typ: 'bohrung', d: 10, pos: [60, 0, 60], richtung: 'y', tiefe: 9, spitze: false },
      ],
    },
    {
      name: 'Quader',
      nummer: '1',
      elemente: [
        { typ: 'quader', pos: [0, 0, 0], mass: [40, 20, 30] },
      ],
    },
    {
      name: 'Winkel',
      nummer: '2',
      elemente: [
        { typ: 'prisma', ebene: 'xz', von: 0, bis: 30, profil: [
          [0, 0], [30, 0], [30, 10], [10, 10], [10, 30], [0, 30],
        ] },
      ],
    },
    {
      name: 'U-Profil',
      nummer: '3',
      elemente: [
        { typ: 'prisma', ebene: 'xz', von: 0, bis: 20, profil: [
          [0, 0], [40, 0], [40, 30], [30, 30], [30, 10], [10, 10], [10, 30], [0, 30],
        ] },
      ],
    },
    {
      name: 'Treppe',
      nummer: '4',
      elemente: [
        { typ: 'prisma', ebene: 'xz', von: 0, bis: 30, profil: [
          [0, 0], [30, 0], [30, 10], [20, 10], [20, 20], [10, 20], [10, 30], [0, 30],
        ] },
      ],
    },
    {
      name: 'Körper mit Schräge',
      nummer: '5',
      elemente: [
        { typ: 'prisma', ebene: 'xz', von: 0, bis: 30, profil: [
          [0, 0], [40, 0], [40, 10], [20, 30], [0, 30],
        ] },
      ],
    },
    {
      name: 'Treppe auf Sockel',
      nummer: '6',
      elemente: [
        // Vorderansicht: Treppe; Seitenansicht: L (Treppe nur hinten, vorne ein Sockel 10 hoch)
        { typ: 'prisma', ebene: 'xz', von: 0, bis: 30, profil: [
          [0, 0], [30, 0], [30, 10], [20, 10], [20, 20], [10, 20], [10, 30], [0, 30],
        ] },
        { typ: 'quader', op: 'minus', pos: [-1, -1, 10], mass: [32, 21, 21] },
      ],
    },
    {
      name: 'Treppenkörper (Aufgabe 8)',
      nummer: '7',
      elemente: [
        // linker Teil 20 breit: vorne 15 tief / 30 hoch, hinten 15 tief / 40 hoch (Profil aus der Seitenansicht)
        { typ: 'prisma', ebene: 'yz', von: 0, bis: 20, profil: [
          [0, 0], [30, 0], [30, 40], [15, 40], [15, 30], [0, 30],
        ] },
        // rechter Teil: 20 breit, 30 tief, 20 hoch
        { typ: 'quader', pos: [20, 0, 0], mass: [20, 30, 20] },
      ],
    },
  ],
};
